import { Message } from 'whatsapp-web.js';
import { appointmentStore, normalizePhone } from '../services/appointment.store';
import {
    cancelAppointmentReminders,
    scheduleAppointmentReminders,
} from '../services/reminder.scheduler';
import { CalendarService, StoredBooking, TenantConfig } from '../interfaces';
import { logger } from '../config/logger';

const log = logger.child({ module: 'selfservice' });

interface PendingFlow {
    action: 'cancel' | 'reschedule';
    citaNumber?: string;
    date?: string;
    createdAt: number;
}

const pendingFlows = new Map<string, PendingFlow>();
const MAX_FLOWS_PER_CHAT = 3;
const FLOW_TIMEOUT_MS = 5 * 60 * 1000;

const CLEANUP_INTERVAL_MS = 60_000;
let cleanupTimer: ReturnType<typeof setInterval> | undefined;

const startCleanup = (): void => {
    if (cleanupTimer) return;
    cleanupTimer = setInterval(() => {
        const now = Date.now();
        for (const [chatId, flow] of pendingFlows.entries()) {
            if (now - flow.createdAt > FLOW_TIMEOUT_MS) {
                pendingFlows.delete(chatId);
                log.debug({ chatId }, 'Flujo stale eliminado por timeout');
            }
        }
    }, CLEANUP_INTERVAL_MS);
};

startCleanup();

const CANCEL_RE = /\b(cancelar|cancela|cancelaci[oó]n|anular|anulaci[oó]n|dar de baja)\b/i;
const RESCHEDULE_RE = /\b(reagendar|reagenda|reprogramar|reprogramaci[oó]n|cambiar|mover|adelantar|posponer|atrasar)\b/i;
const BOOKING_WORD_RE = /\b(cita|turno|reserva)\b/i;

export const detectSelfServiceIntent = (text: string): 'cancel' | 'reschedule' | null => {
    if (CANCEL_RE.test(text) && BOOKING_WORD_RE.test(text)) return 'cancel';
    if (RESCHEDULE_RE.test(text) && BOOKING_WORD_RE.test(text)) return 'reschedule';
    return null;
};

export const findByCitaAndPhone = (
    chatId: string,
    citaNumber: string
): StoredBooking | undefined => {
    const booking = appointmentStore.findByNumber(citaNumber);
    if (!booking) return undefined;
    if (chatId !== booking.chatId && normalizePhone(chatId) !== normalizePhone(booking.phone)) {
        return undefined;
    }
    return booking;
};

const handleCancelStep = async (
    msg: Message,
    calendar: CalendarService,
    flow: PendingFlow
): Promise<void> => {
    const chatId = msg.from;
    const booking = findByCitaAndPhone(chatId, msg.body);

    if (!booking) {
        pendingFlows.delete(chatId);
        await msg.reply(
            'El número de cita es incorrecto o no corresponde al teléfono desde el que escribís. No se pudo cancelar la cita.'
        );
        return;
    }

    const ok = await calendar.cancelAppointment(booking.eventId ?? '');

    if (ok) {
        cancelAppointmentReminders(booking.date, booking.startHour, chatId);
        appointmentStore.remove(booking.citaNumber);
        pendingFlows.delete(chatId);
        log.info({ chatId, citaNumber: booking.citaNumber }, 'Cita cancelada por autogestión');
        await msg.reply(`✅ Tu cita ${booking.citaNumber} fue cancelada correctamente.`);
    } else {
        await msg.reply('No pude cancelar la cita. Intentá nuevamente más tarde.');
    }
};

const handleRescheduleCitaStep = async (
    msg: Message,
    calendar: CalendarService,
    flow: PendingFlow
): Promise<void> => {
    const chatId = msg.from;
    const booking = findByCitaAndPhone(chatId, msg.body);

    if (!booking) {
        pendingFlows.delete(chatId);
        await msg.reply(
            'El número de cita es incorrecto o no corresponde al teléfono desde el que escribís. No se pudo reagendar la cita.'
        );
        return;
    }

    flow.citaNumber = booking.citaNumber;
    await msg.reply(
        `Perfecto. ¿Para qué día querés reagendar la cita ${booking.citaNumber}? (formato AAAA-MM-DD, ej. 2026-08-25)`
    );
};

