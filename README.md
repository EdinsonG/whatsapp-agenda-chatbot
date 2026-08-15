# WhatsApp Scheduling Bot 🤖📅

Chatbot de **WhatsApp multitenant** impulsado por IA (Groq / Llama 3.3) para la **gestión y agendamiento automático de citas en Google Calendar**.

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
| `GROQ_API_KEY` | API key de Groq Cloud | `gsk_...` |
| `MODEL_NAME` | Modelo de Groq a usar | `llama-3.3-70b-versatile` |
| `PORT` | Puerto del healthcheck | `3000` |
| `TENANTS_DIR` | Carpeta con los JSON de tenants | `src/tenants/tenants` |

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
│   ├── groq.service.ts          # Integración IA (tool calling de agendamiento)
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
pnpm cli            # Prueba conversacional con IA (Groq)
pnpm cli:nlp        # Prueba conversacional sin IA (parser local)
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

Hay **dos modos** para probar el flujo de agendamiento **sin WhatsApp ni Google Calendar** (ambos usan un calendario simulado en memoria):

### Modo con IA (Groq) — `pnpm cli`

```
pnpm cli
```

Groq interpreta la conversación natural y ejecuta herramientas (consultar disponibilidad, agendar, listar) contra el calendario simulado.

```
¿qué horarios tienes mañana?   → la IA consulta get_available_slots
quiero una cita el lunes a las 10 para Ana   → la IA agenda
lista                          → la IA lista las citas
```

> ⚠️ Requiere una `GROQ_API_KEY` **válida** en tu `.env`. Si da `403`, genera una nueva en https://console.groq.com/keys y actualiza tu `.env`.

### Modo sin IA (parser local) — `pnpm cli:nlp`

```
pnpm cli:nlp
```

Interpreta frases con reglas locales (sin conexión ni key): hoy/mañana/día de la semana, horas en punto, nombre tras "para". Útil si aún no tienes key de Groq.

Cubren la lógica de negocio pura (sin red): generación de franjas de 45m/1h, validación de horario 08:00–18:00 y detección de solapamientos.

---

## 🛡️ Resiliencia

- **Rate limiting:** `bottleneck` por tenant (mitiga riesgo de ban en WhatsApp).
- **Simulación humana:** `sendStateTyping` + retardo natural antes de responder.
- **Healthcheck** `/health` para despliegues 24/7 e integración continua.
