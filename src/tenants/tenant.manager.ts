import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { Tenant, TenantConfig } from '../interfaces';
import { env } from '../config/env';

const tenantSchema = z.object({
    id: z.string().min(1),
    businessName: z.string().min(1),
    timezone: z.string().min(1),
    openHour: z.number().int().min(0).max(23),
    closeHour: z.number().int().min(0).max(24),
    slotIntervalMin: z.number().int().positive().default(60),
    appointmentDurationMin: z.number().int().positive().default(45),
    systemPrompt: z.string().optional().default(''),
    services: z
        .array(
            z.object({
                id: z.string().min(1),
                name: z.string().min(1),
                priceUsd: z.number().positive(),
                durationMin: z.number().int().positive(),
            })
        )
        .min(1),
    calendar: z.object({
        serviceAccountEmail: z.string().min(1),
        calendarId: z.string().min(1),
        credentialsPath: z.string().min(1),
    }),
    whatsapp: z.object({
        sessionId: z.string().min(1),
        allowedNumbers: z.array(z.string()).optional(),
        rateLimit: z.object({
            maxConcurrent: z.number().int().positive(),
            minTimeMs: z.number().int().positive(),
        }),
    }),
});

export type RawTenant = z.infer<typeof tenantSchema>;

const tenantsDir = path.resolve(process.cwd(), env.TENANTS_DIR);

const loadTenants = (): Tenant[] => {
    if (!fs.existsSync(tenantsDir)) {
        console.warn(`⚠️  Directorio de tenants no encontrado: ${tenantsDir}`);
        return [];
    }

    return fs
        .readdirSync(tenantsDir)
        .filter((file) => file.endsWith('.json'))
        .map((file) => {
            const raw = JSON.parse(
                fs.readFileSync(path.join(tenantsDir, file), 'utf-8')
            ) as unknown;

            const result = tenantSchema.safeParse(raw);
            if (!result.success) {
                console.error(`❌ Tenant inválido en ${file}:`, result.error.flatten());
                throw new Error(`Configuración de tenant inválida: ${file}`);
            }

            const config = result.data as TenantConfig;
            return { id: config.id, config };
        });
};

export class TenantManager {
    private tenants: Tenant[] = [];

    constructor() {
        this.tenants = loadTenants();
    }

    getAll(): Tenant[] {
        return this.tenants;
    }

    getById(id: string): Tenant | undefined {
        return this.tenants.find((t) => t.id === id);
    }

    resolveByWhatsApp(from: string): Tenant | undefined {
        const cleanFrom = from.split('@')[0];
        return (
            this.tenants.find((t) =>
                (t.config.whatsapp.allowedNumbers ?? []).includes(cleanFrom)
            ) ?? (this.tenants.length === 1 ? this.tenants[0] : undefined)
        );
    }
}
