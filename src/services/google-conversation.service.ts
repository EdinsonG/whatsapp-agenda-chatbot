import { generateText, tool, ModelMessage, stepCountIs, TextPart } from 'ai';
import { z } from 'zod';
import { CalendarService, Service, servicesTotalDuration, TenantConfig } from '../interfaces';
import { buildSchedulingSystemPrompt } from '../prompts/scheduling.prompt';
import { appointmentStore, normalizePhone } from './appointment.store';
import { getModel, MISSING_KEY_MESSAGE } from './google-ai.model';
import { logger } from '../config/logger';

export const TOOL_AVAILABLE_SLOTS = 'get_available_slots';
export const TOOL_BOOK = 'book_appointment';
export const TOOL_LIST = 'list_bookings';
export const TOOL_CANCEL = 'cancel_appointment';
export const TOOL_RESCHEDULE = 'reschedule_appointment';

const pad = (n: number) => String(n).padStart(2, '0');

export class GoogleConversationService {
    private calendar: CalendarService;
    private config: TenantConfig;
    private history: ModelMessage[];
    private chatId: string;
    private systemPrompt: string;

    constructor(tenant: TenantConfig, calendar: CalendarService, chatId = '') {
        this.calendar = calendar;
        this.config = tenant;
        this.chatId = chatId;
        this.systemPrompt = [
            buildSchedulingSystemPrompt(tenant),
            tenant.systemPrompt,
            'Eres el asistente de DEMO: usa las herramientas disponibles para consultar disponibilidad y agendar citas. Nunca inventes horarios: siempre consulta get_available_slots antes de confirmar.',
        ]
            .filter(Boolean)
            .join('\n');
        this.history = [];
    }

    private resolveServices(serviceIds: string[] = []): Service[] {
        return serviceIds
            .map((id) => this.config.services.find((s) => s.id === id))
            .filter((s): s is Service => Boolean(s));
    }

    private findCita(citaNumber: string) {
        const booking = appointmentStore.findByNumber(citaNumber);
        if (!booking) return undefined;
        if (
            this.chatId !== booking.chatId &&
            normalizePhone(this.chatId) !== normalizePhone(booking.phone)
        ) {
            return undefined;
        }
        return booking;
    }

