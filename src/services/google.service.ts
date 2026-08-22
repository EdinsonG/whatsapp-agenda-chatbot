import { generateText, tool } from 'ai';
import { z } from 'zod';
import { AIResponse, ScheduleIntent, TenantConfig } from '../interfaces';
import { buildSchedulingSystemPrompt } from '../prompts/scheduling.prompt';
import { getModel } from './google-ai.model';

export const SCHEDULE_TOOL_NAME = 'book_appointment';

const schedulingTools = {
    [SCHEDULE_TOOL_NAME]: tool({
        description:
            'Agenda una cita en el calendario. Úsalo solo cuando el cliente haya confirmado día, hora, servicio(s), nombre, apellido y número de teléfono.',
        inputSchema: z.object({
            date: z.string().describe('Fecha en formato YYYY-MM-DD'),
            startHour: z
                .number()
                .int()
                .describe('Hora de inicio en punto (ej. 9 = 09:00). Solo valores enteros.'),
            serviceIds: z
                .array(z.string())
                .describe(
                    'IDs de los servicios a agendar (p.ej. ["consulta-general", "limpieza-dental"]).'
                ),
            firstName: z.string().describe('Nombre del cliente'),
            lastName: z.string().describe('Apellido del cliente'),
            phone: z.string().describe('Número de teléfono del cliente'),
            notes: z.string().optional().describe('Notas opcionales de la cita'),
        }),
    }),
};

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
        const result = await generateText({
            model: getModel(),
            system: systemPrompt,
            prompt: userMessage,
            tools: schedulingTools,
            temperature: 0.6,
            maxOutputTokens: 900,
        });

        const call = result.toolCalls.find((c) => c.toolName === SCHEDULE_TOOL_NAME);
        const args = call ? (call as unknown as { input?: ScheduleIntent }).input : undefined;

        if (args) {
            const scheduleIntent = args;
            if (!Array.isArray(scheduleIntent.serviceIds)) {
                scheduleIntent.serviceIds = [];
            }
            return {
                content: 'Agendando tu cita...',
                scheduleIntent,
            };
        }

        return { content: result.text.trim() || 'Disculpa, no logré procesar tu mensaje.' };
    } catch (error: any) {
        const status = error?.statusCode ?? error?.status;
        if (status === 429) {
            return {
                content:
                    'Estoy recibiendo demasiadas solicitudes. Dame un segundo y vuelve a intentarlo, por favor.',
            };
        }
        console.error('Error en Google AI Service:', error?.message);
        return {
            content: 'Hubo un problema técnico de mi parte. Inténtalo de nuevo en un momento.',
        };
    }
};