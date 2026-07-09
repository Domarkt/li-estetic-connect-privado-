# Despliegue — Li Estetic Connect

Guía para sacar el proyecto a producción. La base de datos es **Supabase** (PostgreSQL gestionado); solo desplegamos **API + Web** en contenedores.

---

## Arquitectura

```
   navegador  ──►  web (nginx :80)  ──/api──►  server (Node :4000)  ──►  Supabase (PostgreSQL)
                   sirve React            proxy interno              pooler 6543 / directa 5432
```

- `web` sirve el frontend compilado y hace **proxy de `/api`** al backend (mismo origen → sin problemas de CORS).
- `server` es la API Express. No se expone al exterior; solo `web` la alcanza por la red interna de Docker.

---

## 1. Requisitos

- Docker + Docker Compose en el servidor (VPS/EC2/etc.).
- El proyecto Supabase ya creado (ref `suedjotznakkkgwftmnd`) con las tablas cargadas.
- Un dominio apuntando al servidor (para HTTPS).

## 2. Variables de entorno

Copia y edita el `.env` del backend:

```bash
cd server
cp .env.example .env
```

Rellena en `server/.env` (valores de **producción**):

```ini
# Supabase (Settings → Database → Connection string)
DATABASE_URL="postgresql://postgres.suedjotznakkkgwftmnd:TU_PASSWORD@aws-1-us-east-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://postgres.suedjotznakkkgwftmnd:TU_PASSWORD@aws-1-us-east-2.pooler.supabase.com:5432/postgres"

NODE_ENV=production
PORT=4000
CORS_ORIGIN=https://tu-dominio.com

# Genera secretos FUERTES (obligatorio en producción):
#   openssl rand -base64 48
JWT_SECRET=<secreto-aleatorio-de-48+-caracteres>
JWT_PATIENT_SECRET=<otro-secreto-distinto-de-48+-caracteres>
JWT_EXPIRES=12h
```

> El backend **no arranca en producción** si los secretos JWT son débiles o los de desarrollo (validado en `src/config/env.ts`).

## 3. Migrar la base (una sola vez)

Aplica el esquema a Supabase:

```bash
docker compose -f docker-compose.prod.yml run --rm server npx prisma db push
```

Sembrar datos demo es **opcional** y **no se recomienda en producción** (crea usuarios/contraseñas demo). Para empezar limpio, crea la primera Administradora manualmente (ver abajo).

### Crear la primera Administradora (sin seed)

```bash
docker compose -f docker-compose.prod.yml run --rm server node -e "
const {PrismaClient}=require('@prisma/client');const bcrypt=require('bcryptjs');
(async()=>{const p=new PrismaClient();
await p.user.create({data:{name:'Directora LI',email:'admin@liestetic.do',role:'ADMIN',passwordHash:await bcrypt.hash('CAMBIA_ESTA_CLAVE',10)}});
console.log('Admin creada');process.exit(0);})();"
```

Luego, desde la app, la Administradora crea las sucursales… (o usa el seed una vez y cambia las contraseñas).

## 4. Levantar

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

- Web disponible en `http://SERVIDOR/` (puerto 80).
- Verifica el backend: `docker compose -f docker-compose.prod.yml exec web wget -qO- http://server:4000/api/health`

## 5. HTTPS (recomendado)

Pon un reverse proxy con TLS delante (Caddy, Traefik o nginx + certbot). Ejemplo rápido con Caddy:

```
tu-dominio.com {
  reverse_proxy localhost:80
}
```

Actualiza `CORS_ORIGIN=https://tu-dominio.com` y reinicia `server`.

## 6. Operación

```bash
docker compose -f docker-compose.prod.yml logs -f server   # logs API
docker compose -f docker-compose.prod.yml logs -f web      # logs nginx
docker compose -f docker-compose.prod.yml up -d --build     # redeploy tras cambios
docker compose -f docker-compose.prod.yml down              # detener
```

Backups: los gestiona Supabase (Database → Backups). Verifica que estén activos.

---

## Checklist de producción

