export interface TimeSlot {
    start: Date;
    end: Date;
}

export interface AvailabilityParams {
    date: string;
    openHour?: number;
    closeHour?: number;
    slotIntervalMin?: number;
    appointmentDurationMin?: number;
    timezone?: string;
}