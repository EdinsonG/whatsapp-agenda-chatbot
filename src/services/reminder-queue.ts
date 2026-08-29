import fs from 'fs';
import path from 'path';
import { BookingCustomer, Service, PendingReminder } from '../interfaces';
import { buildReminderMessage } from './reminder.scheduler';
import { logger } from '../config/logger';

const log = logger.child({ module: 'reminder-queue' });

export const DEFAULT_REMINDER_QUEUE_PATH = path.resolve(
    process.cwd(),
    'data',
    'pending-reminders.json'
);

let sendFn: (chatId: string, message: string) => Promise<void> = async () => {
    log.warn('sendFn no configurado. El recordatorio no se envió.');
};

export const setReminderSender = (fn: (chatId: string, message: string) => Promise<void>): void => {
    sendFn = fn;
};

export class ReminderQueue {
    private pending = new Map<string, PendingReminder>();
    private timers = new Map<string, ReturnType<typeof setTimeout>>();
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
            ) as PendingReminder[];
            for (const entry of entries) {
                this.pending.set(entry.id, entry);
            }
            log.info({ count: this.pending.size, path: this.persistPath }, 'Cola de recordatorios cargada');
        } catch (error) {
            log.error({ err: error }, 'No pude cargar la cola de recordatorios');
        }
    }

    private persist(): void {
        if (!this.persistPath) return;
        try {
            fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
            fs.writeFileSync(
                this.persistPath,
                JSON.stringify([...this.pending.values()], null, 2),
                'utf-8'
            );
        } catch (error) {
            log.error({ err: error }, 'No pude guardar la cola de recordatorios');
        }
    }

    private startTimer(reminder: PendingReminder): void {
        const delay = new Date(reminder.scheduledAt).getTime() - Date.now();
        if (delay <= 0) {
            this.sendReminder(reminder);
            return;
        }

        const timer = setTimeout(() => this.sendReminder(reminder), delay);
        this.timers.set(reminder.id, timer);
    }

    private async sendReminder(reminder: PendingReminder): Promise<void> {
        try {
            await sendFn(reminder.chatId, reminder.message);
            log.info({ leadHours: reminder.leadHours, chatId: reminder.chatId }, 'Recordatorio enviado');
        } catch (error) {
            log.error({ err: error }, 'Error enviando recordatorio');
        } finally {
            this.remove(reminder.id);
        }
    }

    schedule(params: {
        chatId: string;
        businessName: string;
        date: string;
        startHour: number;
        customer: BookingCustomer;
        services: Service[];
    }): void {
        const appointmentTime = new Date(`${params.date}T00:00:00`);
        appointmentTime.setHours(params.startHour, 0, 0, 0);
        const hoursUntil = (appointmentTime.getTime() - Date.now()) / 3_600_000;

        const leads: number[] = [];
        if (hoursUntil > 12) leads.push(12);
        if (hoursUntil > 2) leads.push(2);

        for (const leadHours of leads) {
            const scheduledAt = new Date(
                appointmentTime.getTime() - leadHours * 3_600_000
            );
            if (scheduledAt.getTime() <= Date.now()) continue;

            const id = `${params.chatId}:${params.date}:${params.startHour}:${leadHours}`;
            const message = buildReminderMessage(leadHours, params);

            const reminder: PendingReminder = {
                id,
                chatId: params.chatId,
                businessName: params.businessName,
                date: params.date,
                startHour: params.startHour,
                leadHours,
                message,
                scheduledAt: scheduledAt.toISOString(),
                createdAt: new Date().toISOString(),
            };

            this.pending.set(id, reminder);
            this.persist();
            this.startTimer(reminder);
        }
    }

    restoreAll(): number {
        let restored = 0;
        for (const reminder of this.pending.values()) {
            const scheduledAt = new Date(reminder.scheduledAt).getTime();
            if (scheduledAt <= Date.now()) {
                this.sendReminder(reminder);
                restored++;
                continue;
            }
            if (!this.timers.has(reminder.id)) {
                this.startTimer(reminder);
                restored++;
            }
        }
        if (restored > 0) {
            log.info({ count: restored }, 'Recordatorios restaurados desde la cola');
        }
        return restored;
    }

    cancel(date: string, startHour: number, chatId?: string): void {
        for (const [id, timer] of this.timers.entries()) {
            const matches =
                id.includes(`${date}:${startHour}`) &&
                (chatId === undefined || id.startsWith(`${chatId}:`));
            if (matches) {
                clearTimeout(timer);
                this.timers.delete(id);
                this.pending.delete(id);
            }
        }
        this.persist();
    }

    private remove(id: string): void {
        const timer = this.timers.get(id);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(id);
        }
        this.pending.delete(id);
        this.persist();
    }

    clear(): void {
        for (const timer of this.timers.values()) clearTimeout(timer);
        this.timers.clear();
        this.pending.clear();
        this.persist();
    }

    size(): number {
        return this.pending.size;
    }
}

export const reminderQueue = new ReminderQueue(
    process.env.REMINDER_QUEUE_PATH || DEFAULT_REMINDER_QUEUE_PATH
);