- [ ] `JWT_SECRET` y `JWT_PATIENT_SECRET` aleatorios y distintos (48+ chars).
- [ ] `CORS_ORIGIN` = dominio real (no `*`, no localhost).
- [ ] `NODE_ENV=production`.
- [ ] Contraseñas demo cambiadas / seed NO ejecutado en prod.
- [ ] HTTPS activo (TLS) delante del puerto 80.
- [ ] `.env` **no** commiteado (está en `.gitignore`).
- [ ] Backups de Supabase activos.
- [ ] Rottelada la contraseña de la DB si se compartió en algún canal.
- [ ] (Opcional) Restringir IPs de acceso a la DB en Supabase (Network Restrictions).

---

# Despliegue ONLINE para pruebas (GitHub + Render + Netlify)

Recomendación: **Web en Netlify** + **API en Render** + **DB en Supabase** (ya la tienes).
> Netlify NO corre el backend Node/Express; por eso la API va en **Render** (gratis, corre procesos Node). El frontend estático sí va perfecto en Netlify.

```
  Netlify (web, estático)  ──/api (proxy)──►  Render (API Node)  ──►  Supabase (PostgreSQL)
```

## Paso 1 — Subir el código a GitHub

```bash
cd C:\Users\lenovo\CLAUDE\li-estetic-connect
# crea el repo en https://github.com/new (ej. "li-estetic-connect", privado)
git remote add origin https://github.com/TU-USUARIO/li-estetic-connect.git
git branch -M main
git push -u origin main
```
(El `.env` NO se sube: está en `.gitignore`. ✅)

## Paso 2 — Backend (API) en Render

1. Entra a https://render.com → **New → Web Service** → conecta tu repo de GitHub.
2. Configura:
   - **Root Directory:** `server`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
3. **Environment → Add** estas variables:
   ```
   NODE_ENV = production
   DATABASE_URL = (tu cadena pooler 6543 de Supabase)
   DIRECT_URL   = (tu cadena directa 5432 de Supabase)
   JWT_SECRET        = (genera uno: openssl rand -base64 48)
   JWT_PATIENT_SECRET = (otro distinto)
   CORS_ORIGIN = https://TU-SITIO.netlify.app   ← lo tendrás tras el Paso 3
   ```
4. **Create Web Service**. Cuando termine, copia la URL (ej. `https://li-estetic-api.onrender.com`).
5. La base ya está migrada en Supabase; si usaras una nueva, corre una vez en **Render → Shell**: `npx prisma db push`.

> El plan Free de Render "duerme" tras inactividad; la primera carga puede tardar ~30s. Para pruebas está bien.

## Paso 3 — Frontend (web) en Netlify

1. Edita **`netlify.toml`** (raíz del repo) y reemplaza la URL del proxy por tu backend de Render:
   ```toml
   to = "https://li-estetic-api.onrender.com/api/:splat"
   ```
   Haz commit y push.
2. Entra a https://netlify.com → **Add new site → Import from GitHub** → elige el repo.
   - Netlify detecta `netlify.toml` (base `web`, publish `dist`). Deja lo demás por defecto.
3. **Deploy**. Copia la URL del sitio (ej. `https://li-estetic.netlify.app`).
4. Vuelve a **Render → tu servicio → Environment** y pon `CORS_ORIGIN = https://li-estetic.netlify.app`. Guarda (redepliega solo).

## Paso 4 — Probar

Abre `https://TU-SITIO.netlify.app` → login con las credenciales del seed
(`direccion@liestetic.do` / `liestetic`). El portal de paciente en `/portal/login`.

### Cada vez que hagas cambios
`git push` → Render y Netlify redepliegan automáticamente.

---

## Integraciones (segundo plano)

WhatsApp / Meta / TikTok y Google Calendar se activan poniendo sus credenciales en `server/.env`
(`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `META_APP_SECRET`, `TIKTOK_APP_SECRET`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) o desde **Configuración → Integraciones** en la app.
Sin credenciales funcionan en **modo demo** (no bloquean el resto del sistema).
