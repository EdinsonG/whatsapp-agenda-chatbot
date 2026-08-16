import { AvailabilityParams, TimeSlot } from '../../interfaces';

export const APPOINTMENT_DURATION_MIN = 45;
export const SLOT_INTERVAL_MIN = 60;
export const DEFAULT_OPEN_HOUR = 8;
export const DEFAULT_CLOSE_HOUR = 18;

export const isWithinBusinessHours = (
    date: Date,
    openHour = DEFAULT_OPEN_HOUR,
    closeHour = DEFAULT_CLOSE_HOUR
): boolean => {
    const hour = date.getHours();
    return hour >= openHour && hour < closeHour;
};

export const areOverlapping = (a: TimeSlot, b: TimeSlot): boolean => {
    return a.start < b.end && b.start < a.end;
};

export const isSlotAvailable = (
    candidate: TimeSlot,
    busy: TimeSlot[]
): boolean => {
    return !busy.some((b) => areOverlapping(candidate, b));
};

export const generateSlots = (
    params: AvailabilityParams
): TimeSlot[] => {
    const {
        date,
        openHour = DEFAULT_OPEN_HOUR,
        closeHour = DEFAULT_CLOSE_HOUR,
        slotIntervalMin = SLOT_INTERVAL_MIN,
        appointmentDurationMin = APPOINTMENT_DURATION_MIN,
    } = params;

    const slots: TimeSlot[] = [];
    const cursor = new Date(`${date}T00:00:00`);

    const start = new Date(cursor);
    start.setHours(openHour, 0, 0, 0);

    const end = new Date(cursor);
    end.setHours(closeHour, 0, 0, 0);

    const current = new Date(start);

    while (current.getTime() + appointmentDurationMin * 60000 <= end.getTime()) {
        const slotStart = new Date(current);
        const slotEnd = new Date(current.getTime() + appointmentDurationMin * 60000);
        slots.push({ start: slotStart, end: slotEnd });
        current.setMinutes(current.getMinutes() + slotIntervalMin);
    }

    return slots;
};

export const getAvailableSlots = (
    params: AvailabilityParams,
    busy: TimeSlot[]
): TimeSlot[] => {
    return generateSlots(params).filter((slot) => isSlotAvailable(slot, busy));
};

export const getNextHourBoundary = (from: Date): Date => {
    const next = new Date(from);
    next.setSeconds(0, 0);
    next.setMinutes(0);
    next.setHours(next.getHours() + 1);
    return next;
};
