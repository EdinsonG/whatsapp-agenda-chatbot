export interface TenantConfig {
    id: string;
    businessName: string;
    timezone: string;
    openHour: number;
    closeHour: number;
    slotIntervalMin: number;
    appointmentDurationMin: number;
    systemPrompt: string;
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