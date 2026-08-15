import { client } from './client';
import { startHealthCheck } from './server';
import { TenantManager } from './tenants/tenant.manager';

const startBot = async () => {
    try {
        const tenantManager = new TenantManager();
        console.log('--- Iniciando Bot de Agendamiento (Multitenant) ---');
        console.log(`📋 Tenants configurados: ${tenantManager.getAll().length}`);

        startHealthCheck();
        await client.initialize();
    } catch (error) {
        console.error('Error crítico al inicializar:', error);
        process.exit(1);
    }
};

startBot();
