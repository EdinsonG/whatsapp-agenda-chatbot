import { Message } from 'whatsapp-web.js';
import { GoogleCalendarService } from '../services/google-calendar.service';
import { GoogleConversationService } from '../services/google-conversation.service';
import { getLimiter, randomDelay } from '../services/limiter.service';
import { appointmentStore } from '../services/appointment.store';
import { handleSelfServiceMessage } from './selfservice.handler';
import { Tenant, TenantConfig } from '../interfaces';

const calendarCache = new Map<string, GoogleCalendarService>();
const conversationCache = new Map<string, GoogleConversationService>();
const MAX_CONVERSATIONS = 100;

const evictOldestConversation = (): void => {
    if (conversationCache.size <= MAX_CONVERSATIONS) return;
    const firstKey = conversationCache.keys().next().value;
    if (firstKey) conversationCache.delete(firstKey);
};

const getCalendar = (tenant: TenantConfig): GoogleCalendarService => {
    let calendar = calendarCache.get(tenant.id);
    if (!calendar) {
        calendar = new GoogleCalendarService(tenant);
        calendarCache.set(tenant.id, calendar);
    }
    return calendar;
};

const getConversation = (
    chatId: string,
    tenant: TenantConfig,
    calendar: GoogleCalendarService
): GoogleConversationService => {
    let conversation = conversationCache.get(chatId);
    if (!conversation) {
        evictOldestConversation();
        conversation = new GoogleConversationService(tenant, calendar, chatId);
        conversationCache.set(chatId, conversation);
    }
    return conversation;
};

export const createMessageHandler = (tenant: Tenant) => {
    const { config } = tenant;
    const limiter = getLimiter(config);
    const calendar = getCalendar(config);

    return async (msg: Message) => {
        if (msg.from.includes('@g.us')) return;

        const text = msg.body.trim();
        if (!text) return;

        await limiter.schedule(async () => {
            const chat = await msg.getChat();

            try {
                await chat.sendSeen();
                await randomDelay();
                await chat.sendStateTyping();

                const selfServiced = await handleSelfServiceMessage(msg, config, calendar);
                if (selfServiced) return;

                const conversation = getConversation(msg.from, config, calendar);
                const reply = await conversation.send(text);

                await randomDelay(800, 2000);
                await msg.reply(reply);
            } catch (error: any) {
                console.error(`Error en el flujo del mensaje [${config.id}]:`, error.message);
                await msg.reply(
                    'Ocurrió un inconveniente técnico. Por favor intenta de nuevo en un momento.'
                );
            } finally {
                await chat.clearState();
            }
        });
    };
};
