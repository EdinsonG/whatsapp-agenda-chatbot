import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { handleMessage } from './handlers/message.handler';
import { TenantManager } from './tenants/tenant.manager';

const tenantManager = new TenantManager();
const tenants = tenantManager.getAll();

const sessionId = tenants[0]?.config.whatsapp.sessionId || 'default-session';

export const client = new Client({
    authStrategy: new LocalAuth({ clientId: sessionId }),
    puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] },
});

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('Escanea el código QR de arriba para iniciar sesión.');
});

client.on('ready', () => {
    const names = tenants.map((t) => t.config.businessName).join(', ');
    console.log(`✅ Bot listo. Tenants cargados: ${names}`);
});

client.on('message', handleMessage);
