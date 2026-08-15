import { google, calendar_v3 } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { TenantConfig } from '../tenants/types';
import {
    getAvailableSlots,
    isSlotAvailable,
    TimeSlot,
    generateSlots,
} from '../core/scheduling/scheduling.rules';
import { BookingResult, CalendarService } from './calendar.interface';

export { BookingResult } from './calendar.interface';

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

    async getAvailableSlotsForDate(date: string): Promise<TimeSlot[]> {
        const busy = await this.getBusySlots(date);
        return getAvailableSlots(
            {
                date,
                openHour: this.config.openHour,
                closeHour: this.config.closeHour,
                slotIntervalMin: this.config.slotIntervalMin,
                appointmentDurationMin: this.config.appointmentDurationMin,
                timezone: this.config.timezone,
            },
            busy
        );
    }

    async bookAppointment(
        date: string,
        startHour: number,
        customerName: string,
        notes?: string
    ): Promise<BookingResult> {
        const allSlots = generateSlots({
            date,
            openHour: this.config.openHour,
            closeHour: this.config.closeHour,
            slotIntervalMin: this.config.slotIntervalMin,
            appointmentDurationMin: this.config.appointmentDurationMin,
            timezone: this.config.timezone,
        });

        const candidate = allSlots.find((s) => s.start.getHours() === startHour);

        if (!candidate) {
            return {
                success: false,
                message: `La hora ${startHour}:00 no es un bloque válido para agendar (duración ${this.config.appointmentDurationMin} min, bloques de ${this.config.slotIntervalMin} min).`,
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

        const event = {
            summary: `${this.config.businessName} - Cita ${customerName}`,
            description: notes || '',
            start: { dateTime: candidate.start.toISOString(), timeZone: this.config.timezone },
            end: { dateTime: candidate.end.toISOString(), timeZone: this.config.timezone },
        };

        const created = await this.calendar.events.insert({
            calendarId: this.config.calendar.calendarId,
            requestBody: event,
        });

        return {
            success: true,
            eventId: created.data.id ?? undefined,
            slot: candidate,
            message: `Cita confirmada para ${customerName} el ${date} a las ${startHour}:00 (${this.config.appointmentDurationMin} minutos).`,
        };
    }
}
