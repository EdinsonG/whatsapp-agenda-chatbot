import { client } from './client';
import { startHealthCheck } from './server';
import { TenantManager } from './tenants/tenant.manager';
import { restoreRemindersFromStore } from './services/reminder.scheduler';

const startBot = async () => {
    try {
        const tenantManager = new TenantManager();
        console.log('--- Iniciando Bot de Agendamiento (Multitenant) ---');
        console.log(`📋 Tenants configurados: ${tenantManager.getAll().length}`);

        await restoreRemindersFromStore();
        startHealthCheck();
        await client.initialize();
    } catch (error) {
        console.error('Error crítico al inicializar:', error);
        process.exit(1);
    }
};

startBot();
