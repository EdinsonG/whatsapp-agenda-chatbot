import { AvailabilityParams, TimeSlot } from '../../interfaces';

export const APPOINTMENT_DURATION_MIN = 45;
export const SLOT_INTERVAL_MIN = 60;
export const DEFAULT_OPEN_HOUR = 8;
export const DEFAULT_CLOSE_HOUR = 18;

export const createDateInTimezone = (dateStr: string, hour: number, timezone?: string): Date => {
    if (!timezone) {
        const [y, m, d] = dateStr.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d, hour, 0, 0, 0));
    }
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date(`${dateStr}T12:00:00Z`));
    const y = parts.find((p) => p.type === 'year')?.value ?? dateStr.slice(0, 4);
    const m = parts.find((p) => p.type === 'month')?.value ?? dateStr.slice(5, 7);
    const d = parts.find((p) => p.type === 'day')?.value ?? dateStr.slice(8, 10);
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), hour, 0, 0, 0));
};

export const isWithinBusinessHours = (
    date: Date,
    openHour = DEFAULT_OPEN_HOUR,
    closeHour = DEFAULT_CLOSE_HOUR
): boolean => {
    const hour = date.getUTCHours();
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
        timezone,
    } = params;

    const slots: TimeSlot[] = [];
    const start = createDateInTimezone(date, openHour, timezone);
    const end = createDateInTimezone(date, closeHour, timezone);

    const current = new Date(start);

    while (current.getTime() + appointmentDurationMin * 60000 <= end.getTime()) {
        const slotStart = new Date(current);
        const slotEnd = new Date(current.getTime() + appointmentDurationMin * 60000);
        slots.push({ start: slotStart, end: slotEnd });
        current.setUTCMinutes(current.getUTCMinutes() + slotIntervalMin);
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
    next.setUTCHours(next.getUTCHours() + 1);
    return next;
};
