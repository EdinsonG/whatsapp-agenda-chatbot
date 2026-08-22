import { describe, it, expect } from 'vitest';
import {
    appointmentAt,
    buildReminderMessage,
    getReminderLeads,
    AppointmentReminderParams,
} from '../src/services/reminder.scheduler';

const params: AppointmentReminderParams = {
    chatId: '5493515551234@c.us',
    businessName: 'Clínica Dental Sonrisa',
    date: '2026-08-20',
    startHour: 10,
    customer: { firstName: 'Ana', lastName: 'García', phone: '3515551234' },
    services: [
        { id: 'limpieza-dental', name: 'Limpieza dental', priceUsd: 50, durationMin: 45 },
    ],
};

describe('appointmentAt', () => {
    it('construye la fecha y hora local de la cita', () => {
        const at = appointmentAt('2026-08-20', 10);
        expect(at.getFullYear()).toBe(2026);
        expect(at.getMonth()).toBe(7);
        expect(at.getDate()).toBe(20);
        expect(at.getHours()).toBe(10);
        expect(at.getMinutes()).toBe(0);
    });
});

describe('getReminderLeads', () => {
    it('agenda ambos recordatorios si hay más de 12 horas de anticipación', () => {
        expect(getReminderLeads(20)).toEqual([12, 2]);
        expect(getReminderLeads(13)).toEqual([12, 2]);
    });

    it('solo agenda el recordatorio de 2 horas entre 2 y 12 horas de anticipación', () => {
        expect(getReminderLeads(12)).toEqual([2]);
        expect(getReminderLeads(5)).toEqual([2]);
    });

    it('no agenda recordatorios con 2 horas o menos de anticipación', () => {
        expect(getReminderLeads(2)).toEqual([]);
        expect(getReminderLeads(1)).toEqual([]);
        expect(getReminderLeads(0)).toEqual([]);
    });
});

describe('buildReminderMessage', () => {
    it('incluye negocio, fecha, hora, nombre y servicios', () => {
        const message = buildReminderMessage(2, params);
        expect(message).toContain('Clínica Dental Sonrisa');
        expect(message).toContain('2026-08-20');
        expect(message).toContain('10:00hs');
        expect(message).toContain('Ana García');
        expect(message).toContain('Limpieza dental');
        expect(message).toContain('2 horas');
    });

    it('indica el plazo de 12 horas cuando corresponde', () => {
        expect(buildReminderMessage(12, params)).toContain('12 horas');
    });
});
