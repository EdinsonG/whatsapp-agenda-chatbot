export interface Service {
    id: string;
    name: string;
    priceUsd: number;
    durationMin: number;
}

export const servicesTotalDuration = (
    services: Service[],
    serviceIds: string[]
): number =>
    serviceIds.reduce((total, id) => {
        const service = services.find((s) => s.id === id);
        return service ? total + service.durationMin : total;
    }, 0);

export interface TenantConfig {
    id: string;
    businessName: string;
    timezone: string;
    openHour: number;
    closeHour: number;
    slotIntervalMin: number;
    appointmentDurationMin: number;
    systemPrompt: string;
    isDefault?: boolean;
    services: Service[];
    calendar: {
        serviceAccountEmail: string;
        calendarId: string;
        credentialsPath: string;
    };
    whatsapp: {
        sessionId: string;
        allowedNumbers?: string[];
        rateLimit: {
            maxConcurrent: number;
            minTimeMs: number;
        };
    };
}

export interface Tenant {
    id: string;
    config: TenantConfig;
}