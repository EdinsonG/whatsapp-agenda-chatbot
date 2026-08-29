import { describe, it, expect } from 'vitest';
import { TimeSlot } from '../src/interfaces';
import {
    APPOINTMENT_DURATION_MIN,
    SLOT_INTERVAL_MIN,
    DEFAULT_OPEN_HOUR,
    DEFAULT_CLOSE_HOUR,
    areOverlapping,
    isSlotAvailable,
    generateSlots,
    getAvailableSlots,
    isWithinBusinessHours,
    createDateInTimezone,
} from '../src/core/scheduling/scheduling.rules';

const slot = (startHour: number, endHour: number): TimeSlot => {
    const toMs = (h: number) => {
        const hours = Math.floor(h);
        const minutes = Math.round((h - hours) * 60);
        return Date.UTC(2026, 7, 17, hours, minutes, 0, 0);
    };
    const start = new Date(toMs(startHour));
    const end = new Date(toMs(endHour));
    return { start, end };
};

describe('areOverlapping', () => {
    it('detecta solapamiento cuando un slot esta dentro de otro', () => {
        expect(areOverlapping(slot(9, 10), slot(9, 10))).toBe(true);
        expect(areOverlapping(slot(9, 10), slot(9, 11))).toBe(true);
        expect(areOverlapping(slot(9, 11), slot(10, 12))).toBe(true);
    });

    it('no reporta solapamiento para slots consecutivos sin cruce', () => {
        expect(areOverlapping(slot(9, 10), slot(10, 11))).toBe(false);
        expect(areOverlapping(slot(8, 9), slot(9, 10))).toBe(false);
        expect(areOverlapping(slot(10, 11), slot(8, 9))).toBe(false);
    });
});

describe('isSlotAvailable', () => {
    it('devuelve true cuando no hay conflictos', () => {
        const candidate = slot(9, 9.75);
        expect(isSlotAvailable(candidate, [slot(10, 11)])).toBe(true);
    });

    it('devuelve false cuando hay conflicto', () => {
        const candidate = slot(9, 9.75);
        expect(isSlotAvailable(candidate, [slot(9, 10)])).toBe(false);
        expect(isSlotAvailable(candidate, [slot(9, 11)])).toBe(false);
        expect(isSlotAvailable(candidate, [slot(9, 9.5)])).toBe(false);
    });
});

describe('generateSlots', () => {
    it('genera slots de 45 min en bloques de 1 hora entre 8:00 y 18:00', () => {
        const slots = generateSlots({
            date: '2026-08-17',
            openHour: DEFAULT_OPEN_HOUR,
            closeHour: DEFAULT_CLOSE_HOUR,
        });

        expect(slots).toHaveLength(10);

        slots.forEach((s, i) => {
            const expectedStartHour = DEFAULT_OPEN_HOUR + i;
            expect(s.start.getUTCHours()).toBe(expectedStartHour);
            expect(s.start.getUTCMinutes()).toBe(0);
            expect(s.end.getTime() - s.start.getTime()).toBe(
                APPOINTMENT_DURATION_MIN * 60000
            );
        });

        expect(slots[0].start.getUTCHours()).toBe(8);
        expect(slots[slots.length - 1].start.getUTCHours()).toBe(17);
    });

    it('respeta duracion y franja configurables', () => {
        const slots = generateSlots({
            date: '2026-08-17',
            openHour: 8,
            closeHour: 10,
            slotIntervalMin: 30,
            appointmentDurationMin: 30,
        });
        expect(slots).toHaveLength(4);
        expect(slots[0].end.getTime() - slots[0].start.getTime()).toBe(30 * 60000);
    });

    it('no genera slots fuera del horario de cierre', () => {
        const slots = generateSlots({
            date: '2026-08-17',
            openHour: 17,
            closeHour: 18,
            appointmentDurationMin: APPOINTMENT_DURATION_MIN,
        });
        expect(slots).toHaveLength(1);
        expect(slots[0].start.getUTCHours()).toBe(17);
    });
});

describe('getAvailableSlots', () => {
    it('filtra los slots ocupados', () => {
        const busy = [slot(9, 10), slot(12, 13)];
        const available = getAvailableSlots(
            { date: '2026-08-17', openHour: 8, closeHour: 11 },
            busy
        );
        expect(available).toHaveLength(2);
        expect(available.map((s) => s.start.getUTCHours())).toEqual([8, 10]);
    });
});

describe('isWithinBusinessHours', () => {
    it('acepta horas dentro del horario de atencion', () => {
        expect(isWithinBusinessHours(new Date(Date.UTC(2026, 7, 17, 8, 0, 0)), 8, 18)).toBe(true);
        expect(isWithinBusinessHours(new Date(Date.UTC(2026, 7, 17, 17, 59, 0)), 8, 18)).toBe(true);
    });

    it('rechaza horas fuera del horario de atencion', () => {
        expect(isWithinBusinessHours(new Date(Date.UTC(2026, 7, 17, 7, 59, 0)), 8, 18)).toBe(false);
        expect(isWithinBusinessHours(new Date(Date.UTC(2026, 7, 17, 18, 0, 0)), 8, 18)).toBe(false);
        expect(isWithinBusinessHours(new Date(Date.UTC(2026, 7, 17, 20, 0, 0)), 8, 18)).toBe(false);
    });
});

describe('createDateInTimezone', () => {
    it('crea fecha en UTC cuando no hay timezone', () => {
        const d = createDateInTimezone('2026-08-20', 10);
        expect(d.getUTCHours()).toBe(10);
        expect(d.getUTCMinutes()).toBe(0);
    });

    it('crea fecha en la timezone especificada', () => {
        const d = createDateInTimezone('2026-08-20', 8, 'America/Mexico_City');
        expect(d.getUTCHours()).toBe(8);
        expect(d.getUTCDate()).toBe(20);
    });
});

describe('validacion de franjas de 1 hora', () => {
    it('los inicios de slot caen siempre en hora en punto', () => {
        const slots = generateSlots({
            date: '2026-08-17',
            openHour: 8,
            closeHour: 18,
            slotIntervalMin: SLOT_INTERVAL_MIN,
        });
        for (const s of slots) {
            expect(s.start.getUTCMinutes()).toBe(0);
            expect(s.start.getSeconds()).toBe(0);
        }
    });
});