    private buildTools() {
        const config = this.config;

        const availableSlotsTool = tool({
            description:
                'Consulta los bloques de horario disponibles (libres) para una fecha y duración concretas. Usa esto cuando el usuario haya elegido servicio(s) y pida horarios, o para confirmar antes de agendar.',
            inputSchema: z.object({
                date: z.string().describe('Fecha en formato YYYY-MM-DD (p.ej. 2026-08-17)'),
                serviceIds: z
                    .array(z.string())
                    .describe(
                        'IDs de los servicios elegidos por el cliente (p.ej. ["consulta-general"]).'
                    ),
            }),
            execute: async ({ date, serviceIds }) => {
                const services = this.resolveServices(serviceIds ?? []);
                const durationMin =
                    servicesTotalDuration(config.services, serviceIds ?? []) ||
                    config.appointmentDurationMin;
                const slots = await this.calendar.getAvailableSlotsForDate(date, durationMin);
                if (!slots.length) {
                    return `No hay bloques disponibles para ${date}.`;
                }
                const list = slots
                    .map((s) => `${pad(s.start.getHours())}:${pad(s.start.getMinutes())}-${pad(s.end.getHours())}:${pad(s.end.getMinutes())}`)
                    .join(', ');
                const serviceText = services.length
                    ? ` (${services.map((s) => s.name).join(', ')} — ${durationMin} min)`
                    : ` (duración ${durationMin} min)`;
                return `Bloques libres para ${date}${serviceText}: ${list}`;
            },
        });

        const bookTool = tool({
            description:
                'Agenda (reserva) una cita en el calendario. Úsalo SOLO cuando el usuario haya confirmado día, hora, servicio(s), nombre, apellido y número de teléfono.',
            inputSchema: z.object({
                date: z.string().describe('Fecha en formato YYYY-MM-DD'),
                startHour: z
                    .number()
                    .int()
                    .describe('Hora de inicio en punto (ej. 9 = 09:00). Solo enteros entre openHour y closeHour-1.'),
                serviceIds: z
                    .array(z.string())
                    .describe('IDs de los servicios a agendar (p.ej. ["limpieza-dental", "consulta-general"]).'),
                firstName: z.string().describe('Nombre del cliente'),
                lastName: z.string().describe('Apellido del cliente'),
                phone: z.string().describe('Número de teléfono del cliente'),
                notes: z.string().optional().describe('Notas opcionales de la cita'),
            }),
            execute: async ({ date, startHour, serviceIds, firstName, lastName, phone, notes }) => {
                const ids = serviceIds ?? [];
                const services = this.resolveServices(ids);
                const durationMin =
                    servicesTotalDuration(config.services, ids) || config.appointmentDurationMin;
                const result = await this.calendar.bookAppointment(
                    date,
                    startHour,
                    { firstName, lastName, phone },
                    durationMin,
                    services,
                    notes
                );

                if (result.success && result.citaNumber) {
                    appointmentStore.add({
                        citaNumber: result.citaNumber,
                        chatId: this.chatId,
                        phone,
                        businessName: config.businessName,
                        customer: { firstName, lastName, phone },
                        eventId: result.eventId,
                        date,
                        startHour,
                        durationMin,
                        services,
                        createdAt: new Date(),
                    });
                }

                return result.message;
            },
        });

        const listTool = tool({
            description: 'Lista las citas ya agendadas en esta sesión de prueba.',
            inputSchema: z.object({}),
            execute: async () => {
                const bookings = (this.calendar as any).listBookings?.() ?? [];
                if (!bookings.length) {
                    return 'No hay citas agendadas en esta sesión.';
                }
                const list = bookings
                    .map(
                        (b: any) =>
                            `${b.date} ${String(b.startHour).padStart(2, '0')}:00 - ${b.customer.firstName} ${b.customer.lastName} (${b.services?.map((s: Service) => s.name).join(', ') ?? 'sin servicios'})`
                    )
                    .join('\n');
                return `Citas agendadas:\n${list}`;
            },
        });

        const cancelTool = tool({
            description:
                'Cancela una cita existente. Úsalo SOLO cuando el usuario quiera cancelar y haya proporcionado su número de cita (formato C-XXXXXX).',
            inputSchema: z.object({
                citaNumber: z
                    .string()
                    .describe('Número de cita que el cliente recibió al agendar (formato C-XXXXXX).'),
            }),
            execute: async ({ citaNumber }) => {
                const booking = this.findCita(citaNumber);
                if (!booking) {
                    return 'El número de cita es incorrecto o no corresponde al teléfono registrado. No se pudo cancelar la cita.';
                }

                const ok = await this.calendar.cancelAppointment(booking.eventId ?? '');
                if (ok) {
                    appointmentStore.remove(booking.citaNumber);
                    return `Tu cita ${booking.citaNumber} fue cancelada correctamente.`;
                }
                return 'No pude cancelar la cita. Intentá nuevamente.';
            },
        });

        const rescheduleTool = tool({
            description:
                'Reagenda una cita existente a una nueva fecha y hora. Úsalo SOLO cuando el usuario quiera reagendar, haya dado su número de cita (formato C-XXXXXX) y una nueva fecha/hora libre.',
            inputSchema: z.object({
                citaNumber: z
                    .string()
                    .describe('Número de cita que el cliente recibió al agendar (formato C-XXXXXX).'),
                date: z.string().describe('Nueva fecha en formato YYYY-MM-DD'),
                startHour: z.number().int().describe('Nueva hora de inicio en punto (ej. 10 = 10:00).'),
            }),
            execute: async ({ citaNumber, date, startHour }) => {
                const booking = this.findCita(citaNumber);
                if (!booking) {
                    return 'El número de cita es incorrecto o no corresponde al teléfono registrado. No se pudo reagendar la cita.';
                }

                const result = await this.calendar.rescheduleAppointment(
                    booking.eventId ?? '',
                    date,
                    startHour,
                    booking.durationMin,
                    booking.services
                );

                if (result.success) {
                    appointmentStore.update(booking.citaNumber, { date, startHour });
                }
                return result.message;
            },
        });

        return {
            [TOOL_AVAILABLE_SLOTS]: availableSlotsTool,
            [TOOL_BOOK]: bookTool,
            [TOOL_LIST]: listTool,
            [TOOL_CANCEL]: cancelTool,
            [TOOL_RESCHEDULE]: rescheduleTool,
        };
    }

    async send(userMessage: string): Promise<string> {
        this.history.push({ role: 'user', content: userMessage });

        try {
            const result = await generateText({
                model: getModel(),
                system: this.systemPrompt,
                messages: this.history,
                tools: this.buildTools(),
                stopWhen: stepCountIs(5),
                temperature: 0.6,
                maxOutputTokens: 1500,
            });

            this.history.push(...result.response.messages);

            const reply = result.text.trim();
            if (reply) return reply;

            const lastStep = result.steps[result.steps.length - 1];
            const stepText = lastStep?.content
                .filter((part): part is TextPart => part.type === 'text')
                .map((part) => part.text)
                .join('')
                .trim();
            if (stepText) {
                this.history.push({ role: 'assistant', content: stepText });
                return stepText;
            }

            logger.warn(
                {
                    finishReason: result.finishReason,
                    steps: result.steps.length,
                    toolCalls: result.toolCalls.length,
                    usage: result.usage,
                },
                'Respuesta vacía del modelo'
            );
            return 'Disculpa, no logré procesar tu mensaje. ¿Podrías reformularlo?';
        } catch (error: any) {
            if ((error?.statusCode ?? error?.status) === 429) {
                return 'Estoy recibiendo demasiadas solicitudes. Dame un segundo y vuelve a intentarlo, por favor.';
            }
            if (error?.message === MISSING_KEY_MESSAGE) throw error;
            logger.error({ err: error }, 'Error en Google Conversation Service');
            return 'Hubo un problema técnico de mi parte. Inténtalo de nuevo en un momento.';
        }
    }
}