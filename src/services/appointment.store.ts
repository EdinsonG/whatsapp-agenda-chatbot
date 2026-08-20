import { StoredBooking } from '../interfaces';

export const normalizePhone = (value: string): string => value.replace(/\D+/g, '');

export const phonesMatch = (a: string, b: string): boolean => {
    const na = normalizePhone(a);
    const nb = normalizePhone(b);
    if (!na || !nb) return false;
    return na === nb;
};

export const generateCitaNumber = (): string => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return `C-${code}`;
};

export class AppointmentStore {
    private bookings = new Map<string, StoredBooking>();

    add(booking: StoredBooking): void {
        this.bookings.set(booking.citaNumber.toUpperCase(), booking);
    }

    findByNumber(citaNumber: string): StoredBooking | undefined {
        return this.bookings.get(citaNumber.trim().toUpperCase());
    }

    remove(citaNumber: string): void {
        this.bookings.delete(citaNumber.trim().toUpperCase());
    }

    update(citaNumber: string, changes: Partial<Pick<StoredBooking, 'date' | 'startHour'>>): void {
        const booking = this.findByNumber(citaNumber);
        if (booking) Object.assign(booking, changes);
    }

    all(): StoredBooking[] {
        return [...this.bookings.values()];
    }
}

export const appointmentStore = new AppointmentStore();