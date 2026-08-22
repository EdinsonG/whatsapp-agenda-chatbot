import fs from 'fs';
import path from 'path';
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

const normalizeEntry = (entry: StoredBooking): StoredBooking => ({
    ...entry,
    createdAt: entry.createdAt instanceof Date ? entry.createdAt : new Date(entry.createdAt),
});

export const DEFAULT_APPOINTMENTS_STORE_PATH = path.resolve(
    process.cwd(),
    'data',
    'appointments.json'
);

export class AppointmentStore {
    private bookings = new Map<string, StoredBooking>();
    private persistPath?: string;

    constructor(persistPath?: string) {
        this.persistPath = persistPath;
        if (persistPath) this.load();
    }

    private load(): void {
        try {
            if (!this.persistPath || !fs.existsSync(this.persistPath)) return;
            const entries = JSON.parse(
                fs.readFileSync(this.persistPath, 'utf-8')
            ) as StoredBooking[];
            for (const entry of entries) {
                const normalized = normalizeEntry(entry);
                this.bookings.set(normalized.citaNumber.toUpperCase(), normalized);
            }
            console.log(
                `🗂️ Store de citas cargado: ${this.bookings.size} reserva(s) desde ${this.persistPath}`
            );
        } catch (error) {
            console.error(`No pude cargar el store de citas desde ${this.persistPath}:`, error);
        }
    }

    private persist(): void {
        if (!this.persistPath) return;
        try {
            fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
            fs.writeFileSync(this.persistPath, JSON.stringify(this.all(), null, 2), 'utf-8');
        } catch (error) {
            console.error(`No pude guardar el store de citas en ${this.persistPath}:`, error);
        }
    }

    add(booking: StoredBooking): void {
        this.bookings.set(booking.citaNumber.toUpperCase(), booking);
        this.persist();
    }

    findByNumber(citaNumber: string): StoredBooking | undefined {
        return this.bookings.get(citaNumber.trim().toUpperCase());
    }

    remove(citaNumber: string): void {
        this.bookings.delete(citaNumber.trim().toUpperCase());
        this.persist();
    }

    update(citaNumber: string, changes: Partial<Pick<StoredBooking, 'date' | 'startHour'>>): void {
        const booking = this.findByNumber(citaNumber);
        if (booking) {
            Object.assign(booking, changes);
            this.persist();
        }
    }

    all(): StoredBooking[] {
        return [...this.bookings.values()];
    }
}

export const appointmentStore = new AppointmentStore(
    process.env.APPOINTMENTS_STORE_PATH || DEFAULT_APPOINTMENTS_STORE_PATH
);