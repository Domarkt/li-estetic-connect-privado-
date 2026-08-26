# AGENTS.md — Guía para asistentes de IA (Codex / ChatGPT / otros)

> Este archivo lo lee **Codex automáticamente** al abrir el repo. Contiene TODO lo que un
> asistente necesita para avanzar el proyecto **sin romper producción**. Léelo completo
> antes de tocar código. Está en español porque el equipo y los mensajes al usuario son en
> español (RD).

---

## 1. Qué es este proyecto

**Li Estetic Connect**: software de gestión (pacientes, citas, fichas clínicas, facturación,
inventario, seguimiento y portal del paciente) para **Li Estetic Center**, una cadena de
**3 estéticas en República Dominicana**. Está **en producción y en uso real** — hay dinero
(cobros) y datos clínicos de pacientes de por medio. Cada cambio debe ser cuidadoso.

Aislamiento de datos **por sucursal** (branch): un usuario solo ve lo de su sucursal; el
admin ve todas. Roles: `ADMIN`, `RECEPCIONISTA`, `ESTETICISTA`, y `PACIENTE` (portal aparte).

---

## 2. Estructura del repo (monorepo)

```
li-estetic-connect/
├── server/          # API — Node + Express + TypeScript + Prisma (ESM)
│   ├── src/modules/ # cada dominio: patients, appointments, invoices, catalog, followup, portal, points…
│   ├── src/middleware/  # auth (requireStaff/requireRole/branchScope), error handler
│   ├── src/utils/   # crypto (cifrado PII), trato (Sr./Sra.), etc.
│   └── prisma/
│       ├── schema.prisma
│       ├── migrations_manual/   # ← migraciones SQL a mano (ver §5). MUY IMPORTANTE.
│       └── seed.ts
├── web/             # Frontend — React 18 + TS + Vite + Tailwind + React Router 6
│   ├── src/pages/   # una carpeta por área (agenda, billing, patients, seguimiento…)
│   ├── src/lib/     # api.ts (fetch), types.ts, hooks
│   └── public/      # PWA: manifest.webmanifest, sw.js, iconos, li-logo.png
├── README.md  DEPLOY.md  SECURITY.md   # documentación existente (léela también)
```

El `web` habla con el `server` por `/api`. La API vive en **otro dominio** (Render) que el
web (Cloudflare Pages); el frontend usa rutas relativas vía `web/src/lib/api.ts`.

---

## 3. Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, React Router 6.
- **Backend**: Node (v20+), Express, TypeScript, **ESM** (módulos ES, no CommonJS).
- **ORM/DB**: Prisma + **PostgreSQL** (gestionado por **Supabase**, ref `suedjotznakkkgwftmnd`).
- **Auth**: JWT con rol y sucursal. Portal de paciente separado del login del personal.
- **PWA**: instalable (manifest + service worker en `web/public/`).

---

## 4. Comandos (verificar SIEMPRE antes de dar por hecho un cambio)

Este equipo **no despliega para probar**: se valida con build y typecheck localmente.

**Backend** (`cd server`):
```bash
npx tsc --noEmit        # typecheck (obligatorio tras cualquier cambio en server)
npm run build           # compila a dist/ (tsc)
npx prisma generate     # tras CUALQUIER cambio en schema.prisma
npm test                # vitest (hay tests en *.test.ts)
npm run dev             # servidor local (tsx watch) — necesita .env con DATABASE_URL
```

**Frontend** (`cd web`):
```bash
npm run build           # tsc -b && vite build (obligatorio tras cambios en web)
npm run dev             # Vite dev server
npm run preview         # sirve el build (para probar la PWA)
```

Regla: **un cambio no está listo hasta que `npx tsc --noEmit` (server) y `npm run build`
(web) pasan limpio.** `noUnusedLocals`/`noUnusedParameters` están activos: no dejes
imports ni variables sin usar o el build de web falla.

---

