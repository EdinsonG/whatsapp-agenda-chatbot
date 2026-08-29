import { Client } from 'whatsapp-web.js';
import { SessionMonitorOptions } from '../interfaces';
import { logger } from '../config/logger';

export class SessionMonitor {
    private client: Client;
    private log = logger.child({ module: 'session-monitor' });
    private reconnectTimer?: ReturnType<typeof setTimeout>;
    private reconnectAttempts = 0;
    private destroyed = false;
    private options: Required<SessionMonitorOptions>;

    constructor(client: Client, options: SessionMonitorOptions = {}) {
        this.client = client;
        this.options = {
            maxReconnectAttempts: options.maxReconnectAttempts ?? 10,
            onDisconnected: options.onDisconnected ?? (() => {}),
            onReconnecting: options.onReconnecting ?? (() => {}),
            onReconnected: options.onReconnected ?? (() => {}),
            onFailed: options.onFailed ?? (() => {}),
        };

        this.client.on('disconnected', (reason) => {
            this.log.warn({ reason }, 'Sesión WhatsApp desconectada');
            this.options.onDisconnected();
            this.attemptReconnect();
        });

        this.client.on('browser_crash', (message) => {
            this.log.error({ message }, 'Browser crash');
            this.options.onDisconnected();
            this.attemptReconnect();
        });
    }

    private attemptReconnect(): void {
        if (this.destroyed) return;
        if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
            this.log.error(
                { maxAttempts: this.options.maxReconnectAttempts },
                'Máximo de intentos de reconexión alcanzado'
            );
            this.options.onFailed();
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(1000 * 2 ** (this.reconnectAttempts - 1), 60_000);
        this.log.info(
            { attempt: this.reconnectAttempts, max: this.options.maxReconnectAttempts, delaySec: delay / 1000 },
            'Intentando reconexión'
        );
        this.options.onReconnecting(this.reconnectAttempts);

        this.reconnectTimer = setTimeout(async () => {
            if (this.destroyed) return;
            try {
                await this.client.destroy();
                await this.client.initialize();
                this.log.info('Reconexión exitosa');
                this.reconnectAttempts = 0;
                this.options.onReconnected();
            } catch (error) {
                this.log.error({ err: error }, 'Error durante reconexión');
                this.attemptReconnect();
            }
        }, delay);
    }

    getReconnectAttempts(): number {
        return this.reconnectAttempts;
    }

    destroy(): void {
        this.destroyed = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
    }
}
