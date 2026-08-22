import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { TenantConfig } from '../src/interfaces';
import { buildSchedulingSystemPrompt } from '../src/prompts/scheduling.prompt';
import { MockCalendarService } from '../src/services/mock-calendar.service';
import {
    AppointmentStore,
    generateCitaNumber,
    normalizePhone,
    phonesMatch,
} from '../src/services/appointment.store';

const config: TenantConfig = {
    id: 'demo-clinica',
    businessName: 'Clínica Dental Sonrisa',
    timezone: 'America/Mexico_City',
    openHour: 8,
    closeHour: 18,
    slotIntervalMin: 60,
    appointmentDurationMin: 45,
    businessDescription: 'Clínica especializada en odontología general, estética y preventiva.',
    businessHours: 'Lunes a viernes de 08:00 a 18:00; sábados de 09:00 a 14:00.',
    location: {
        address: 'Av. Reforma 245, Colonia Centro, Guadalajara, Jalisco',
        googleMapsUrl: 'https://maps.google.com/?q=Av.+Reforma+245+Guadalajara+Jalisco',
    },
    services: [
        { id: 'limpieza-dental', name: 'Limpieza dental', priceUsd: 50, durationMin: 45 },
    ],
    calendar: {
        serviceAccountEmail: 'demo@test.com',
        calendarId: 'primary',
        credentialsPath: 'no-existe.json',
    },
    whatsapp: { sessionId: 'test', rateLimit: { maxConcurrent: 1, minTimeMs: 0 } },
};

describe('buildSchedulingSystemPrompt', () => {
    it('usa la información del tenant para horario, descripción y ubicación', () => {
        const prompt = buildSchedulingSystemPrompt(config);

        expect(prompt).toContain('Clínica especializada en odontología general');
        expect(prompt).toContain('Lunes a viernes de 08:00 a 18:00');
        expect(prompt).toContain('Av. Reforma 245');
        expect(prompt).toContain('maps.google.com');
        expect(prompt).not.toContain('de lunes a viernes');
    });
});

const customer = { firstName: 'Ana', lastName: 'García', phone: '3515551234' };

const bookFor = async (
    calendar: MockCalendarService,
    date = '2026-08-20',
    startHour = 10
) => {
    const result = await calendar.bookAppointment(date, startHour, customer);
    return result;
};

describe('citaNumber en bookAppointment', () => {
    it('asigna un número de cita con formato C-XXXXXX', async () => {
        const calendar = new MockCalendarService(config);
        const result = await bookFor(calendar);
        expect(result.success).toBe(true);
        expect(result.citaNumber).toMatch(/^C-[A-Z2-9]{6}$/);
    });

    it('asigna números de cita distintos entre reservas', async () => {
        const calendar = new MockCalendarService(config);
        const a = await bookFor(calendar, '2026-08-20', 10);
        const b = await bookFor(calendar, '2026-08-20', 11);
        expect(a.citaNumber).not.toBe(b.citaNumber);
    });
});

describe('cancelAppointment', () => {
    it('cancela una cita existente y libera el bloque', async () => {
        const calendar = new MockCalendarService(config);
        const booked = await bookFor(calendar);
        expect(calendar.listBookings()).toHaveLength(1);

        const cancelled = await calendar.cancelAppointment(booked.eventId!);
        expect(cancelled).toBe(true);
        expect(calendar.listBookings()).toHaveLength(0);

        const slots = await calendar.getAvailableSlotsForDate('2026-08-20', 45);
        expect(slots.some((s) => s.start.getHours() === 10)).toBe(true);
    });

    it('devuelve false si el evento no existe', async () => {
        const calendar = new MockCalendarService(config);
        expect(await calendar.cancelAppointment('inexistente')).toBe(false);
    });
});

