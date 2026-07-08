# Seguridad — Li Estetic Connect

Resumen de la revisión de seguridad y el endurecimiento aplicado. Datos sensibles: información
clínica de pacientes y datos de facturación → el control de acceso es crítico.

## Controles implementados

| Área | Estado | Detalle |
|---|---|---|
| Hash de contraseñas | ✅ | `bcrypt` (cost 10). Nunca se guardan en texto plano. |
| Autenticación | ✅ | JWT firmado; tokens separados para personal y pacientes (secretos distintos). |
| Autorización por rol | ✅ | `requireRole(...)` en cada endpoint sensible. |
| **Aislamiento por sucursal** | ✅ | `branchScope` + `assertBranchAccess`: recepción/esteticista solo su `branchId`; admin todas. Verificado end-to-end. |
| Validación de entrada | ✅ | `zod` en todos los endpoints que mutan datos. |
| Inyección SQL | ✅ | Prisma (consultas parametrizadas). |
| Fuerza bruta en login | ✅ | `express-rate-limit`: 20 intentos/IP cada 15 min en `/api/auth/*/login`. |
| Cabeceras HTTP | ✅ | `helmet` en la API; `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` en nginx. |
| CORS | ✅ | Restringido a `CORS_ORIGIN` (no `*`). |
| Tamaño de payload | ✅ | Límite de 1 MB en el body JSON. |
| Secretos | ✅ | Vía `.env` (gitignored). En producción se **rechaza arrancar** con secretos débiles/dev (`src/config/env.ts`). |
| Fuga de errores | ✅ | En producción los errores 500 devuelven mensaje genérico (no stack ni detalles). |
| Mensajes de login | ✅ | Genéricos ("Credenciales inválidas") — no revelan si el usuario existe. |
| Portal de paciente | ✅ | Login y token **separados** del interno; sin acceso cruzado. |

## Pendientes / recomendaciones antes de exponer al público

1. **HTTPS obligatorio** — desplegar detrás de TLS (Caddy/Traefik/nginx+certbot). Ver `DEPLOY.md`.
2. **Webhooks de mensajería** (`/api/messaging/webhook/:channel`) hoy son **públicos y sin verificación de firma** (están en modo demo). Antes de activar mensajería real:
   - Verificar la firma de cada plataforma (Meta `X-Hub-Signature-256`, etc.).
   - Validar el token de verificación del webhook.
3. **Tokens en `localStorage`** (frontend) → mitigar XSS: React escapa por defecto y no se usa `dangerouslySetInnerHTML`. Considerar cookies `httpOnly` + CSRF si se endurece más.
4. **Política de contraseñas** — mínimo actual 6 caracteres para personal. Subir a 8+ y forzar cambio del password inicial del colaborador.
5. **Restringir IP de la base** en Supabase (Network Restrictions) a la IP del servidor.
6. **Rotar** cualquier credencial compartida por canales inseguros (contraseña de la DB, tokens).
7. **Rate-limit global** ligero adicional si se expone la API directamente (hoy solo `web` la alcanza).
8. **Auditoría/logs** — considerar registro de accesos a fichas clínicas (trazabilidad) para cumplimiento.

## Manejo de datos

- **RNC** y datos fiscales: el RNC es único; la dirección por sucursal se imprime en el recibo.
- **Ficha clínica**: solo personal de la sucursal del paciente puede verla/editarla; recepción se limita al Paso 1.
- **Backups**: gestionados por Supabase (verificar que estén activos).
