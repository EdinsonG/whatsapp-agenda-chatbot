import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
    GROQ_API_KEY: z.string().min(1, 'GROQ_API_KEY es obligatoria'),
    MODEL_NAME: z.string().min(1).default('llama-3.3-70b-versatile'),
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
