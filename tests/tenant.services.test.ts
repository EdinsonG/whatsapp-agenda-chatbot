import { describe, it, expect } from 'vitest';
import { servicesTotalDuration, Service } from '../src/interfaces';

const services: Service[] = [
    { id: 'a', name: 'Consulta', priceUsd: 30, durationMin: 30 },
    { id: 'b', name: 'Limpieza', priceUsd: 50, durationMin: 45 },
    { id: 'c', name: 'Endodoncia', priceUsd: 200, durationMin: 90 },
];

describe('servicesTotalDuration', () => {
    it('suma la duración de los servicios seleccionados', () => {
        expect(servicesTotalDuration(services, ['a'])).toBe(30);
        expect(servicesTotalDuration(services, ['a', 'b'])).toBe(75);
        expect(servicesTotalDuration(services, ['a', 'b', 'c'])).toBe(165);
    });

    it('ignora ids de servicios inexistentes', () => {
        expect(servicesTotalDuration(services, ['a', 'inexistente'])).toBe(30);
        expect(servicesTotalDuration(services, ['inexistente'])).toBe(0);
    });

    it('devuelve 0 con selección vacía', () => {
        expect(servicesTotalDuration(services, [])).toBe(0);
    });
});
