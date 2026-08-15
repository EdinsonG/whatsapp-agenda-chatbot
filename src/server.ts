import express from 'express';
import { env } from './config/env';
import { TenantManager } from './tenants/tenant.manager';

const app = express();
app.use(express.json());

export const startHealthCheck = () => {
    const tenantManager = new TenantManager();

    app.get('/health', (req, res) => {
        res.status(200).json({
            status: 'ok',
            uptime: process.uptime(),
            tenants: tenantManager.getAll().length,
        });
    });

    app.get('/tenants', (req, res) => {
        res.status(200).json(
            tenantManager.getAll().map((t) => ({
                id: t.id,
                businessName: t.config.businessName,
            }))
        );
    });

    app.listen(env.PORT, () => {
        console.log(`Servidor de monitoreo corriendo en el puerto ${env.PORT}`);
    });
};
