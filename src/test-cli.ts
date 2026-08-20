import readline from 'readline';
import { TenantManager } from './tenants/tenant.manager';
import { MockCalendarService } from './services/mock-calendar.service';
import { GroqConversationService } from './services/groq-conversation.service';

const tenantManager = new TenantManager();
const tenant = tenantManager.getDefaultTenant() ?? tenantManager.getAll()[0];

if (!tenant) {
    console.error('❌ No hay tenants configurados en src/tenants/tenants/.');
    process.exit(1);
}

const { config } = tenant;
const calendar = new MockCalendarService(config);
const ai = new GroqConversationService(config, calendar, '5493515551234@c.us');

console.log(`\n=== 🤖 ${config.businessName} — Asistente de citas (IA) ===`);
console.log(`Tenant: ${tenant.id} | Modelo: ${process.env.MODEL_NAME || 'default'}`);
console.log('Calendario SIMULADO. La IA (Groq) interpreta la conversación y agenda.\n');
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
            const status = error?.status;
            console.log('\n   ⚠️  No pude conectar con Groq para interpretar tu mensaje.');
            console.log(
                status === 403
                    ? '   Tu GROQ_API_KEY no es válida (403). Genera una nueva en https://console.groq.com/keys y actualízala en tu .env'
                    : `   Error: ${error?.message ?? 'desconocido'}`
            );
            console.log('   También puedes probar la versión sin IA con: pnpm cli:nlp\n');
        }
        ask();
    });
};

ask();
