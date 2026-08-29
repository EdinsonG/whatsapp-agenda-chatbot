import { initializeClients, destroyAllClients, getClients } from './client';
import { startHealthCheck } from './server';
import { restoreRemindersFromStore } from './services/reminder.scheduler';
import { setReminderSender } from './services/reminder-queue';
import { logger } from './config/logger';

const startBot = async () => {
    try {
        logger.info('Iniciando Bot de Agendamiento (Multitenant)');

        await restoreRemindersFromStore();
        startHealthCheck();

        const tenantClients = initializeClients();
        logger.info({ count: tenantClients.length }, 'Tenants configurados');

        setReminderSender(async (chatId, message) => {
            for (const entry of getClients().values()) {
                try {
                    await entry.client.sendMessage(chatId, message);
                    return;
                } catch {}
            }
            logger.warn({ chatId }, 'No se pudo enviar recordatorio: ningún cliente disponible');
        });

        for (const entry of tenantClients) {
            await entry.client.initialize();
        }
    } catch (error) {
        logger.fatal({ err: error }, 'Error crítico al inicializar');
        process.exit(1);
    }
};

const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Señal recibida. Cerrando limpiamente...');
    try {
        await destroyAllClients();
        logger.info('Bot cerrado limpiamente');
    } catch (error) {
        logger.error({ err: error }, 'Error durante el cierre');
    }
    process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

startBot();
