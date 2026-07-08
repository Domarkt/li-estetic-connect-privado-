# Li Estetic Connect

Software de gestión de pacientes para **Li Estetic Center** ("Transformando Tu Cuerpo") — cadena de estéticas en República Dominicana con 3 sucursales.

Recreación de producción del prototipo de diseño (`design_handoff_li_estetic_connect`). Stack real, multi-sucursal, con aislamiento de datos por sucursal.

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS + React Router |
| Backend | Node + Express + TypeScript |
| ORM / DB | Prisma + PostgreSQL |
| Auth | JWT con roles y scope de sucursal (login interno + portal de paciente separado) |

## Estructura

```
li-estetic-connect/
├── docker-compose.yml    # PostgreSQL 16
├── server/               # API REST (Express + Prisma)
│   ├── prisma/
│   │   ├── schema.prisma # modelo de datos completo (todas las fases)
│   │   └── seed.ts       # datos demo del prototipo
│   └── src/
└── web/                  # SPA React (login, app interna, portal paciente)
```

## Puesta en marcha

Requisitos: Node 20+, npm 10+, Docker (o un PostgreSQL propio).

```bash
# 1. Levantar PostgreSQL
docker compose up -d

# 2. Backend
cd server
cp .env.example .env          # ajusta secretos si quieres
npm install
npm run prisma:migrate        # crea las tablas
npm run seed                  # carga datos demo
npm run dev                   # API en http://localhost:4000

# 3. Frontend (otra terminal)
cd web
npm install
npm run dev                   # app en http://localhost:5173
```

### Credenciales demo (seed)

Personal (login interno — elige rol + sucursal, luego correo + contraseña `liestetic`):

| Rol | Correo | Sucursal |
|---|---|---|
| Administradora | direccion@liestetic.do | (ve las 3) |
| Recepcionista | recepcion.sv@liestetic.do | Estética 1 |
| Esteticista | yerlin@liestetic.do | Estética 1 |

Paciente (portal externo — celular + contraseña `paciente`): `809-555-0142` (Ana Batista).

## Producción

- **Despliegue:** ver [DEPLOY.md](DEPLOY.md) (Docker + nginx + Supabase, paso a paso + checklist).
- **Seguridad:** ver [SECURITY.md](SECURITY.md) (controles aplicados y recomendaciones).

```bash
# Producción (backend + web en contenedores; DB = Supabase externa)
docker compose -f docker-compose.prod.yml run --rm server npx prisma db push   # 1ª vez
docker compose -f docker-compose.prod.yml up -d --build
```

## Fases

1. ✅ Auth por rol/sucursal + modelo de datos PostgreSQL
2. ✅ CRM pacientes + ficha clínica digital
3. ✅ Agenda + Google Calendar
4. ✅ Facturación DGII (e-CF)
5. ✅ Mensajería omnicanal (Meta / WhatsApp / TikTok) + pipeline
6. ✅ Puntos "Líderes LI" + comisiones · + menú de Configuración (metas, reglas, premios, **integraciones**)
7. ✅ Portal del paciente (móvil)

## Aislamiento por sucursal (regla dura)

Cada recepcionista/esteticista solo ve y opera datos de SU sucursal (`branchId`). La Administradora ve las 3 y puede filtrar. El middleware `branchScope` aplica esta regla en el backend; el token JWT lleva `role` y `branchId`.
