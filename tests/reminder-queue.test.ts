import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ReminderQueue, PendingReminder } from '../src/services/reminder-queue';

describe('ReminderQueue', () => {
    let queue: ReminderQueue;
    let tmpFile: string;

    beforeEach(() => {
        tmpFile = path.join(os.tmpdir(), `reminders-test-${Date.now()}.json`);
        queue = new ReminderQueue(tmpFile);
    });

    afterEach(() => {
        queue.clear();
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    });

    it('agenda recordatorios pendientes', () => {
        const futureDate = new Date(Date.now() + 24 * 3600000);
        const date = futureDate.toISOString().slice(0, 10);
        const startHour = futureDate.getHours() + 2;

        queue.schedule({
            chatId: '5493515551234@c.us',
            businessName: 'Test Business',
            date,
            startHour,
            customer: { firstName: 'Juan', lastName: 'Pérez', phone: '3515551234' },
            services: [{ id: 'corte', name: 'Corte', priceUsd: 10, durationMin: 30 }],
        });

        expect(queue.size()).toBeGreaterThan(0);
        const content = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
        expect(content.length).toBeGreaterThan(0);
        expect(content[0].chatId).toBe('5493515551234@c.us');
        expect(content[0].businessName).toBe('Test Business');
    });

    it('cancela recordatorios por fecha y hora', () => {
        const futureDate = new Date(Date.now() + 24 * 3600000);
        const date = futureDate.toISOString().slice(0, 10);
        const startHour = 10;

        queue.schedule({
            chatId: '5493515551234@c.us',
            businessName: 'Test',
            date,
            startHour,
            customer: { firstName: 'Ana', lastName: 'García', phone: '3515559999' },
            services: [],
        });

        expect(queue.size()).toBeGreaterThan(0);
        queue.cancel(date, startHour, '5493515551234@c.us');
        expect(queue.size()).toBe(0);
    });

    it('limpia todos los recordatorios', () => {
        const futureDate = new Date(Date.now() + 48 * 3600000);
        const date = futureDate.toISOString().slice(0, 10);

        queue.schedule({
            chatId: '5493515551234@c.us',
            businessName: 'Test',
            date,
            startHour: 10,
            customer: { firstName: 'X', lastName: 'Y', phone: '123' },
            services: [],
        });

        queue.schedule({
            chatId: '5493515559999@c.us',
            businessName: 'Test',
            date,
            startHour: 11,
            customer: { firstName: 'A', lastName: 'B', phone: '456' },
            services: [],
        });

        expect(queue.size()).toBe(4);
        queue.clear();
        expect(queue.size()).toBe(0);
        const content = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
        expect(content.length).toBe(0);
    });

    it('carga recordatorios desde disco', () => {
        const reminder: PendingReminder = {
            id: 'test-chat:2026-12-31:10:12',
            chatId: 'test-chat',
            businessName: 'Test',
            date: '2026-12-31',
            startHour: 10,
            leadHours: 12,
            message: 'Test message',
            scheduledAt: new Date(Date.now() + 86400000).toISOString(),
            createdAt: new Date().toISOString(),
        };
        fs.writeFileSync(tmpFile, JSON.stringify([reminder], null, 2), 'utf-8');

        const loaded = new ReminderQueue(tmpFile);
        expect(loaded.size()).toBe(1);
    });

    it('no agenda recordatorios para fechas pasadas', () => {
        queue.schedule({
            chatId: '5493515551234@c.us',
            businessName: 'Test',
            date: '2020-01-01',
            startHour: 10,
            customer: { firstName: 'X', lastName: 'Y', phone: '123' },
            services: [],
        });

        expect(queue.size()).toBe(0);
    });
});
