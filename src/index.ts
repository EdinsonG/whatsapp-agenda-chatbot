import { client } from './client';
import { startHealthCheck } from './server';
import { TenantManager } from './tenants/tenant.manager';
import { restoreRemindersFromStore } from './services/reminder.scheduler';
import { SessionMonitor } from './services/session-monitor';

const startBot = async () => {
    try {
        const tenantManager = new TenantManager();
        console.log('--- Iniciando Bot de Agendamiento (Multitenant) ---');
        console.log(`📋 Tenants configurados: ${tenantManager.getAll().length}`);

        await restoreRemindersFromStore();
        startHealthCheck();

        const monitor = new SessionMonitor(client, {
            onDisconnected: () => {
                console.warn('⚠️ Sesión perdida. Intentando reconectar...');
            },
            onReconnecting: (attempt) => {
                console.log(`🔄 Reconexión ${attempt}/10...`);
            },
            onReconnected: () => {
                console.log('✅ Sesión reconectada. Recordatorios reprogramados.');
                restoreRemindersFromStore();
            },
            onFailed: () => {
                console.error(
                    '❌ No se pudo reconectar la sesión de WhatsApp. Se requiere reinicio manual.'
                );
            },
        });

        await client.initialize();
    } catch (error) {
        console.error('Error crítico al inicializar:', error);
        process.exit(1);
    }
};

startBot();
