import pino from 'pino';

export const logger = pino({
    level: process.env.LOG_LEVEL ?? 'info',
    transport:
        process.env.NODE_ENV !== 'production'
            ? { target: 'pino/file', options: { destination: 1 } }
            : undefined,
    formatters: {
        level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
});

export const createTenantLogger = (tenantId: string) =>
    logger.child({ tenant: tenantId });