describe('rescheduleAppointment', () => {
    it('mueve la cita a la nueva fecha y hora', async () => {
        const calendar = new MockCalendarService(config);
        const booked = await bookFor(calendar);

        const rescheduled = await calendar.rescheduleAppointment(
            booked.eventId!,
            '2026-08-21',
            15,
            45
        );
        expect(rescheduled.success).toBe(true);
        expect(rescheduled.message).toContain('2026-08-21');
        expect(rescheduled.message).toContain('15:00');

        const oldDay = await calendar.getAvailableSlotsForDate('2026-08-20', 45);
        expect(oldDay.some((s) => s.start.getHours() === 10)).toBe(true);
        const newDay = await calendar.getAvailableSlotsForDate('2026-08-21', 45);
        expect(newDay.some((s) => s.start.getHours() === 15)).toBe(false);
    });

    it('rechaza una hora ya ocupada', async () => {
        const calendar = new MockCalendarService(config);
        const a = await bookFor(calendar, '2026-08-20', 10);
        await bookFor(calendar, '2026-08-20', 11);

        const result = await calendar.rescheduleAppointment(a.eventId!, '2026-08-20', 11, 45);
        expect(result.success).toBe(false);
        expect(result.message).toContain('ocupado');
    });

    it('no reagenda un evento inexistente', async () => {
        const calendar = new MockCalendarService(config);
        const result = await calendar.rescheduleAppointment('inexistente', '2026-08-21', 15, 45);
        expect(result.success).toBe(false);
    });
});

const makeBooking = (citaNumber: string, chatId: string, phone: string) => ({
    citaNumber,
    chatId,
    phone,
    businessName: 'Clínica Dental Sonrisa',
    customer,
    eventId: 'mock-1',
    date: '2026-08-20',
    startHour: 10,
    durationMin: 45,
    services: config.services,
    createdAt: new Date(),
});

describe('AppointmentStore', () => {
    it('encuentra por número de cita sin importar mayúsculas o espacios', () => {
        const store = new AppointmentStore();
        store.add(makeBooking('C-ABC123', '549@c.us', '3515551234'));
        expect(store.findByNumber('  c-abc123 ')).toBeDefined();
        expect(store.findByNumber('C-OTRO')).toBeUndefined();
    });

    it('actualiza y elimina reservas', () => {
        const store = new AppointmentStore();
        store.add(makeBooking('C-ABC123', '549@c.us', '3515551234'));
        store.update('C-ABC123', { date: '2026-08-22', startHour: 9 });
        const booking = store.findByNumber('C-ABC123');
        expect(booking?.date).toBe('2026-08-22');
        expect(booking?.startHour).toBe(9);

        store.remove('c-abc123');
        expect(store.findByNumber('C-ABC123')).toBeUndefined();
    });
});

describe('normalización de teléfono', () => {
    it('ignora espacios, guiones y sufijos de WhatsApp', () => {
        expect(normalizePhone('5493515551234@c.us')).toBe('5493515551234');
        expect(normalizePhone('+54 9 351 555-1234')).toBe('5493515551234');
    });

    it('phonesMatch compara solo dígitos', () => {
        expect(phonesMatch('5493515551234@c.us', '5493515551234')).toBe(true);
        expect(phonesMatch('+54-9-351-555-1234', '5493515551234')).toBe(true);
        expect(phonesMatch('5493515551234@c.us', '1122334455')).toBe(false);
    });
});

describe('persistencia del store', () => {
    const tempFile = path.join(
        os.tmpdir(),
        `appointments-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    );

    it('guarda en disco y recarga las reservas al volver a instanciar', () => {
        const store = new AppointmentStore(tempFile);
        store.add(makeBooking('C-PERSIST', '549@c.us', '3515551234'));
        expect(fs.existsSync(tempFile)).toBe(true);

        const reloaded = new AppointmentStore(tempFile);
        const booking = reloaded.findByNumber('c-persist');
        expect(booking).toBeDefined();
        expect(booking?.businessName).toBe('Clínica Dental Sonrisa');
        expect(booking?.customer.firstName).toBe('Ana');
        expect(booking?.createdAt).toBeInstanceOf(Date);

        fs.rmSync(tempFile, { force: true });
    });

    it('persiste las actualizaciones y remociones', () => {
        const store = new AppointmentStore(tempFile);
        store.add(makeBooking('C-UPDATE', '549@c.us', '3515551234'));
        store.update('C-UPDATE', { date: '2026-09-01', startHour: 11 });
        store.remove('C-UPDATE');

        const reloaded = new AppointmentStore(tempFile);
        expect(reloaded.findByNumber('C-UPDATE')).toBeUndefined();

        fs.rmSync(tempFile, { force: true });
    });
});

describe('generateCitaNumber', () => {
    it('genera códigos únicos con el formato correcto', () => {
        const seen = new Set<string>();
        for (let i = 0; i < 200; i++) {
            const code = generateCitaNumber();
            expect(code).toMatch(/^C-[A-Z2-9]{6}$/);
            seen.add(code);
        }
        expect(seen.size).toBe(200);
    });
});
