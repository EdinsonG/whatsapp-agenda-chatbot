import Bottleneck from 'bottleneck';
import { TenantConfig } from '../interfaces';

const limiters = new Map<string, Bottleneck>();

export const getLimiter = (tenant: TenantConfig): Bottleneck => {
    let limiter = limiters.get(tenant.id);
    if (!limiter) {
        limiter = new Bottleneck({
            maxConcurrent: tenant.whatsapp.rateLimit.maxConcurrent,
            minTime: tenant.whatsapp.rateLimit.minTimeMs,
        });
        limiters.set(tenant.id, limiter);
    }
    return limiter;
};

export const randomDelay = (minMs = 1000, maxMs = 3000) =>
    new Promise((resolve) =>
        setTimeout(resolve, minMs + Math.random() * (maxMs - minMs))
    );
