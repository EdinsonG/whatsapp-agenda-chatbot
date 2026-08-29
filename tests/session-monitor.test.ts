import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { SessionMonitor } from '../src/services/session-monitor';

class MockClient extends EventEmitter {
    failReconnect = false;
    async destroy() {}
    async initialize() {
        if (this.failReconnect) throw new Error('Reconnect failed');
    }
}

describe('SessionMonitor', () => {
    let monitor: SessionMonitor;
    let client: MockClient;

    beforeEach(() => {
        client = new MockClient();
        monitor = new SessionMonitor(client as any, {
            maxReconnectAttempts: 3,
            onDisconnected: vi.fn(),
            onReconnecting: vi.fn(),
            onReconnected: vi.fn(),
            onFailed: vi.fn(),
        });
    });

    afterEach(() => {
        monitor?.destroy();
    });

    it('inicia con 0 intentos de reconexión', () => {
        expect(monitor.getReconnectAttempts()).toBe(0);
    });

    it('detecta desconexión e incrementa intentos', () => {
        client.emit('disconnected', 'NAVIGATION');
        expect(monitor.getReconnectAttempts()).toBe(1);
    });

    it('detecta browser crash e incrementa intentos', () => {
        client.emit('browser_crash', 'page crashed');
        expect(monitor.getReconnectAttempts()).toBe(1);
    });

    it('no intenta reconectar si fue destruido', () => {
        monitor.destroy();
        client.emit('disconnected', 'NAVIGATION');
        expect(monitor.getReconnectAttempts()).toBe(0);
    });

    it('destroy limpia timers pendientes', () => {
        vi.useFakeTimers();
        client.emit('disconnected', 'NAVIGATION');
        monitor.destroy();
        vi.advanceTimersByTime(65000);
        vi.useRealTimers();
    });
});
