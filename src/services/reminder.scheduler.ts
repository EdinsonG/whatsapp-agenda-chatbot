import { AppointmentReminderParams } from '../interfaces';
import { appointmentStore } from './appointment.store';
import { reminderQueue } from './reminder-queue';

export const REMINDER_LEAD_HOURS = [12, 2] as const;

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

export const scheduleAppointmentReminders = async (
    params: AppointmentReminderParams
): Promise<void> => {
    reminderQueue.schedule(params);
};

export const cancelAppointmentReminders = (
    date: string,
    startHour: number,
    chatId?: string
): void => {
    reminderQueue.cancel(date, startHour, chatId);
};

export const clearAllReminders = (): void => {
    reminderQueue.clear();
};

export const restoreRemindersFromStore = async (): Promise<void> => {
    reminderQueue.restoreAll();

    const now = Date.now();
    let restored = 0;

    for (const booking of appointmentStore.all()) {
        const at = appointmentAt(booking.date, booking.startHour);
        if (at.getTime() <= now) continue;

        await scheduleAppointmentReminders({
            chatId: booking.chatId,
            businessName: booking.businessName,
            date: booking.date,
            startHour: booking.startHour,
            customer: booking.customer,
            services: booking.services,
        });
        restored++;
    }

    if (restored > 0) {
        console.log(`⏰ Recordatorios reprogramados desde el store: ${restored} cita(s).`);
    }
};
