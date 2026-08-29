import { BookingCustomer, BookingResult, CalendarService, missingBookingFields, Service, TenantConfig, TimeSlot } from '../interfaces';
import { generateCitaNumber, appointmentStore } from './appointment.store';
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
    customer: BookingCustomer;
    services: Service[];
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

    async getAvailableSlotsForDate(date: string, durationMin?: number): Promise<TimeSlot[]> {
        return getAvailableSlots(
            {
                date,
                openHour: this.config.openHour,
                closeHour: this.config.closeHour,
                slotIntervalMin: this.config.slotIntervalMin,
                appointmentDurationMin: durationMin ?? this.config.appointmentDurationMin,
                timezone: this.config.timezone,
            },
            this.busySlotsForDate(date)
        );
    }

    async bookAppointment(
        date: string,
        startHour: number,
        customer: BookingCustomer,
        durationMin?: number,
        services?: Service[],
        notes?: string
    ): Promise<BookingResult> {
        const missing = missingBookingFields(customer);
        if (missing.length) {
            return {
                success: false,
                message: `No pude agendar la cita porque falta: ${missing.join(', ')}. Por favor, indicá tu nombre, apellido, hora de cita y número de teléfono.`,
            };
        }

        const appointmentDurationMin = durationMin ?? this.config.appointmentDurationMin;

        const allSlots = generateSlots({
            date,
            openHour: this.config.openHour,
            closeHour: this.config.closeHour,
            slotIntervalMin: this.config.slotIntervalMin,
            appointmentDurationMin,
            timezone: this.config.timezone,
        });

        const candidate = allSlots.find((s) => s.start.getUTCHours() === startHour);

        if (!candidate) {
            return {
                success: false,
                message: `La hora ${startHour}:00 no es un bloque válido para agendar (duración ${appointmentDurationMin} min, bloques de ${this.config.slotIntervalMin} min).`,
            };
        }

        if (!isSlotAvailable(candidate, this.busySlotsForDate(date))) {
            return {
                success: false,
                message: `Lo siento, el bloque de las ${startHour}:00 ya está ocupado.`,
                slot: candidate,
            };
        }

        const citaNumber = generateCitaNumber(appointmentStore.allNumbers());
        this.events.push({
            id: `mock-${this.nextId++}`,
            date,
            startHour,
            slot: candidate,
            customer,
            services: services ?? [],
        });

        const customerFullName = `${customer.firstName} ${customer.lastName}`.trim();
        const serviceNames = services?.length
            ? ` (${services.map((s) => s.name).join(', ')})`
            : '';
        const totalPrice = services?.reduce((sum, s) => sum + s.priceUsd, 0);
        const priceInfo = totalPrice ? ` Total: $${totalPrice} USD.` : '';

        return {
            success: true,
            eventId: `mock-${this.nextId - 1}`,
            citaNumber,
            slot: candidate,
            message: `Cita confirmada (DEMO) para ${customerFullName}${serviceNames} (tel. ${customer.phone}) el ${date} a las ${startHour}:00 (${appointmentDurationMin} minutos). Tu número de cita es ${citaNumber}.${priceInfo}`,
        };
    }

    async cancelAppointment(eventId: string): Promise<boolean> {
        const index = this.events.findIndex((e) => e.id === eventId);
        if (index === -1) return false;
        this.events.splice(index, 1);
        return true;
    }

    async rescheduleAppointment(
        eventId: string,
        newDate: string,
        newStartHour: number,
        durationMin?: number,
        services?: Service[]
    ): Promise<BookingResult> {
        const event = this.events.find((e) => e.id === eventId);
        if (!event) {
            return { success: false, message: 'No encontré la cita a reagendar.' };
        }

        const appointmentDurationMin = durationMin ?? this.config.appointmentDurationMin;

        const allSlots = generateSlots({
            date: newDate,
            openHour: this.config.openHour,
            closeHour: this.config.closeHour,
            slotIntervalMin: this.config.slotIntervalMin,
            appointmentDurationMin,
            timezone: this.config.timezone,
        });

        const candidate = allSlots.find((s) => s.start.getUTCHours() === newStartHour);

        if (!candidate) {
            return {
                success: false,
                message: `La hora ${newStartHour}:00 no es un bloque válido para reagendar (duración ${appointmentDurationMin} min, bloques de ${this.config.slotIntervalMin} min).`,
            };
        }

        const busy = this.busySlotsForDate(newDate).filter((s) => s !== event.slot);

        if (!isSlotAvailable(candidate, busy)) {
            return {
                success: false,
                message: `Lo siento, el bloque de las ${newStartHour}:00 del ${newDate} ya está ocupado.`,
                slot: candidate,
            };
        }

        event.date = newDate;
        event.startHour = newStartHour;
        event.slot = candidate;
        if (services) event.services = services;

        return {
            success: true,
            eventId: event.id,
            slot: candidate,
            message: `Cita reagendada para el ${newDate} a las ${newStartHour}:00 (${appointmentDurationMin} minutos).`,
        };
    }

    listBookings(): StoredEvent[] {
        return [...this.events];
    }
}
