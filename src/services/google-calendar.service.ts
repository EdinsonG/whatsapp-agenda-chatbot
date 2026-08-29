import { google, calendar_v3 } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { BookingCustomer, BookingResult, CalendarService, missingBookingFields, Service, TenantConfig, TimeSlot } from '../interfaces';
import { generateCitaNumber, appointmentStore } from './appointment.store';
import {
    getAvailableSlots,
    isSlotAvailable,
    generateSlots,
} from '../core/scheduling/scheduling.rules';
import { logger } from '../config/logger';
import { createDateInTimezone } from '../core/scheduling/scheduling.rules';

const log = logger.child({ module: 'google-calendar' });

interface GoogleAPIError {
    code?: number;
    status?: string;
    message?: string;
}

const isAuthError = (err: GoogleAPIError): boolean => err.code === 401 || err.status === 'UNAUTHENTICATED';
const isPermissionError = (err: GoogleAPIError): boolean => err.code === 403 || err.status === 'PERMISSION_DENIED';
const isNotFoundError = (err: GoogleAPIError): boolean => err.code === 404 || err.status === 'NOT_FOUND';
const isRateLimitError = (err: GoogleAPIError): boolean => err.code === 429 || err.status === 'RESOURCE_EXHAUSTED';

export class GoogleCalendarService implements CalendarService {
    private calendar: calendar_v3.Calendar;
    private config: TenantConfig;

    constructor(config: TenantConfig) {
        this.config = config;

        const credentialsPath = path.resolve(process.cwd(), config.calendar.credentialsPath);
        if (!fs.existsSync(credentialsPath)) {
            throw new Error(`Credenciales no encontradas: ${credentialsPath}`);
        }

        const auth = new google.auth.JWT({
            email: config.calendar.serviceAccountEmail,
            keyFile: credentialsPath,
            scopes: ['https://www.googleapis.com/auth/calendar'],
        });

        this.calendar = google.calendar({ version: 'v3', auth });
    }

