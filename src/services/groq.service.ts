import Groq from 'groq-sdk';
import { AIResponse, ScheduleIntent, TenantConfig } from '../interfaces';
import { buildSchedulingSystemPrompt } from '../prompts/scheduling.prompt';
import { env } from '../config/env';

const groq = new Groq({ apiKey: env.GROQ_API_KEY });

export const SCHEDULE_TOOL_NAME = 'book_appointment';

const schedulingTools: Groq.Chat.Completions.ChatCompletionTool[] = [
    {
        type: 'function',
        function: {
            name: SCHEDULE_TOOL_NAME,
            description:
                'Agenda una cita en el calendario. Úsalo solo cuando el cliente haya confirmado día, hora, nombre, apellido y número de teléfono.',
            parameters: {
                type: 'object',
                properties: {
                    date: {
                        type: 'string',
                        description: 'Fecha en formato YYYY-MM-DD',
                    },
                    startHour: {
                        type: 'integer',
                        description: 'Hora de inicio en punto (ej. 9 = 09:00). Solo valores enteros.',
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
];

export const getTenantAIResponse = async (
    userMessage: string,
    tenant: TenantConfig,
    availableSlotsToday?: string[]
): Promise<AIResponse> => {
    const systemPrompt = [
        buildSchedulingSystemPrompt(tenant),
        tenant.systemPrompt,
        availableSlotsToday?.length
            ? `\n\n### HORARIOS DISPONIBLES HOY\n${availableSlotsToday.join(', ')}`
            : '',
    ]
        .filter(Boolean)
        .join('\n');

    try {
        const completion = await groq.chat.completions.create({
            model: env.MODEL_NAME,
            temperature: 0.6,
            max_tokens: 400,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage },
            ],
            tools: schedulingTools,
            tool_choice: 'auto',
        });

        const choice = completion.choices[0];
        const toolCall = choice.message.tool_calls?.[0];

        if (toolCall && toolCall.function.name === SCHEDULE_TOOL_NAME) {
            try {
                const args = JSON.parse(toolCall.function.arguments || '{}');
                return {
                    content: 'Agendando tu cita...',
                    scheduleIntent: args as ScheduleIntent,
                };
            } catch {
                return {
                    content:
                        choice.message.content || 'No pude entender los datos de la cita. ¿Podrías repetirlos?',
                };
            }
        }

        return { content: choice.message.content?.trim() || 'Disculpa, no logré procesar tu mensaje.' };
    } catch (error: any) {
        if (error.status === 429) {
            return { content: 'Estoy recibiendo demasiadas solicitudes. Dame un segundo y vuelve a intentarlo, por favor.' };
        }
        console.error('Error en Groq Service:', error.message);
        return { content: 'Hubo un problema técnico de mi parte. Inténtalo de nuevo en un momento.' };
    }
};
