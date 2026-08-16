import { BookingResult, CalendarService, TenantConfig, TimeSlot } from '../interfaces';
import {
    getAvailableSlots,
    isSlotAvailable,
    generateSlots,
} from '../core/scheduling/scheduling.rules';

interface StoredEvent {
    id: string;
    date: string;
    startHour: number;
    slot: TimeSlot;
    customerName: string;
}

export class MockCalendarService implements CalendarService {
    private config: TenantConfig;
    private events: StoredEvent[] = [];
    private nextId = 1;

    constructor(config: TenantConfig) {
        this.config = config;
    }

    private busySlotsForDate(date: string): TimeSlot[] {
        return this.events
            .filter((e) => e.date === date)
            .map((e) => e.slot);
    }

    async getAvailableSlotsForDate(date: string): Promise<TimeSlot[]> {
        return getAvailableSlots(
            {
                date,
                openHour: this.config.openHour,
                closeHour: this.config.closeHour,
                slotIntervalMin: this.config.slotIntervalMin,
                appointmentDurationMin: this.config.appointmentDurationMin,
                timezone: this.config.timezone,
            },
            this.busySlotsForDate(date)
        );
    }

    async bookAppointment(
        date: string,
        startHour: number,
        customerName: string,
        notes?: string
    ): Promise<BookingResult> {
        const allSlots = generateSlots({
            date,
            openHour: this.config.openHour,
            closeHour: this.config.closeHour,
            slotIntervalMin: this.config.slotIntervalMin,
            appointmentDurationMin: this.config.appointmentDurationMin,
            timezone: this.config.timezone,
        });

        const candidate = allSlots.find((s) => s.start.getHours() === startHour);

        if (!candidate) {
            return {
                success: false,
                message: `La hora ${startHour}:00 no es un bloque válido para agendar (duración ${this.config.appointmentDurationMin} min, bloques de ${this.config.slotIntervalMin} min).`,
            };
        }

        if (!isSlotAvailable(candidate, this.busySlotsForDate(date))) {
            return {
                success: false,
                message: `Lo siento, el bloque de las ${startHour}:00 ya está ocupado.`,
                slot: candidate,
            };
        }

        this.events.push({
            id: `mock-${this.nextId++}`,
            date,
            startHour,
            slot: candidate,
            customerName,
        });

        return {
            success: true,
            eventId: `mock-${this.nextId - 1}`,
            slot: candidate,
            message: `Cita confirmada (DEMO) para ${customerName} el ${date} a las ${startHour}:00 (${this.config.appointmentDurationMin} minutos).`,
        };
    }

    listBookings(): StoredEvent[] {
        return [...this.events];
    }
}
