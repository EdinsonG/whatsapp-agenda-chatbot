import { describe, it, expect } from 'vitest';
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
    TimeSlot,
} from '../src/core/scheduling/scheduling.rules';

const slot = (startHour: number, endHour: number): TimeSlot => {
    const start = new Date(`2026-08-17T00:00:00`);
    const end = new Date(`2026-08-17T00:00:00`);
    const startHourInt = Math.floor(startHour);
    const startMin = Math.round((startHour - startHourInt) * 60);
    const endHourInt = Math.floor(endHour);
    const endMin = Math.round((endHour - endHourInt) * 60);
    start.setHours(startHourInt, startMin, 0, 0);
    end.setHours(endHourInt, endMin, 0, 0);
    return { start, end };
};

describe('areOverlapping', () => {
    it('detecta solapamiento cuando un slot está dentro de otro', () => {
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

        expect(slots).toHaveLength(10); // 8,9,10,...,17

        slots.forEach((s, i) => {
            const expectedStartHour = DEFAULT_OPEN_HOUR + i;
            expect(s.start.getHours()).toBe(expectedStartHour);
            expect(s.start.getMinutes()).toBe(0);
            expect(s.end.getTime() - s.start.getTime()).toBe(
                APPOINTMENT_DURATION_MIN * 60000
            );
        });

        expect(slots[0].start.getHours()).toBe(8);
        expect(slots[slots.length - 1].start.getHours()).toBe(17);
    });

    it('respeta duración y franja configurables', () => {
        const slots = generateSlots({
            date: '2026-08-17',
            openHour: 8,
            closeHour: 10,
            slotIntervalMin: 30,
            appointmentDurationMin: 30,
        });
        expect(slots).toHaveLength(4); // 08:00, 08:30, 09:00, 09:30
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
        expect(slots[0].start.getHours()).toBe(17);
    });
});

describe('getAvailableSlots', () => {
    it('filtra los slots ocupados', () => {
        const busy = [slot(9, 10), slot(12, 13)];
        const available = getAvailableSlots(
            { date: '2026-08-17', openHour: 8, closeHour: 11 },
            busy
        );
        expect(available).toHaveLength(2); // 8 y 10
        expect(available.map((s) => s.start.getHours())).toEqual([8, 10]);
    });
});

describe('isWithinBusinessHours', () => {
    it('acepta horas dentro del horario de atención', () => {
        expect(isWithinBusinessHours(new Date('2026-08-17T08:00:00'), 8, 18)).toBe(true);
        expect(isWithinBusinessHours(new Date('2026-08-17T17:59:00'), 8, 18)).toBe(true);
    });

    it('rechaza horas fuera del horario de atención', () => {
        expect(isWithinBusinessHours(new Date('2026-08-17T07:59:00'), 8, 18)).toBe(false);
        expect(isWithinBusinessHours(new Date('2026-08-17T18:00:00'), 8, 18)).toBe(false);
        expect(isWithinBusinessHours(new Date('2026-08-17T20:00:00'), 8, 18)).toBe(false);
    });
});

describe('validación de franjas de 1 hora', () => {
    it('los inicios de slot caen siempre en hora en punto', () => {
        const slots = generateSlots({
            date: '2026-08-17',
            openHour: 8,
            closeHour: 18,
            slotIntervalMin: SLOT_INTERVAL_MIN,
        });
        for (const s of slots) {
            expect(s.start.getMinutes()).toBe(0);
            expect(s.start.getSeconds()).toBe(0);
        }
    });
});
