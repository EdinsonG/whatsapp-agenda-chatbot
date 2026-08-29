import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { tenantManager } from './tenants/tenant.manager';
import { createMessageHandler } from './handlers/message.handler';
import { SessionMonitor } from './services/session-monitor';
import { createTenantLogger } from './config/logger';

export interface TenantClient {
    tenantId: string;
    client: Client;
    monitor: SessionMonitor;
}

const clients = new Map<string, TenantClient>();

export const getClients = () => clients;

export const getClient = (tenantId: string) => clients.get(tenantId);

export const initializeClients = (): TenantClient[] => {
    const tenants = tenantManager.getAll();
    const result: TenantClient[] = [];

    for (const tenant of tenants) {
        const log = createTenantLogger(tenant.id);
        const sessionId = tenant.config.whatsapp.sessionId;
        const client = new Client({
            authStrategy: new LocalAuth({ clientId: sessionId }),
            puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] },
        });

        const handler = createMessageHandler(tenant);
        client.on('message', handler);

        client.on('qr', (qr) => {
            console.log(`\n📱 QR para ${tenant.config.businessName} (${tenant.id}):`);
            qrcode.generate(qr, { small: true });
            console.log('Escanea el código QR de arriba para iniciar sesión.\n');
        });

        client.on('ready', () => {
            log.info('Tenant listo');
        });

        const monitor = new SessionMonitor(client, {
            onDisconnected: () => {
                log.warn('Sesión desconectada');
            },
            onReconnected: () => {
                log.info('Sesión reconectada');
            },
            onFailed: () => {
                log.error('No se pudo reconectar. Se requiere reinicio.');
            },
        });

        const entry: TenantClient = { tenantId: tenant.id, client, monitor };
        clients.set(tenant.id, entry);
        result.push(entry);
    }

    return result;
};

export const destroyAllClients = async (): Promise<void> => {
    for (const [id, entry] of clients.entries()) {
        try {
            entry.monitor.destroy();
            await entry.client.destroy();
            createTenantLogger(id).info('Cliente destruido');
        } catch (error) {
            createTenantLogger(id).error({ err: error }, 'Error destruyendo cliente');
        }
    }
    clients.clear();
};