## 5. ⚠️ DESPLIEGUE Y MIGRACIONES — LO MÁS IMPORTANTE

El flujo de producción es:

```
git push (a GitHub Domarkt/li-estetic-connect-privado-, rama main)
        │
        ├─►  BACKEND: el dueño hace "Manual Deploy" en Render (NO es automático)
        └─►  WEB:     Cloudflare Pages reconstruye SOLO (automático al hacer push)
```

- **La base de datos es Supabase.** Prisma **NO** corre `migrate deploy` en el arranque.
- Las migraciones se escriben **a mano** como SQL en `server/prisma/migrations_manual/NNN_*.sql`
  (numeradas: 001, 002, … la última va >030).

### La regla de oro (esto ya tumbó la facturación una vez):

> **Cada columna/tabla nueva del `schema.prisma` DEBE existir en Supabase ANTES de desplegar
> el código que la usa.** Si despliegas código cuyo Prisma Client espera una columna que aún
> no está en la base, TODA consulta a esa tabla revienta con "error interno".

Flujo correcto para un cambio de base de datos:
1. Editas `schema.prisma`.
2. Creas `server/prisma/migrations_manual/NNN_descripcion.sql` con `ALTER TABLE … ADD COLUMN IF NOT EXISTS …`
   (idempotente, no destructivo).
3. `cd server && npx prisma generate`.
4. **El dueño** ejecuta ese SQL en **Supabase → SQL Editor** (proyecto `suedjotznakkkgwftmnd`).
5. Solo DESPUÉS: push + Manual Deploy en Render.

Como asistente **no tienes acceso a Supabase ni a Render**: cuando un cambio necesite migración,
**entrega el SQL exacto listo para pegar** y dile claramente al usuario: "corre esto en Supabase
antes de hacer Manual Deploy". Nunca asumas que la columna ya existe.

`.env` del backend (en Render, no en el código): `DATABASE_URL` (pooler 6543), `DIRECT_URL`
(5432), `ENCRYPTION_KEY`, `CRON_SECRET`, credenciales de correo (Brevo/SMTP), etc.

---

## 6. Reglas de seguridad y privacidad (NO negociables)

- **Nunca** pongas secretos en el código (claves, tokens, contraseñas). Van solo en variables
  de entorno de Render. `ENCRYPTION_KEY` **no se cambia jamás** (descifra datos existentes).
- **PII cifrada**: `cedula` y `address` del paciente se guardan **cifrados** (AES-256-GCM) vía
  `server/src/utils/crypto.ts` y `patients.crypto.ts` (`encryptPatientWrite` / `decryptPatientPII`).
  Escribe/lee PII SIEMPRE por esas funciones, nunca por SQL directo ni en claro.
- **Aislamiento por sucursal**: usa los middlewares `branchScope` / `assertBranchAccess`. Una
  esteticista/recepción solo opera sobre su sucursal; el admin sobre todas.
- Los correos base de admin `dominicanmarketingrd@gmail.com` e `infodomarkt@gmail.com` **no se
  pueden borrar ni desactivar**.
- El login **nunca** precarga credenciales.
- Mensajes salientes al paciente (WhatsApp/correo) van con **formalidad Sr./Sra.** según el
  sexo (helper `tratoFormal` en `server/src/utils/trato.ts`) y con la sucursal + su ubicación
  (`sucursalLabel`). Los envíos masivos/cron van con guardas (secreto `CRON_SECRET`).
- Ver `SECURITY.md` para el detalle.

---

## 7. Convenciones de código

- **Server es ESM**: los imports internos llevan extensión **`.js`** aunque el archivo sea `.ts`
  (ej. `import { prisma } from '../../db/prisma.js';`). Respétalo o no compila/arranca.
- Tras cambiar `schema.prisma` → `npx prisma generate` sí o sí.
- El **dinero pendiente de un plan** vive en `Treatment.balance` (fuente única); los cargos
  sueltos en `ChargeItem` (estado `PENDIENTE_FACTURAR`). No inventes saldos paralelos.