    private async getBusySlots(date: string): Promise<TimeSlot[]> {
        const startOfDay = createDateInTimezone(date, 0, this.config.timezone);
        const endOfDay = createDateInTimezone(date, 23, this.config.timezone);
        endOfDay.setUTCMinutes(59, 59, 999);

        const maxRetries = 2;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const res = await this.calendar.freebusy.query({
                    requestBody: {
                        timeMin: startOfDay.toISOString(),
                        timeMax: endOfDay.toISOString(),
                        items: [{ id: this.config.calendar.calendarId }],
                        timeZone: this.config.timezone,
                    },
                });

                return (res.data.calendars?.[this.config.calendar.calendarId]?.busy ?? []).map(
                    (period) => ({
                        start: new Date(period.start!),
                        end: new Date(period.end!),
                    })
                );
            } catch (error: any) {
                const err = error as GoogleAPIError;
                if (isAuthError(err)) {
                    log.error({ tenant: this.config.id, date }, 'Error de autenticación con Google Calendar.');
                    throw new Error('Error de autenticación con Google Calendar. Verificar credenciales.');
                }
                if (isPermissionError(err)) {
                    log.error({ tenant: this.config.id, date }, 'Permiso denegado en Google Calendar.');
                    throw new Error('Permiso denegado. Verificar que el calendario fue compartido con la service account.');
                }
                if (isNotFoundError(err)) {
                    log.error({ tenant: this.config.id, calendarId: this.config.calendar.calendarId }, 'Calendario no encontrado.');
                    throw new Error(`Calendario "${this.config.calendar.calendarId}" no encontrado.`);
                }
                if (isRateLimitError(err)) {
                    if (attempt < maxRetries) {
                        const delay = 1000 * 2 ** attempt;
                        log.warn({ tenant: this.config.id, attempt: attempt + 1 }, 'Rate limit, reintentando...');
                        await new Promise((r) => setTimeout(r, delay));
                        continue;
                    }
                    throw new Error('Límite de solicitudes de Google Calendar alcanzado.');
                }
                if (attempt < maxRetries && !err.code) {
                    const delay = 1000 * 2 ** attempt;
                    log.warn({ tenant: this.config.id, attempt: attempt + 1 }, 'Error transitorio, reintentando...');
                    await new Promise((r) => setTimeout(r, delay));
                    continue;
                }
                log.error({ err, tenant: this.config.id, date }, 'Error consultando disponibilidad');
                throw error;
            }
        }
        throw new Error('Error consultando disponibilidad después de reintentos.');
    }

    async getAvailableSlotsForDate(date: string, durationMin?: number): Promise<TimeSlot[]> {
        const busy = await this.getBusySlots(date);
        return getAvailableSlots(
            {
                date,
                openHour: this.config.openHour,
                closeHour: this.config.closeHour,
                slotIntervalMin: this.config.slotIntervalMin,
                appointmentDurationMin: durationMin ?? this.config.appointmentDurationMin,
                timezone: this.config.timezone,
            },
            busy
        );
    }

    async bookAppointment(
        date: string,
        startHour: number,
        customer: BookingCustomer,
        durationMin?: number,
        services?: Service[],
        notes?: string
    ): Promise<BookingResult> {
        const missing = missingBookingFields(customer);
        if (missing.length) {
            return {
                success: false,
                message: `No pude agendar la cita porque falta: ${missing.join(', ')}. Por favor, indicá tu nombre, apellido, hora de cita y número de teléfono.`,
            };
        }

        const appointmentDurationMin = durationMin ?? this.config.appointmentDurationMin;

        const allSlots = generateSlots({
            date,
            openHour: this.config.openHour,
            closeHour: this.config.closeHour,
            slotIntervalMin: this.config.slotIntervalMin,
            appointmentDurationMin,
            timezone: this.config.timezone,
        });

        const candidate = allSlots.find((s) => s.start.getHours() === startHour);

        if (!candidate) {
            return {
                success: false,
                message: `La hora ${startHour}:00 no es un bloque válido para agendar (duración ${appointmentDurationMin} min, bloques de ${this.config.slotIntervalMin} min).`,
            };
        }

        const busy = await this.getBusySlots(date);

        if (!isSlotAvailable(candidate, busy)) {
            return {
                success: false,
                message: `Lo siento, el bloque de las ${startHour}:00 ya está ocupado.`,
                slot: candidate,
            };
        }

        const customerFullName = `${customer.firstName} ${customer.lastName}`.trim();
        const citaNumber = generateCitaNumber(appointmentStore.allNumbers());
        const servicesInfo = services?.length
            ? `Servicios: ${services.map((s) => `${s.name} ($${s.priceUsd} USD, ${s.durationMin} min)`).join(', ')}`
            : '';
        const durationInfo = `Duración total: ${appointmentDurationMin} minutos`;
        const event = {
            summary: `${this.config.businessName} - Cita ${customerFullName}`,
            description: [`Cita N°: ${citaNumber}`, servicesInfo, durationInfo, notes, `Teléfono: ${customer.phone}`]
                .filter(Boolean)
                .join('\n'),
            start: { dateTime: candidate.start.toISOString(), timeZone: this.config.timezone },
            end: { dateTime: candidate.end.toISOString(), timeZone: this.config.timezone },
        };

        try {
            const created = await this.calendar.events.insert({
                calendarId: this.config.calendar.calendarId,
                requestBody: event,
            });

            const totalPrice = services?.reduce((sum, s) => sum + s.priceUsd, 0);
            const priceInfo = totalPrice ? ` Total: $${totalPrice} USD.` : '';

            log.info({ tenant: this.config.id, citaNumber, date, startHour, customer: customerFullName }, 'Cita agendada');

            return {
                success: true,
                eventId: created.data.id ?? undefined,
                citaNumber,
                slot: candidate,
                message: `Cita confirmada para ${customerFullName} (tel. ${customer.phone}) el ${date} a las ${startHour}:00 (${appointmentDurationMin} minutos). Tu número de cita es ${citaNumber}.${priceInfo}`,
            };
        } catch (error: any) {
            const err = error as GoogleAPIError;
            if (isRateLimitError(err)) {
                return { success: false, message: 'Límite de solicitudes alcanzado. Intentá de nuevo en unos segundos.' };
            }
            log.error({ err, tenant: this.config.id }, 'Error creando evento en Google Calendar');
            return { success: false, message: 'No pude crear el evento en el calendario. Intentá de nuevo más tarde.' };
        }
    }

    async cancelAppointment(eventId: string): Promise<boolean> {
        if (!eventId) return false;
        try {
            await this.calendar.events.delete({
                calendarId: this.config.calendar.calendarId,
                eventId,
            });
            log.info({ tenant: this.config.id, eventId }, 'Evento cancelado en Google Calendar');
            return true;
        } catch (error: any) {
            log.error({ err: error, tenant: this.config.id, eventId }, 'Error cancelando evento');
            return false;
        }
    }

    async rescheduleAppointment(
        eventId: string,
        newDate: string,
        newStartHour: number,
        durationMin?: number,
        services?: Service[]
    ): Promise<BookingResult> {
        if (!eventId) {
            return { success: false, message: 'No encontré el evento a reagendar.' };
        }

        const appointmentDurationMin = durationMin ?? this.config.appointmentDurationMin;

        const allSlots = generateSlots({
            date: newDate,
            openHour: this.config.openHour,
            closeHour: this.config.closeHour,
            slotIntervalMin: this.config.slotIntervalMin,
            appointmentDurationMin,
            timezone: this.config.timezone,
        });

        const candidate = allSlots.find((s) => s.start.getHours() === newStartHour);

        if (!candidate) {
            return {
                success: false,
                message: `La hora ${newStartHour}:00 no es un bloque válido para reagendar (duración ${appointmentDurationMin} min, bloques de ${this.config.slotIntervalMin} min).`,
            };
        }

        const busy = await this.getBusySlots(newDate);

        if (!isSlotAvailable(candidate, busy)) {
            return {
                success: false,
                message: `Lo siento, el bloque de las ${newStartHour}:00 del ${newDate} ya está ocupado.`,
                slot: candidate,
            };
        }

        try {
            const updated = await this.calendar.events.patch({
                calendarId: this.config.calendar.calendarId,
                eventId,
                requestBody: {
                    start: { dateTime: candidate.start.toISOString(), timeZone: this.config.timezone },
                    end: { dateTime: candidate.end.toISOString(), timeZone: this.config.timezone },
                },
            });

            log.info({ tenant: this.config.id, eventId, newDate, newStartHour }, 'Evento reagendado');

            return {
                success: true,
                eventId: updated.data.id ?? eventId,
                slot: candidate,
                message: `Cita reagendada para el ${newDate} a las ${newStartHour}:00 (${appointmentDurationMin} minutos).`,
            };
        } catch (error: any) {
            const err = error as GoogleAPIError;
            if (isRateLimitError(err)) {
                return { success: false, message: 'Límite de solicitudes alcanzado. Intentá de nuevo en unos segundos.' };
            }
            log.error({ err, tenant: this.config.id, eventId }, 'Error reagendando evento');
            return { success: false, message: 'No pude reagendar el evento. Intentá de nuevo más tarde.' };
        }
    }
}
