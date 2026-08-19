import readline from 'readline';
import { TenantManager } from './tenants/tenant.manager';
import { MockCalendarService } from './services/mock-calendar.service';
import { parseCommand } from './core/nlp/nlp-parser';
import { Service, servicesTotalDuration } from './interfaces';

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
console.log('Para agendar se solicitan SIEMPRE: nombre, apellido, servicio(s), hora de cita y número de teléfono.\n');
console.log('Ejemplos:');
console.log('  "¿Qué horarios tienes mañana?"');
console.log('  "Quiero agendar una cita para el lunes a las 10"');
console.log('  "Agenda una cita mañana a las 9 para Ana García 3515551234"');
console.log('  "lista" / "salir"\n');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

const ask = (question: string): Promise<string> =>
    new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));

const printServices = (): void => {
    console.log('   Nuestros servicios:');
    config.services.forEach((s, i) =>
        console.log(`     ${i + 1}. ${s.name} — $${s.priceUsd} USD (${s.durationMin} min)`)
    );
};

const selectServices = async (): Promise<string[]> => {
    printServices();
    const answer = await ask('   ¿Qué servicio(s) querés? (ej. "1" o "1,3"): ');
    const ids = answer
        .split(',')
        .map((x) => parseInt(x.trim(), 10))
        .filter((n) => !Number.isNaN(n) && n >= 1 && n <= config.services.length)
        .map((n) => config.services[n - 1].id);
    return [...new Set(ids)];
};

const collectIdentity = async (parsed: ReturnType<typeof parseCommand>) => {
    let firstName: string | undefined;
    let lastName: string | undefined = parsed.lastName;
    let phone: string | undefined = parsed.phone;

    if (parsed.customerName) {
        const parts = parsed.customerName.split(/\s+/);
        firstName = parts[0];
        lastName = parts.slice(1).join(' ') || lastName;
    }

    if (!firstName) firstName = await ask('   Tu nombre: ');
    if (!lastName) lastName = await ask('   Tu apellido: ');
    if (!phone) phone = await ask('   Tu número de teléfono: ');

    return { firstName, lastName, phone };
};

const showSlots = async (date: string, durationMin: number): Promise<boolean> => {
    const slots = await calendar.getAvailableSlotsForDate(date, durationMin);
    if (!slots.length) {
        console.log(`   Lo siento, no hay bloques disponibles para el ${date} (duración ${durationMin} min).`);
        console.log('');
        return false;
    }
    console.log(`   Para el ${date} (${durationMin} min) tengo disponibles:`);
    slots.forEach((s) => console.log(`     • ${formatSlot(s)}`));
    console.log('');
    return true;
};

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
            printServices();
            console.log('   ¿Te gustaría agendar una cita? Necesito tu nombre, apellido, el servicio y tu teléfono.');
            console.log('');
            return Promise.resolve(true);
        }

        case 'slots': {
            return selectServices().then(async (serviceIds) => {
                if (!serviceIds.length) {
                    console.log('   No seleccionaste ningún servicio válido. 😅');
                    console.log('');
                    return true;
                }
                const durationMin = servicesTotalDuration(config.services, serviceIds);
                let date = parsed.date;
                if (!date) {
                    date = await ask('   ¿Para qué día te gustaría ver horarios? (YYYY-MM-DD): ');
                    if (!date) return true;
                }
                await showSlots(date, durationMin);
                return true;
            });
        }

        case 'book': {
            return collectIdentity(parsed).then(async (customer) => {
                const serviceIds = await selectServices();
                if (!serviceIds.length) {
                    console.log('   No seleccionaste ningún servicio válido. 😅');
                    console.log('');
                    return true;
                }
                const services: Service[] = serviceIds
                    .map((id) => config.services.find((s) => s.id === id))
                    .filter((s): s is Service => Boolean(s));
                const durationMin = servicesTotalDuration(config.services, serviceIds);

                let date = parsed.date;
                if (!date) {
                    date = await ask('   ¿Para qué día te gustaría agendar? (YYYY-MM-DD): ');
                    if (!date) return true;
                }

                const hasSlots = await showSlots(date, durationMin);
                if (!hasSlots) return true;

                let hour = parsed.startHour;
                if (hour !== undefined && !(await isHourAvailable(date, durationMin, hour))) {
                    hour = undefined;
                }
                if (hour === undefined) {
                    const answer = await ask('   ¿A qué hora? (0-23): ');
                    hour = parseInt(answer, 10);
                    if (Number.isNaN(hour)) {
                        console.log('   No elegiste una hora válida. Recordá: servicio, día, hora, nombre, apellido y teléfono.');
                        console.log('');
                        return true;
                    }
                }

                return calendar
                    .bookAppointment(date, hour, customer, durationMin, services)
                    .then((result) => {
                        console.log(
                            result.success
                                ? `   ✅ ${result.message}`
                                : `   ❌ ${result.message}`
                        );
                        console.log('');
                        return true;
                    });
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
                        `     • ${b.date} ${String(b.startHour).padStart(2, '0')}:00 — ${b.customer.firstName} ${b.customer.lastName} (${b.customer.phone}) — ${b.services.map((s) => s.name).join(', ') || 'sin servicios'}`
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

const isHourAvailable = async (
    date: string,
    durationMin: number,
    hour: number
): Promise<boolean> => {
    const slots = await calendar.getAvailableSlotsForDate(date, durationMin);
    return slots.some((s) => s.start.getHours() === hour);
};

const run = async () => {
    for await (const line of rl) {
        const shouldContinue = await respond(line);
        if (!shouldContinue) break;
    }
    rl.close();
};

run();