- Al facturar un combo/paquete/servicio se crea el plan del paciente con
  `createTreatmentFromCatalog` (`server/src/modules/patients/areas.service.ts`).
- Comisiones/puntos: `points.service.ts` / `points.automation.ts` (8% de ventas del mes +
  bono por tier). La venta se atribuye por `invoice.therapistId`.
- Los efectos secundarios **posteriores** a crear una factura (atribución, portal, seguimiento,
  WhatsApp) van en `try/catch`: **jamás** deben tumbar el cobro ya registrado (evita cobros
  duplicados por reintento). Mantén ese patrón.
- Comentarios y textos de UI en **español** (RD). Imita el estilo del archivo que edites.
- Flags de función: se reutiliza la tabla `Integration` (kind='flag', status CONNECTED/DISCONNECTED).
- Fotos del catálogo son data URIs pesados: `GET /catalog` solo las manda con `?images=1`.

### Portal del paciente — acceso
- El paciente entra con **correo O celular** como usuario y su **número de teléfono** (solo
  dígitos) como contraseña inicial; puede cambiarla en "Mi Ficha". Login en
  `POST /auth/patient/login` (campo `usuario`), busca entre cuentas de portal activas.
- **No requiere correo**: recepción da el acceso desde la ficha con "Dar acceso al portal"
  (`POST /patients/:id/ficha/send-to-patient`) — crea la cuenta con el teléfono y entrega el
  acceso por WhatsApp/QR (y correo si lo tiene). También se activa al pagar.
- **Restablecer contraseña** (recepción/admin): `POST /patients/:id/portal-reset` la devuelve
  al teléfono. **Ver el portal como el paciente** (admin, para diagnosticar):
  `POST /patients/:id/portal-preview` → abre `/portal?preview=<token>`. Ambos quedan en auditoría.

---

## 8. Flujo de trabajo con Git

- Rama principal: **`main`** (produce el deploy). Para cambios grandes, trabaja en una rama
  y abre PR; para arreglos pequeños que el dueño revisa, commits directos también se usan.
- Mensajes de commit: **en español**, concisos, explicando el porqué. Ejemplo del historial:
  `fix: cobro nunca 500 tras crear factura` / `perf: acelera lista de pacientes`.
- No hagas `push --force` a `main`. No borres historial.
- Tras el push, **recuérdale al dueño** qué debe hacer: (a) ¿hay SQL para correr en Supabase?,
  (b) Manual Deploy en Render si tocaste `server/`. El web se reconstruye solo.

---

## 9. Checklist antes de entregar un cambio

- [ ] `cd server && npx tsc --noEmit` pasa (si tocaste server).
- [ ] `cd web && npm run build` pasa (si tocaste web).
- [ ] `npx prisma generate` corrido (si tocaste schema).
- [ ] Si agregaste columnas/tablas: SQL de migración creado en `migrations_manual/` y entregado
      al usuario para correr en Supabase **antes** del deploy.
- [ ] Sin secretos en el código. PII cifrada por las funciones correctas.
- [ ] Le dije al usuario, en español: qué migración correr y si necesita Manual Deploy en Render.

---

## 10. Punteros rápidos

| Necesito… | Mira… |
|---|---|
| Cómo se cobra / factura | `server/src/modules/invoices/invoices.routes.ts` |
| Planes, áreas, sesiones del paciente | `server/src/modules/patients/areas.service.ts` |
| Cifrado de PII | `server/src/utils/crypto.ts`, `patients.crypto.ts` |
| Auth / roles / sucursal | `server/src/middleware/auth.ts` |
| Seguimiento / cuentas por cobrar | `server/src/modules/followup/followup.routes.ts` |
| Tipos y llamadas del frontend | `web/src/lib/types.ts`, `web/src/lib/api.ts` |
| Despliegue detallado | `DEPLOY.md` |
| Seguridad | `SECURITY.md` |
