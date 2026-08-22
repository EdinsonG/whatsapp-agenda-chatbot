# WhatsApp Scheduling Bot 🤖📅

Chatbot de **WhatsApp multitenant** impulsado por IA (Google Gemma 4 / Gemini vía Vercel AI SDK) para la **gestión y agendamiento automático de citas en Google Calendar**.

Soporta **múltiples negocios/clients** (tenants) con configuración aislada: horarios, prompt de contexto, credenciales de Google Calendar y sesiones de WhatsApp, **sin tocar el código base**.

---

## 🚀 Instalación

Requisitos: **Node.js 18+**, **pnpm** (gestor de paquetes) y **npm**.

```bash
# 1. Instala pnpm (si no lo tienes)
npm install -g pnpm

# 2. Clona el repositorio
git clone <tu-repo> && cd rm-whats-bot

# 3. Instala dependencias (genera pnpm-lock.yaml)
pnpm install

# 4. Configura el entorno
cp .env.example .env   # y edítalo con tus valores
```

---

## 🔑 Configuración de variables de entorno (`.env`)

| Variable | Descripción | Ejemplo |
| :--- | :--- | :--- |
| `GOOGLE_GENERATIVE_AI_API_KEY` | API key de Google AI Studio (Gemma 4 / Gemini) | `AIza...` |
| `MODEL_NAME` | Modelo a usar | `gemini-3.6-flash` |
| `PORT` | Puerto del healthcheck | `3000` |
| `TENANTS_DIR` | Carpeta con los JSON de tenants | `src/tenants/tenants` |
| `DEFAULT_TENANT` | Tenant por defecto para números no asignados | `demo-showcase` |

> Los datos **por cliente** no van en `.env`: se definen en el JSON de cada tenant.

---

## 🏗️ Arquitectura

```
src/
├── index.ts                     # Bootstrap (healthcheck + cliente WhatsApp)
├── server.ts                    # Express: /health y /tenants
├── config/
│   └── env.ts                   # Validación de variables de entorno (zod)
├── core/
│   └── scheduling/
│       └── scheduling.rules.ts  # Lógica pura: slots, solapamiento, franjas (testeable)
├── tenants/
│   ├── types.ts                 # Tipos de TenantConfig
│   ├── tenant.manager.ts        # Carga + resolución multitenant
│   ├── tenants/*.json           # Configuración por cliente
│   └── credentials/*.json       # Service Account por cliente (gitignored)
├── services/
│   ├── google.service.ts          # Integración IA (Gemini + tool calling de agendamiento)
│   ├── google-conversation.service.ts # Conversación multi-turno con herramientas
│   ├── google-ai.model.ts         # Cliente compartido del modelo (@ai-sdk/google)
│   ├── appointment.store.ts       # Store persistente de citas (número C-XXXXXX)
│   ├── reminder.scheduler.ts      # Recordatorios 12h/2h antes de la cita
│   ├── google-calendar.service.ts # Disponibilidad + creación de eventos
│   └── limiter.service.ts       # Rate limiter (bottleneck) por tenant
├── handlers/
│   └── message.handler.ts       # Flujo de WhatsApp (typing + rate limit)
└── prompts/
    └── scheduling.prompt.ts     # System prompt parametrizado por tenant
tests/
└── scheduling.rules.test.ts     # Pruebas de solapamiento y franjas
```

### Reglas de negocio (núcleo)

- **Duración:** cada cita dura **45 minutos**.
- **Franjas:** inician en **bloques de 1 hora** en punto (08:00, 09:00, 10:00...).
- **Horario:** solo entre **08:00 y 18:00**.
- **Antisolapamiento:** se consulta `freebusy` del calendario en tiempo real antes de agendar.

---

## ▶️ Ejecución

```bash
pnpm run dev        # Desarrollo (nodemon + ts-node)
pnpm run build      # Compila a /dist
pnpm start          # Producción
pnpm test           # Corre las pruebas unitarias (Vitest)
pnpm cli            # Prueba conversacional con IA (Gemini)
```

Al iniciar por primera vez, escanea el **código QR** que aparece en la terminal con tu WhatsApp.

**Healthcheck:** `GET http://localhost:3000/health`
**Lista de tenants:** `GET http://localhost:3000/tenants`

---

## 👥 Cómo dar de alta un nuevo tenant

1. **Crea la credencial de Service Account** para el cliente:
   - En Google Cloud Console crea una *Service Account* con el rol **Calendario → Calendar API** (o editor del calendario).
   - Comparte el calendario con el `client_email` de la cuenta de servicio.
   - Descarga el JSON y guárdalo en `src/tenants/credentials/<tenant-id>-service-account.json`.

2. **Crea el JSON de configuración** en `src/tenants/tenants/<tenant-id>.json`:

   ```json
   {
     "id": "mi-cliente",
     "businessName": "Clínica Dental Sonrisa",
     "timezone": "America/Mexico_City",
     "openHour": 8,
     "closeHour": 18,
     "slotIntervalMin": 60,
     "appointmentDurationMin": 45,
     "systemPrompt": "Contexto extra del negocio...",
     "calendar": {
       "serviceAccountEmail": "mi-cliente@tu-proyecto.iam.gserviceaccount.com",
       "calendarId": "primary",
       "credentialsPath": "src/tenants/credentials/mi-cliente-service-account.json"
     },
     "whatsapp": {
       "sessionId": "mi-cliente",
       "allowedNumbers": ["5215500000000"],
       "rateLimit": { "maxConcurrent": 1, "minTimeMs": 2500 }
     }
   }
   ```

3. **Reinicia el bot.** El nuevo tenant se carga automáticamente desde `TENANTS_DIR`.

> Con **un solo tenant**, el bot lo usa por defecto para todos los números. Con **varios**, usa `allowedNumbers` para enrutar cada cliente a su negocio.

---

## 🧪 Pruebas

```bash
pnpm test
```

## 💬 Probar sin WhatsApp (`pnpm cli`)

Modo de prueba del flujo de agendamiento **sin WhatsApp ni Google Calendar** (usa un calendario simulado en memoria):

```
pnpm cli
```

Gemini interpreta la conversación natural y ejecuta herramientas (consultar disponibilidad, agendar, cancelar, reagendar, listar) contra el calendario simulado.

```
¿qué horarios tienes mañana?   → la IA consulta get_available_slots
quiero una cita el lunes a las 10 para Ana   → la IA agenda
lista                          → la IA lista las citas
```

> ⚠️ Requiere una `GOOGLE_GENERATIVE_AI_API_KEY` **válida** en tu `.env`. Genera una en https://aistudio.google.com/apikey y actualiza tu `.env`.

---

## 🛡️ Resiliencia

- **Rate limiting:** `bottleneck` por tenant (mitiga riesgo de ban en WhatsApp).
- **Simulación humana:** `sendStateTyping` + retardo natural antes de responder.
- **Healthcheck** `/health` para despliegues 24/7 e integración continua.
