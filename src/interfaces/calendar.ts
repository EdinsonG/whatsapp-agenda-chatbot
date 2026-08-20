import { TimeSlot } from './scheduling';
import { Service } from './tenant';

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
    citaNumber?: string;
    message: string;
    slot?: TimeSlot;
}

export interface StoredBooking {
    citaNumber: string;
    chatId: string;
    phone: string;
    customer: BookingCustomer;
    eventId?: string;
    date: string;
    startHour: number;
    durationMin: number;
    services: Service[];
    createdAt: Date;
}

export interface CalendarService {
    getAvailableSlotsForDate(date: string, durationMin?: number): Promise<TimeSlot[]>;
    bookAppointment(
        date: string,
        startHour: number,
        customer: BookingCustomer,
        durationMin?: number,
        services?: Service[],
        notes?: string
    ): Promise<BookingResult>;
    cancelAppointment(eventId: string): Promise<boolean>;
    rescheduleAppointment(
        eventId: string,
        newDate: string,
        newStartHour: number,
        durationMin?: number,
        services?: Service[]
    ): Promise<BookingResult>;
}