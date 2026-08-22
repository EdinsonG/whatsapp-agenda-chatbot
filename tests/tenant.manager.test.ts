import { describe, it, expect } from 'vitest';
import { TenantManager } from '../src/tenants/tenant.manager';

describe('TenantManager', () => {
    const manager = new TenantManager();

    it('carga los tenants de demostración', () => {
        const ids = manager.getAll().map((t) => t.id).sort();
        expect(ids).toContain('demo-clinica');
        expect(ids).toContain('demo-barberia');
        expect(ids).toContain('demo-showcase');
    });

    it('getDefaultTenant devuelve el tenant marcado como por defecto', () => {
        expect(manager.getDefaultTenant()?.id).toBe('demo-showcase');
    });

    it('siempre resuelve un tenant para cualquier número de WhatsApp', () => {
        expect(manager.resolveByWhatsApp('000000000000@c.us')).toBeDefined();
        expect(manager.resolveByWhatsApp('+54 9 11 2222 3333@c.us')).toBeDefined();
    });

    it('resuelve por número permitido si está asignado', () => {
        expect(manager.resolveByWhatsApp('5493515550000@c.us')?.id).toBe('demo-showcase');
    });

    it('cae al tenant por defecto cuando el número no está asignado', () => {
        expect(manager.resolveByWhatsApp('111111111111@c.us')?.id).toBe('demo-showcase');
    });
});