import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional().default(''),
    MODEL_NAME: z.string().min(1).default('gemini-3.6-flash'),
    PORT: z.coerce.number().int().positive().default(3000),
    TENANTS_DIR: z.string().min(1).default('src/tenants/tenants'),
    DEFAULT_TENANT: z.string().min(1).optional().default(''),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    console.error('❌ Variables de entorno inválidas:', parsed.error.flatten().fieldErrors);
    process.exit(1);
}

export const env = parsed.data;
