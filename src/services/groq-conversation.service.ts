import Groq from 'groq-sdk';
import { CalendarService, TenantConfig, ToolCallResult } from '../interfaces';
import { buildSchedulingSystemPrompt } from '../prompts/scheduling.prompt';
import { env } from '../config/env';

export const TOOL_AVAILABLE_SLOTS = 'get_available_slots';
export const TOOL_BOOK = 'book_appointment';
export const TOOL_LIST = 'list_bookings';

export const buildTools = (): Groq.Chat.Completions.ChatCompletionTool[] => [
    {
        type: 'function',
        function: {
            name: TOOL_AVAILABLE_SLOTS,
            description:
                'Consulta los bloques de horario disponibles (libres) para una fecha concreta. Usa esto cuando el usuario pida horarios o disponibilidad, o para confirmar antes de agendar.',
            parameters: {
                type: 'object',
                properties: {
                    date: {
                        type: 'string',
                        description: 'Fecha en formato YYYY-MM-DD (p.ej. 2026-08-17)',
                    },
                },
                required: ['date'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: TOOL_BOOK,
            description:
                'Agenda (reserva) una cita en el calendario. Úsalo SOLO cuando el usuario haya confirmado día, hora, nombre, apellido y número de teléfono.',
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
                required: ['date', 'startHour', 'firstName', 'lastName', 'phone'],
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
];

export class GroqConversationService {
    private groq: Groq;
    private calendar: CalendarService;
    private history: Groq.Chat.Completions.ChatCompletionMessageParam[];

    constructor(tenant: TenantConfig, calendar: CalendarService) {
        this.groq = new Groq({ apiKey: env.GROQ_API_KEY });
        this.calendar = calendar;
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

    private async runTool(name: string, args: any): Promise<ToolCallResult> {
        switch (name) {
            case TOOL_AVAILABLE_SLOTS: {
                const slots = await this.calendar.getAvailableSlotsForDate(args.date);
                if (!slots.length) {
                    return { name, content: `No hay bloques disponibles para ${args.date}.` };
                }
                const list = slots
                    .map((s) => {
                        const pad = (n: number) => String(n).padStart(2, '0');
                        return `${pad(s.start.getHours())}:${pad(s.start.getMinutes())}-${pad(s.end.getHours())}:${pad(s.end.getMinutes())}`;
                    })
                    .join(', ');
                return { name, content: `Bloques libres para ${args.date}: ${list}` };
            }

            case TOOL_BOOK: {
                const result = await this.calendar.bookAppointment(
                    args.date,
                    args.startHour,
                    {
                        firstName: args.firstName,
                        lastName: args.lastName,
                        phone: args.phone,
                    },
                    args.notes
                );
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
                            `${b.date} ${String(b.startHour).padStart(2, '0')}:00 - ${b.customer.firstName} ${b.customer.lastName}`
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
