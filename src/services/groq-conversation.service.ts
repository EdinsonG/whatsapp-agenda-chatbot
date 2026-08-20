import Groq from 'groq-sdk';
import { CalendarService, Service, servicesTotalDuration, TenantConfig, ToolCallResult } from '../interfaces';
import { buildSchedulingSystemPrompt } from '../prompts/scheduling.prompt';
import { appointmentStore, normalizePhone } from './appointment.store';
import { env } from '../config/env';

export const TOOL_AVAILABLE_SLOTS = 'get_available_slots';
export const TOOL_BOOK = 'book_appointment';
export const TOOL_LIST = 'list_bookings';
export const TOOL_CANCEL = 'cancel_appointment';
export const TOOL_RESCHEDULE = 'reschedule_appointment';

export const buildTools = (): Groq.Chat.Completions.ChatCompletionTool[] => [
    {
        type: 'function',
        function: {
            name: TOOL_AVAILABLE_SLOTS,
            description:
                'Consulta los bloques de horario disponibles (libres) para una fecha y duración concretas. Usa esto cuando el usuario haya elegido servicio(s) y pida horarios, o para confirmar antes de agendar.',
            parameters: {
                type: 'object',
                properties: {
                    date: {
                        type: 'string',
                        description: 'Fecha en formato YYYY-MM-DD (p.ej. 2026-08-17)',
                    },
                    serviceIds: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'IDs de los servicios elegidos por el cliente (p.ej. ["consulta-general"]).',
                    },
                },
                required: ['date', 'serviceIds'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: TOOL_BOOK,
            description:
                'Agenda (reserva) una cita en el calendario. Úsalo SOLO cuando el usuario haya confirmado día, hora, servicio(s), nombre, apellido y número de teléfono.',
            parameters: {
                type: 'object',
                properties: {
                    date: {
                        type: 'string',
                        description: 'Fecha en formato YYYY-MM-DD',
                    },
                    startHour: {
                        type: 'integer',
                        description: 'Hora de inicio en punto (ej. 9 = 09:00). Solo enteros entre openHour y closeHour-1.',
                    },
                    serviceIds: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'IDs de los servicios a agendar (p.ej. ["limpieza-dental", "consulta-general"]).',
                    },
                    firstName: {
                        type: 'string',
                        description: 'Nombre del cliente',
                    },
                    lastName: {
                        type: 'string',
                        description: 'Apellido del cliente',
                    },
                    phone: {
                        type: 'string',
                        description: 'Número de teléfono del cliente',
                    },
                    notes: {
                        type: 'string',
                        description: 'Notas opcionales de la cita',
                    },
                },
                required: ['date', 'startHour', 'serviceIds', 'firstName', 'lastName', 'phone'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: TOOL_LIST,
            description: 'Lista las citas ya agendadas en esta sesión de prueba.',
            parameters: { type: 'object', properties: {} },
        },
    },
    {
        type: 'function',
        function: {
            name: TOOL_CANCEL,
            description:
                'Cancela una cita existente. Úsalo SOLO cuando el usuario quiera cancelar y haya proporcionado su número de cita (formato C-XXXXXX).',
            parameters: {
                type: 'object',
                properties: {
                    citaNumber: {
                        type: 'string',
                        description: 'Número de cita que el cliente recibió al agendar (formato C-XXXXXX).',
                    },
                },
                required: ['citaNumber'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: TOOL_RESCHEDULE,
            description:
                'Reagenda una cita existente a una nueva fecha y hora. Úsalo SOLO cuando el usuario quiera reagendar, haya dado su número de cita (formato C-XXXXXX) y una nueva fecha/hora libre.',
            parameters: {
                type: 'object',
                properties: {
                    citaNumber: {
                        type: 'string',
                        description: 'Número de cita que el cliente recibió al agendar (formato C-XXXXXX).',
                    },
                    date: {
                        type: 'string',
                        description: 'Nueva fecha en formato YYYY-MM-DD',
                    },
                    startHour: {
                        type: 'integer',
                        description: 'Nueva hora de inicio en punto (ej. 10 = 10:00).',
                    },
                },
                required: ['citaNumber', 'date', 'startHour'],
            },
        },
    },
];

export class GroqConversationService {
    private groq: Groq;
    private calendar: CalendarService;
    private config: TenantConfig;
    private history: Groq.Chat.Completions.ChatCompletionMessageParam[];
    private chatId: string;

    constructor(tenant: TenantConfig, calendar: CalendarService, chatId = '') {
        this.groq = new Groq({ apiKey: env.GROQ_API_KEY });
        this.calendar = calendar;
        this.config = tenant;
        this.chatId = chatId;
        this.history = [
            {
                role: 'system',
                content: [
                    buildSchedulingSystemPrompt(tenant),
                    tenant.systemPrompt,
                    'Eres el asistente de DEMO: usa las herramientas disponibles para consultar disponibilidad y agendar citas. Nunca inventes horarios: siempre consulta get_available_slots antes de confirmar.',
                ]
                    .filter(Boolean)
                    .join('\n'),
            },
        ];
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

    private async runTool(name: string, args: any): Promise<ToolCallResult> {
        switch (name) {
            case TOOL_AVAILABLE_SLOTS: {
                const serviceIds = args.serviceIds ?? [];
                const services = this.resolveServices(serviceIds);
                const durationMin =
                    servicesTotalDuration(this.config.services, serviceIds) ||
                    this.config.appointmentDurationMin;
                const slots = await this.calendar.getAvailableSlotsForDate(args.date, durationMin);
                if (!slots.length) {
                    return { name, content: `No hay bloques disponibles para ${args.date}.` };
                }
                const list = slots
                    .map((s) => {
                        const pad = (n: number) => String(n).padStart(2, '0');
                        return `${pad(s.start.getHours())}:${pad(s.start.getMinutes())}-${pad(s.end.getHours())}:${pad(s.end.getMinutes())}`;
                    })
                    .join(', ');
                const serviceText = services.length
                    ? ` (${services.map((s) => s.name).join(', ')} — ${durationMin} min)`
                    : ` (duración ${durationMin} min)`;
                return { name, content: `Bloques libres para ${args.date}${serviceText}: ${list}` };
            }

            case TOOL_BOOK: {
                const serviceIds = args.serviceIds ?? [];
                const services = this.resolveServices(serviceIds);
                const durationMin =
                    servicesTotalDuration(this.config.services, serviceIds) ||
                    this.config.appointmentDurationMin;
                const result = await this.calendar.bookAppointment(
                    args.date,
                    args.startHour,
                    {
                        firstName: args.firstName,
                        lastName: args.lastName,
                        phone: args.phone,
                    },
                    durationMin,
                    services,
                    args.notes
                );

                if (result.success && result.citaNumber) {
                    appointmentStore.add({
                        citaNumber: result.citaNumber,
                        chatId: this.chatId,
                        phone: args.phone,
                        businessName: this.config.businessName,
                        customer: {
                            firstName: args.firstName,
                            lastName: args.lastName,
                            phone: args.phone,
                        },
                        eventId: result.eventId,
                        date: args.date,
                        startHour: args.startHour,
                        durationMin,
                        services,
                        createdAt: new Date(),
                    });
                }

                return { name, content: result.message };
            }

            case TOOL_CANCEL: {
                const booking = this.findCita(args.citaNumber);
                if (!booking) {
                    return {
                        name,
                        content:
                            'El número de cita es incorrecto o no corresponde al teléfono registrado. No se pudo cancelar la cita.',
                    };
                }

                const ok = await this.calendar.cancelAppointment(booking.eventId ?? '');
                if (ok) {
                    appointmentStore.remove(booking.citaNumber);
                    return {
                        name,
                        content: `Tu cita ${booking.citaNumber} fue cancelada correctamente.`,
                    };
                }
                return { name, content: 'No pude cancelar la cita. Intentá nuevamente.' };
            }

            case TOOL_RESCHEDULE: {
                const booking = this.findCita(args.citaNumber);
                if (!booking) {
                    return {
                        name,
                        content:
                            'El número de cita es incorrecto o no corresponde al teléfono registrado. No se pudo reagendar la cita.',
                    };
                }

                const result = await this.calendar.rescheduleAppointment(
                    booking.eventId ?? '',
                    args.date,
                    args.startHour,
                    booking.durationMin,
                    booking.services
                );

                if (result.success) {
                    appointmentStore.update(booking.citaNumber, {
                        date: args.date,
                        startHour: args.startHour,
                    });
                }
                return { name, content: result.message };
            }

            case TOOL_LIST: {
                const bookings = (this.calendar as any).listBookings?.() ?? [];
                if (!bookings.length) {
                    return { name, content: 'No hay citas agendadas en esta sesión.' };
                }
                const list = bookings
                    .map(
                        (b: any) =>
                            `${b.date} ${String(b.startHour).padStart(2, '0')}:00 - ${b.customer.firstName} ${b.customer.lastName} (${b.services?.map((s: Service) => s.name).join(', ') ?? 'sin servicios'})`
                    )
                    .join('\n');
                return { name, content: `Citas agendadas:\n${list}` };
            }

            default:
                return { name, content: 'Herramienta desconocida.' };
        }
    }

    async send(userMessage: string): Promise<string> {
        this.history.push({ role: 'user', content: userMessage });

        for (let turn = 0; turn < 5; turn++) {
            const completion = await this.groq.chat.completions.create({
                model: env.MODEL_NAME,
                temperature: 0.6,
                max_tokens: 500,
                messages: this.history,
                tools: buildTools(),
                tool_choice: 'auto',
            });

            const message = completion.choices[0].message;

            const toolCalls = message.tool_calls ?? [];
            if (!toolCalls.length) {
                const reply = message.content?.trim() || 'Disculpa, no logré procesar tu mensaje.';
                this.history.push({ role: 'assistant', content: reply });
                return reply;
            }

            this.history.push(message);

            for (const call of toolCalls) {
                let args: any = {};
                try {
                    args = JSON.parse(call.function.arguments || '{}');
                } catch {
                    args = {};
                }
                const result = await this.runTool(call.function.name, args);
                this.history.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: result.content,
                });
            }
        }

        return 'La conversación está tardando demasiado. Intenta reformular tu mensaje.';
    }
}
