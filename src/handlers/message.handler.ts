import { Message } from 'whatsapp-web.js';
import { TenantManager } from '../tenants/tenant.manager';
import { getTenantAIResponse } from '../services/groq.service';
import { GoogleCalendarService } from '../services/google-calendar.service';
import { getLimiter, randomDelay } from '../services/limiter.service';
import { scheduleAppointmentReminders } from '../services/reminder.scheduler';
import { Service, servicesTotalDuration, TenantConfig } from '../interfaces';

const tenantManager = new TenantManager();

const calendarCache = new Map<string, GoogleCalendarService>();

const getCalendar = (tenant: TenantConfig): GoogleCalendarService => {
    let calendar = calendarCache.get(tenant.id);
    if (!calendar) {
        calendar = new GoogleCalendarService(tenant);
        calendarCache.set(tenant.id, calendar);
    }
    return calendar;
};

const getTodayAvailableSummary = async (
    calendar: GoogleCalendarService,
    tenant: TenantConfig
): Promise<string[]> => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const slots = await calendar.getAvailableSlotsForDate(today);
    return slots
        .filter((s) => s.start.getHours() >= now.getHours())
        .map((s) => `${String(s.start.getHours()).padStart(2, '0')}:00`);
};

export const handleMessage = async (msg: Message) => {
    if (msg.from.includes('@g.us')) return;

    const text = msg.body.trim();
    if (!text) return;

    const tenant = tenantManager.resolveByWhatsApp(msg.from);
    if (!tenant) {
        await msg.reply('Lo siento, aún no tengo configurado el servicio para este número.');
        return;
    }

    const { config } = tenant;
    const limiter = getLimiter(config);

    await limiter.schedule(async () => {
        const chat = await msg.getChat();

        try {
            await chat.sendSeen();
            await randomDelay();
            await chat.sendStateTyping();

            const calendar = getCalendar(config);
            let availableSummary: string[] = [];
            try {
                availableSummary = await getTodayAvailableSummary(calendar, config);
            } catch {
                availableSummary = [];
            }

            const ai = await getTenantAIResponse(text, config, availableSummary);

            if (ai.scheduleIntent) {
                const serviceIds = ai.scheduleIntent.serviceIds ?? [];
                const services: Service[] = serviceIds
                    .map((id) => config.services.find((s) => s.id === id))
                    .filter((s): s is Service => Boolean(s));
                const durationMin =
                    servicesTotalDuration(config.services, serviceIds) ||
                    config.appointmentDurationMin;

                const result = await calendar.bookAppointment(
                    ai.scheduleIntent.date,
                    ai.scheduleIntent.startHour,
                    {
                        firstName: ai.scheduleIntent.firstName,
                        lastName: ai.scheduleIntent.lastName,
                        phone: ai.scheduleIntent.phone,
                    },
                    durationMin,
                    services,
                    ai.scheduleIntent.notes
                );

                if (result.success) {
                    await scheduleAppointmentReminders({
                        chatId: msg.from,
                        businessName: config.businessName,
                        date: ai.scheduleIntent.date,
                        startHour: ai.scheduleIntent.startHour,
                        customer: {
                            firstName: ai.scheduleIntent.firstName,
                            lastName: ai.scheduleIntent.lastName,
                            phone: ai.scheduleIntent.phone,
                        },
                        services,
                    });
                }

                await randomDelay(800, 2000);
                await msg.reply(
                    result.success
                        ? `✅ ${result.message}`
                        : `😔 ${result.message}`
                );
                return;
            }

            await msg.reply(ai.content);
        } catch (error: any) {
            console.error('Error en el flujo del mensaje:', error.message);
            await msg.reply('Ocurrió un inconveniente técnico. Por favor intenta de nuevo en un momento.');
        } finally {
            await chat.clearState();
        }
    });
};
