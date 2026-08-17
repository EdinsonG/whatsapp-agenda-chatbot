import { Intent, ParsedCommand } from '../../interfaces';

const DAY_NAMES: Record<string, number> = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
    dom: 0,
    lun: 1,
    mar: 2,
    mie: 3,
    mier: 3,
    jue: 4,
    vie: 5,
    sab: 6,
};

const normalize = (s: string): string =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const parseDate = (text: string, now = new Date()): string | undefined => {
    const t = normalize(text);
    const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

    const target = new Date(now);

    if (/pasado manana/.test(t)) {
        target.setDate(target.getDate() + 2);
    } else if (/manana/.test(t)) {
        target.setDate(target.getDate() + 1);
    } else if (/\bhoy\b/.test(t)) {
        target.setDate(target.getDate());
    } else {
        let matched = false;
        for (const [name, day] of Object.entries(DAY_NAMES)) {
            if (new RegExp(`\\b${name}\\b`).test(t)) {
                let diff = (day - target.getDay() + 7) % 7;
                if (diff === 0) diff = 7;
                target.setDate(target.getDate() + diff);
                matched = true;
                break;
            }
        }
        if (!matched) return undefined;
    }

    const pad = (n: number) => String(n).padStart(2, '0');
    return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
};

const parseHour = (text: string): number | undefined => {
    const t = normalize(text);
    const match =
        t.match(/a\s+las\s+(\d{1,2})(?:\s*(am|pm))?/) ||
        t.match(/(\d{1,2})\s*(?::00|horas|hrs)?\s*(am|pm)\b/) ||
        t.match(/(\d{1,2})\s*horas/);
    if (!match) return undefined;

    let hour = parseInt(match[1], 10);
    const suffix = (match[2] || '').toLowerCase();
    const isPm = suffix === 'pm' || /de la tarde|de la noche/.test(t);
    const isAm = suffix === 'am' || /de la manana/.test(t);

    if (isPm && hour < 12) hour += 12;
    if (isAm && hour === 12) hour = 0;
    return hour;
};

const parseCustomerName = (text: string): string | undefined => {
    const m = text.match(/(?:para|a nombre de|de parte de)\s+(.+)$/i);
    if (!m) return undefined;
    return m[1].replace(/\s*\+?\d[\d\s().-]*$/i, '').trim();
};

const parsePhone = (text: string): string | undefined => {
    const t = text
        .replace(/\d{4}-\d{2}-\d{2}/g, ' ')
        .replace(/\b\d{1,2}\s*(?:hs\.?|horas)\b/gi, ' ')
        .replace(/\b\d{1,2}\s*(?:am|pm)\b/gi, ' ');
    const match = t.match(/(?:\+?\d[\d\s().-]{7,})/);
    if (!match) return undefined;
    const digits = match[0].replace(/[^\d+]/g, '');
    return digits.length >= 7 ? digits : undefined;
};

const BOOK_WORDS = /(agendar|reservar|pedir|sacar|programar|agenda|reserva|cita|turno)/;

export const parseCommand = (raw: string, now?: Date): ParsedCommand => {
    const t = normalize(raw);

    if (/^(\s*(hola|buenas|buenos dias|buenas tardes|hey|que tal|saludos|hi)\b)/.test(t)) {
        return { intent: 'greeting' };
    }

    if (/(hola|buenas|hey|que tal)\b/.test(t) && /(cita|agendar|reservar|horario)/.test(t)) {
        return { intent: 'slots', message: '¡Claro! ¿Para qué día te gustaría agendar?' };
    }

    if (/\b(lista|mis citas|reservas|que citas|tengo agendado)\b/.test(t)) {
        return { intent: 'list' };
    }

    if (/(disponibilidad|horarios|bloques|libre|disponible|slots|que horas tienes|cuando)/.test(t)) {
        return {
            intent: 'slots',
            date: parseDate(t, now),
        };
    }

    if (BOOK_WORDS.test(t)) {
        return {
            intent: 'book',
            date: parseDate(t, now),
            startHour: parseHour(t),
            customerName: parseCustomerName(raw),
            phone: parsePhone(raw),
        };
    }

    return { intent: 'unknown' };
};
