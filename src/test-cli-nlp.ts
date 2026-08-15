import readline from 'readline';
import { TenantManager } from './tenants/tenant.manager';
import { MockCalendarService } from './services/mock-calendar.service';
import { parseCommand } from './core/nlp/nlp-parser';

const tenantManager = new TenantManager();
const tenant = tenantManager.getAll()[0];

if (!tenant) {
    console.error('❌ No hay tenants configurados en src/tenants/tenants/.');
    process.exit(1);
}

const { config } = tenant;
const calendar = new MockCalendarService(config);

const formatSlot = (slot: { start: Date; end: Date }): string => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const s = slot.start;
    const e = slot.end;
    return `${pad(s.getHours())}:${pad(s.getMinutes())} - ${pad(e.getHours())}:${pad(e.getMinutes())}`;
};

console.log(`\n=== 🤖 ${config.businessName} — Asistente de citas (sin IA) ===`);
console.log('Calendario SIMULADO. Interpreta frases con reglas locales (sin conexión).\n');
console.log('Ejemplos:');
console.log('  "¿Qué horarios tienes mañana?"');
console.log('  "Quiero agendar una cita para el lunes a las 10"');
console.log('  "Agenda una cita mañana a las 9 para Ana García"');
console.log('  "lista" / "salir"\n');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

const respond = (line: string): Promise<boolean> => {
    const input = line.trim();
    if (!input) return Promise.resolve(true);

    if (/^(salir|exit|quit|chao|adios)$/i.test(input)) {
        console.log('   👋 ¡Hasta luego! Que tengas un excelente día.');
        return Promise.resolve(false);
    }

    const parsed = parseCommand(input, new Date());

    switch (parsed.intent) {
        case 'greeting': {
            console.log(`   ¡Hola! Soy el asistente de ${config.businessName}. 😊`);
            console.log('   ¿Te gustaría agendar una cita? Puedo decirte los horarios disponibles.');
            console.log('');
            return Promise.resolve(true);
        }

        case 'slots': {
            const date = parsed.date ?? new Date().toISOString().slice(0, 10);
            return calendar.getAvailableSlotsForDate(date).then((slots) => {
                if (!slots.length) {
                    console.log(`   Lo siento, no hay bloques disponibles para el ${date}.`);
                } else {
                    console.log(`   Para el ${date} tengo disponibles:`);
                    slots.forEach((s) => console.log(`     • ${formatSlot(s)}`));
                    console.log('   ¿Cuál te conviene?');
                }
                console.log('');
                return true;
            });
        }

        case 'book': {
            const date = parsed.date;
            const hour = parsed.startHour;

            if (!date) {
                console.log('   ¿Para qué día te gustaría agendar?');
                console.log('');
                return Promise.resolve(true);
            }
            if (hour === undefined) {
                return calendar.getAvailableSlotsForDate(date).then((slots) => {
                    console.log('   ¿A qué hora? Estos son los bloques que tengo:');
                    slots.forEach((s) => console.log(`     • ${formatSlot(s)}`));
                    console.log('');
                    return true;
                });
            }

            const name = parsed.customerName ?? 'Cliente';
            return calendar.bookAppointment(date, hour, name).then((result) => {
                console.log(result.success ? `   ✅ ${result.message}` : `   ❌ ${result.message}`);
                console.log('');
                return true;
            });
        }

        case 'list': {
            const bookings = calendar.listBookings();
            if (!bookings.length) {
                console.log('   Aún no tienes citas agendadas en esta sesión.');
            } else {
                console.log('   Tus citas agendadas:');
                bookings.forEach((b) =>
                    console.log(
                        `     • ${b.date} ${String(b.startHour).padStart(2, '0')}:00 — ${b.customerName}`
                    )
                );
            }
            console.log('');
            return Promise.resolve(true);
        }

        default: {
            console.log('   No estoy seguro de haber entendido. 😅');
            console.log('   Puedes preguntarme por "horarios", pedir "agendar una cita" con día y hora, o escribir "lista".');
            console.log('');
            return Promise.resolve(true);
        }
    }
};

const run = async () => {
    for await (const line of rl) {
        const shouldContinue = await respond(line);
        if (!shouldContinue) break;
    }
    rl.close();
};

run();
