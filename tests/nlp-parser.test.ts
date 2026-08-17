import { describe, it, expect } from 'vitest';
import { parseCommand } from '../src/core/nlp/nlp-parser';

const NOW = new Date('2026-08-17T10:00:00'); // lunes

describe('parseCommand - intención', () => {
    it('detecta saludo', () => {
        expect(parseCommand('hola', NOW).intent).toBe('greeting');
        expect(parseCommand('buenas tardes', NOW).intent).toBe('greeting');
    });

    it('detecta petición de disponibilidad', () => {
        expect(parseCommand('¿qué horarios tienes?', NOW).intent).toBe('slots');
        expect(parseCommand('muéstrame los bloques libres', NOW).intent).toBe('slots');
    });

    it('detecta agendamiento', () => {
        const r = parseCommand('quiero agendar una cita para mañana a las 10', NOW);
        expect(r.intent).toBe('book');
    });

    it('detecta lista de citas', () => {
        expect(parseCommand('lista', NOW).intent).toBe('list');
        expect(parseCommand('¿qué citas tengo?', NOW).intent).toBe('list');
    });

    it('devuelve unknown para texto no relacionado', () => {
        expect(parseCommand('el clima está raro', NOW).intent).toBe('unknown');
    });
});

describe('parseCommand - fecha', () => {
    it('mañana -> día siguiente', () => {
        const r = parseCommand('cita para mañana a las 9', NOW);
        expect(r.date).toBe('2026-08-18');
    });

    it('pasado mañana -> dos días después', () => {
        const r = parseCommand('cita para pasado mañana a las 9', NOW);
        expect(r.date).toBe('2026-08-19');
    });

    it('hoy -> mismo día', () => {
        const r = parseCommand('cita hoy a las 9', NOW);
        expect(r.date).toBe('2026-08-17');
    });

    it('día de la semana -> próximo lunes', () => {
        const r = parseCommand('cita para el lunes a las 9', NOW);
        expect(r.date).toBe('2026-08-24');
    });

    it('fecha ISO explícita', () => {
        const r = parseCommand('cita el 2026-09-01 a las 9', NOW);
        expect(r.date).toBe('2026-09-01');
    });
});

describe('parseCommand - hora', () => {
    it('a las N (hora entera)', () => {
        expect(parseCommand('cita mañana a las 10', NOW).startHour).toBe(10);
    });

    it('hora con PM (tarde)', () => {
        expect(parseCommand('cita mañana a las 3 pm', NOW).startHour).toBe(15);
    });

    it('hora con AM', () => {
        expect(parseCommand('cita mañana a las 9 am', NOW).startHour).toBe(9);
    });

    it('sin hora -> undefined', () => {
        expect(parseCommand('quiero una cita', NOW).startHour).toBeUndefined();
    });
});

describe('parseCommand - nombre del cliente', () => {
    it('extrae nombre tras "para"', () => {
        const r = parseCommand('agenda una cita mañana a las 9 para Ana García', NOW);
        expect(r.customerName).toBe('Ana García');
    });

    it('no extrae nombre si no se indica', () => {
        const r = parseCommand('agenda una cita mañana a las 9', NOW);
        expect(r.customerName).toBeUndefined();
    });
});

describe('parseCommand - teléfono', () => {
    it('extrae teléfono al final de la frase y lo excluye del nombre', () => {
        const r = parseCommand('agenda una cita mañana a las 9 para Ana García 3515551234', NOW);
        expect(r.customerName).toBe('Ana García');
        expect(r.phone).toBe('3515551234');
    });

    it('extrae teléfono con prefijo +, espacios y guiones', () => {
        const r = parseCommand('agenda una cita para Juan Pérez +54 9 351 555-1234', NOW);
        expect(r.customerName).toBe('Juan Pérez');
        expect(r.phone).toBe('+5493515551234');
    });

    it('no extrae teléfono si no se indica', () => {
        const r = parseCommand('agenda una cita mañana a las 9 para Ana García', NOW);
        expect(r.phone).toBeUndefined();
    });
});
