import { BookingCustomer, Service } from '../interfaces';

export const REMINDER_LEAD_HOURS = [12, 2] as const;

export interface AppointmentReminderParams {
    chatId: string;
    businessName: string;
    date: string;
    startHour: number;
    customer: BookingCustomer;
    services: Service[];
}

export const appointmentAt = (date: string, startHour: number): Date => {
    const at = new Date(`${date}T00:00:00`);
    at.setHours(startHour, 0, 0, 0);
    return at;
};

export const getReminderLeads = (hoursUntil: number): number[] => {
    const leads: number[] = [];
    if (hoursUntil > 12) leads.push(12);
    if (hoursUntil > 2) leads.push(2);
    return leads;
};

export const buildReminderMessage = (
    leadHours: number,
    params: AppointmentReminderParams
): string => {
    const time = `${String(params.startHour).padStart(2, '0')}:00`;
    const serviceText = params.services.length
        ? `\nServicio(s): ${params.services.map((s) => s.name).join(', ')}.`
        : '';
    const name = `${params.customer.firstName} ${params.customer.lastName}`.trim();
    return (
        `⏰ Hola ${name}, te recordamos que en ${leadHours} horas tienes tu cita en ${params.businessName}.\n` +
        `📅 ${params.date} a las ${time}hs.${serviceText}\nTe esperamos.`
    );
};

const timers = new Map<string, NodeJS.Timeout>();

const sendMessage = async (chatId: string, message: string): Promise<void> => {
    const { client } = await import('../client');
    await client.sendMessage(chatId, message);
};

const scheduleOne = (
    leadHours: number,
    remindAt: Date,
    params: AppointmentReminderParams
): void => {
    const delay = remindAt.getTime() - Date.now();
    if (delay <= 0) return;

    const id = `${params.chatId}:${params.date}:${params.startHour}:${leadHours}`;
    const message = buildReminderMessage(leadHours, params);

    const timer = setTimeout(async () => {
        try {
            await sendMessage(params.chatId, message);
            console.log(`📨 Recordatorio (${leadHours} horas) enviado a ${params.chatId}`);
        } catch (error) {
            console.error(`Error enviando recordatorio (${leadHours} horas):`, error);
        } finally {
            timers.delete(id);
        }
    }, delay);

    timers.set(id, timer);
};

export const scheduleAppointmentReminders = async (
    params: AppointmentReminderParams
): Promise<void> => {
    const at = appointmentAt(params.date, params.startHour);
    const hoursUntil = (at.getTime() - Date.now()) / 3600000;

    for (const leadHours of getReminderLeads(hoursUntil)) {
        const remindAt = new Date(at.getTime() - leadHours * 3600000);
        scheduleOne(leadHours, remindAt, params);
    }
};

export const cancelAppointmentReminders = (
    date: string,
    startHour: number,
    chatId?: string
): void => {
    for (const [id, timer] of timers.entries()) {
        const matches =
            id.includes(`${date}:${startHour}`) &&
            (chatId === undefined || id.startsWith(`${chatId}:`));
        if (matches) {
            clearTimeout(timer);
            timers.delete(id);
        }
    }
};

export const clearAllReminders = (): void => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
};