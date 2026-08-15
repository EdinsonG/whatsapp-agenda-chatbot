import { TimeSlot } from '../core/scheduling/scheduling.rules';

export interface BookingResult {
    success: boolean;
    eventId?: string;
    message: string;
    slot?: TimeSlot;
}

export interface CalendarService {
    getAvailableSlotsForDate(date: string): Promise<TimeSlot[]>;
    bookAppointment(
        date: string,
        startHour: number,
        customerName: string,
        notes?: string
    ): Promise<BookingResult>;
}
