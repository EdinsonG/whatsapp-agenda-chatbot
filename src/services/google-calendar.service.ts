import { google, calendar_v3 } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { BookingCustomer, BookingResult, CalendarService, missingBookingFields, Service, TenantConfig, TimeSlot } from '../interfaces';
import { generateCitaNumber } from './appointment.store';
import {
    getAvailableSlots,
    isSlotAvailable,
    generateSlots,
} from '../core/scheduling/scheduling.rules';

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
        const startOfDay = new Date(`${date}T00:00:00`);
        const endOfDay = new Date(`${date}T23:59:59`);

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
        const citaNumber = generateCitaNumber();
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

        const created = await this.calendar.events.insert({
            calendarId: this.config.calendar.calendarId,
            requestBody: event,
        });

        const totalPrice = services?.reduce((sum, s) => sum + s.priceUsd, 0);
        const priceInfo = totalPrice ? ` Total: $${totalPrice} USD.` : '';

        return {
            success: true,
            eventId: created.data.id ?? undefined,
            citaNumber,
            slot: candidate,
            message: `Cita confirmada para ${customerFullName} (tel. ${customer.phone}) el ${date} a las ${startHour}:00 (${appointmentDurationMin} minutos). Tu número de cita es ${citaNumber}.${priceInfo}`,
        };
    }

    async cancelAppointment(eventId: string): Promise<boolean> {
        if (!eventId) return false;
        await this.calendar.events.delete({
            calendarId: this.config.calendar.calendarId,
            eventId,
        });
        return true;
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

        const updated = await this.calendar.events.patch({
            calendarId: this.config.calendar.calendarId,
            eventId,
            requestBody: {
                start: { dateTime: candidate.start.toISOString(), timeZone: this.config.timezone },
                end: { dateTime: candidate.end.toISOString(), timeZone: this.config.timezone },
            },
        });

        return {
            success: true,
            eventId: updated.data.id ?? eventId,
            slot: candidate,
            message: `Cita reagendada para el ${newDate} a las ${newStartHour}:00 (${appointmentDurationMin} minutos).`,
        };
    }
}
