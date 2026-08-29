import readline from 'readline';
import { tenantManager } from './tenants/tenant.manager';
import { MockCalendarService } from './services/mock-calendar.service';
import { GoogleConversationService } from './services/google-conversation.service';
import { MISSING_KEY_MESSAGE } from './services/google-ai.model';
import { env } from './config/env';

const tenant = tenantManager.getDefaultTenant() ?? tenantManager.getAll()[0];

if (!tenant) {
    console.error('❌ No hay tenants configurados en src/tenants/tenants/.');
    process.exit(1);
}

const { config } = tenant;
const calendar = new MockCalendarService(config);
const ai = new GoogleConversationService(config, calendar, '5493515551234@c.us');

console.log(`\n=== 🤖 ${config.businessName} — Asistente de citas (IA) ===`);
console.log(`Tenant: ${tenant.id} | Modelo: ${env.MODEL_NAME}`);
console.log('Calendario SIMULADO. La IA (Google Gemma 4) interpreta la conversación y agenda.\n');
console.log('Ejemplos: "¿qué horarios tienes mañana?", "quiero una cita el lunes a las 10", "lista"\n');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

let cliClosed = false;
rl.on('close', () => {
    cliClosed = true;
});

const ask = () => {
    if (cliClosed) return;
    rl.question('Tú: ', async (input) => {
        const text = input.trim();
        if (!text) return ask();

        if (/^(salir|exit|quit|chao|adios)$/i.test(text)) {
            console.log('   👋 ¡Hasta luego!');
            rl.close();
            return;
        }

        try {
            console.log('   ...escribiendo');
            const reply = await ai.send(text);
            console.log(`\n   🤖 ${reply}\n`);
        } catch (error: any) {
            console.log('\n   ⚠️  No pude conectar con Google AI para interpretar tu mensaje.');
            console.log(
                error?.message === MISSING_KEY_MESSAGE
                    ? `   ${MISSING_KEY_MESSAGE}`
                    : `   Error: ${error?.message ?? 'desconocido'}`
            );
            console.log('');
        }
        ask();
    });
};

ask();