const handleRescheduleDateStep = async (
    msg: Message,
    config: TenantConfig,
    calendar: CalendarService,
    flow: PendingFlow
): Promise<void> => {
    const date = msg.body.trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        await msg.reply('El formato de fecha no es válido. Usá AAAA-MM-DD, por ejemplo 2026-08-25.');
        return;
    }

    const now = new Date();
    const selectedDate = new Date(`${date}T00:00:00`);
    if (selectedDate.getTime() < new Date(now.toISOString().slice(0, 10)).getTime()) {
        await msg.reply('No se puede reagendar a una fecha que ya pasó. Elegí una fecha futura.');
        return;
    }

    const booking = appointmentStore.findByNumber(flow.citaNumber!);
    if (!booking) {
        pendingFlows.delete(msg.from);
        await msg.reply('No encontré tu cita. Volvé a intentarlo.');
        return;
    }

    const slots = await calendar.getAvailableSlotsForDate(date, booking.durationMin);
    if (!slots.length) {
        await msg.reply(
            `No hay horarios disponibles el ${date}. ¿Querés probar con otro día? (AAAA-MM-DD)`
        );
        return;
    }

    flow.date = date;
    const list = slots.map((s) => `${String(s.start.getHours()).padStart(2, '0')}:00`).join(', ');
    await msg.reply(
        `Disponibilidad del ${date} (${booking.durationMin} min): ${list}. ¿A qué hora preferís?`
    );
};

const handleRescheduleHourStep = async (
    msg: Message,
    config: TenantConfig,
    calendar: CalendarService,
    flow: PendingFlow
): Promise<void> => {
    const chatId = msg.from;
    const hour = parseInt(msg.body.trim(), 10);

    if (isNaN(hour)) {
        await msg.reply('Eso no parece una hora válida. Indicá la hora, por ejemplo 10.');
        return;
    }

    const booking = appointmentStore.findByNumber(flow.citaNumber!);
    if (!booking) {
        pendingFlows.delete(chatId);
        await msg.reply('No encontré tu cita. Volvé a intentarlo.');
        return;
    }

    const result = await calendar.rescheduleAppointment(
        booking.eventId ?? '',
        flow.date!,
        hour,
        booking.durationMin,
        booking.services
    );

    if (result.success) {
        appointmentStore.update(flow.citaNumber!, { date: flow.date!, startHour: hour });
        cancelAppointmentReminders(booking.date, booking.startHour, chatId);
        await scheduleAppointmentReminders({
            chatId,
            businessName: config.businessName,
            date: flow.date!,
            startHour: hour,
            customer: booking.customer,
            services: booking.services,
        });
        pendingFlows.delete(chatId);
        log.info({ chatId, citaNumber: booking.citaNumber }, 'Cita reagendada por autogestión');
        await msg.reply(`✅ ${result.message}`);
    } else {
        await msg.reply(`😔 ${result.message}`);
    }
};

export const handleSelfServiceMessage = async (
    msg: Message,
    config: TenantConfig,
    calendar: CalendarService
): Promise<boolean> => {
    const chatId = msg.from;
    const text = msg.body.trim();
    const flow = pendingFlows.get(chatId);

    if (flow) {
        if (flow.action === 'cancel') {
            await handleCancelStep(msg, calendar, flow);
        } else if (!flow.citaNumber) {
            await handleRescheduleCitaStep(msg, calendar, flow);
        } else if (!flow.date) {
            await handleRescheduleDateStep(msg, config, calendar, flow);
        } else {
            await handleRescheduleHourStep(msg, config, calendar, flow);
        }
        return true;
    }

    const intent = detectSelfServiceIntent(text);
    if (!intent) return false;

    const activeFlows = [...pendingFlows.keys()].filter((k) => k.startsWith(chatId)).length;
    if (activeFlows >= MAX_FLOWS_PER_CHAT) {
        await msg.reply(
            'Tenés demasiados flujos activos. Por favor esperá unos minutos e intentá de nuevo.'
        );
        return true;
    }

    pendingFlows.set(chatId, { action: intent, createdAt: Date.now() });
    await msg.reply(
        intent === 'cancel'
            ? 'Para cancelar tu cita necesito tu número de cita (formato C-XXXXXX, lo recibiste al agendar). ¿Cuál es?'
            : 'Para reagendar tu cita necesito tu número de cita (formato C-XXXXXX, lo recibiste al agendar). ¿Cuál es?'
    );
    return true;
};
