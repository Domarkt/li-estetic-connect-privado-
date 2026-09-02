import crypto from 'crypto';
import { prisma } from '../../db/prisma.js';

/**
 * Configuración de la conexión con Meta (WhatsApp Cloud, Messenger e Instagram).
 * Las credenciales viven en variables de entorno (Render) o, por sucursal, en la
 * tabla Integration(kind='meta'). Nada de secretos en el código.
 *
 * Variables de entorno esperadas:
 *   META_VERIFY_TOKEN      → token de verificación del webhook (lo defines tú; el mismo en Meta)
 *   META_APP_SECRET        → App Secret de la app de Meta (para validar la firma X-Hub-Signature-256)
 *   META_PAGE_TOKEN        → token de página (Messenger/Instagram) por defecto
 *   META_DEFAULT_BRANCH    → código de sucursal por defecto si no hay ruta (ej. "e1")
 *   META_ROUTES            → JSON { "<phone_number_id | page_id | ig_id>": "<código sucursal>" }
 *   WHATSAPP_PHONE_ID / WHATSAPP_TOKEN → ya usados por whatsapp.service
 */

export function metaVerifyToken(): string | null {
  return process.env.META_VERIFY_TOKEN ?? null;
}

function appSecret(): string | null {
  return process.env.META_APP_SECRET ?? null;
}

/**
 * Valida la firma del webhook de Meta. Si no hay App Secret configurado devuelve
 * `true` (modo tolerante para pruebas), pero en producción DEBES configurarlo.
 */
export function verifyMetaSignature(rawBody: Buffer | undefined, header: string | undefined): boolean {
  const secret = appSecret();
  if (!secret) return true; // sin App Secret: no se puede validar → se acepta (configúralo en prod)
  if (!rawBody || !header) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(header));
  } catch {
    return false;
  }
}

type MetaMeta = { pageToken?: string; routes?: Record<string, string> } | null;

async function metaIntegration(scopeId: string): Promise<MetaMeta> {
  const integ = await prisma.integration.findUnique({ where: { kind_scopeId: { kind: 'meta', scopeId } } });
  return (integ?.meta ?? null) as MetaMeta;
}

function envRoutes(): Record<string, string> {
  try {
    return process.env.META_ROUTES ? (JSON.parse(process.env.META_ROUTES) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/**
 * Resuelve la sucursal destino a partir del identificador que trae Meta
 * (phone_number_id de WhatsApp, o page/ig id de Messenger/Instagram).
 * Orden: rutas en Integration('meta','global') → META_ROUTES → META_DEFAULT_BRANCH → primera sucursal.
 */
export async function resolveBranchByRoute(routeKey: string | null | undefined): Promise<{ id: string; code: string } | null> {
  const global = await metaIntegration('global');
  const routes = { ...envRoutes(), ...(global?.routes ?? {}) };

  const code = (routeKey && routes[routeKey]) || process.env.META_DEFAULT_BRANCH || null;
  if (code) {
    const b = await prisma.branch.findUnique({ where: { code: code.toLowerCase() }, select: { id: true, code: true } });
    if (b) return b;
  }
  // Último recurso: la primera sucursal (para que ningún mensaje se pierda).
  return prisma.branch.findFirst({ orderBy: { code: 'asc' }, select: { id: true, code: true } });
}

/** Token de página para responder por Messenger/Instagram (por sucursal → global → env). */
export async function getPageToken(branchId: string): Promise<string | null> {
  const perBranch = await metaIntegration(branchId);
  if (perBranch?.pageToken) return perBranch.pageToken;
  const global = await metaIntegration('global');
  if (global?.pageToken) return global.pageToken;
  return process.env.META_PAGE_TOKEN ?? null;
}
