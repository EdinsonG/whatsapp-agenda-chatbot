import express, { Request, Response, NextFunction } from 'express';
import { env } from './config/env';
import { tenantManager } from './tenants/tenant.manager';
import { logger } from './config/logger';

const app = express();
app.use(express.json());

const requireApiKey = (req: Request, res: Response, next: NextFunction): void => {
    if (!env.API_KEY) return next();
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${env.API_KEY}`) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    next();
};

export const startHealthCheck = () => {

    app.get('/health', (req, res) => {
        res.status(200).json({
            status: 'ok',
            uptime: process.uptime(),
            tenants: tenantManager.getAll().length,
        });
    });

    app.get('/tenants', requireApiKey, (req, res) => {
        res.status(200).json(
            tenantManager.getAll().map((t) => ({
                id: t.id,
                businessName: t.config.businessName,
            }))
        );
    });

    app.listen(env.PORT, () => {
        logger.info({ port: env.PORT }, 'Servidor de monitoreo corriendo');
    });
};
