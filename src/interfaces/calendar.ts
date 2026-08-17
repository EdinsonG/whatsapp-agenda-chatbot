import { TimeSlot } from './scheduling';

export interface BookingCustomer {
    firstName: string;
    lastName: string;
    phone: string;
}

export const missingBookingFields = (customer: BookingCustomer): string[] => {
    const missing: string[] = [];
    if (!customer.firstName?.trim()) missing.push('nombre');
    if (!customer.lastName?.trim()) missing.push('apellido');
    if (!customer.phone?.trim()) missing.push('número de teléfono');
    return missing;
};

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
        customer: BookingCustomer,
        notes?: string
    ): Promise<BookingResult>;
}