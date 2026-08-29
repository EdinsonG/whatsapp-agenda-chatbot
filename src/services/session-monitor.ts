import { Client } from 'whatsapp-web.js';
import { SessionMonitorOptions } from '../interfaces';

export class SessionMonitor {
    private client: Client;
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
            console.warn(`⚠️ Sesión WhatsApp desconectada: ${reason}`);
            this.options.onDisconnected();
            this.attemptReconnect();
        });

        this.client.on('browser_crash', (message) => {
            console.error(`💥 Browser crash: ${message}`);
            this.options.onDisconnected();
            this.attemptReconnect();
        });
    }

    private attemptReconnect(): void {
        if (this.destroyed) return;
        if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
            console.error(
                `❌ Máximo de intentos de reconexión alcanzado (${this.options.maxReconnectAttempts}). Se requiere reinicio manual.`
            );
            this.options.onFailed();
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(1000 * 2 ** (this.reconnectAttempts - 1), 60_000);
        console.log(
            `🔄 Reconexión ${this.reconnectAttempts}/${this.options.maxReconnectAttempts} en ${delay / 1000}s...`
        );
        this.options.onReconnecting(this.reconnectAttempts);

        this.reconnectTimer = setTimeout(async () => {
            if (this.destroyed) return;
            try {
                await this.client.destroy();
                await this.client.initialize();
                console.log('✅ Reconexión exitosa.');
                this.reconnectAttempts = 0;
                this.options.onReconnected();
            } catch (error) {
                console.error('Error durante reconexión:', error);
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
