import { prisma } from '../../db/prisma.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

interface Creds { phoneId: string; token: string }

/**
 * Credenciales de WhatsApp Cloud: primero desde .env, si no, desde la integración
 * guardada por la Administradora en Configuración (número de prueba).
 */
async function getCreds(): Promise<Creds | null> {
  const envPhone = process.env.WHATSAPP_PHONE_ID;
  const envToken = process.env.WHATSAPP_TOKEN;
  if (envPhone && envToken) return { phoneId: envPhone, token: envToken };

  const integ = await prisma.integration.findUnique({ where: { kind_scopeId: { kind: 'whatsapp', scopeId: 'global' } } });
  const meta = (integ?.meta ?? null) as { phoneId?: string; token?: string } | null;
  if (meta?.phoneId && meta?.token) return { phoneId: meta.phoneId, token: meta.token };
  return null;
}

export async function whatsappConfigured(): Promise<boolean> {
  return (await getCreds()) !== null;
}

/** Normaliza a formato internacional RD (+1). "809-555-0142" -> "18095550142". */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return '1' + digits; // RD sin país
  return digits;
}

export interface SendResult { sent: boolean; mode: 'live' | 'demo'; error?: string; id?: string }

/** Envía un mensaje de texto por WhatsApp Cloud API. */
export async function sendWhatsAppText(to: string, body: string): Promise<SendResult> {
  const creds = await getCreds();
  if (!creds) return { sent: false, mode: 'demo' }; // sin credenciales: simulado

  const res = await fetch(`${GRAPH}/${creds.phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: normalizePhone(to), type: 'text', text: { body } }),
  });
  const data = (await res.json()) as { messages?: { id: string }[]; error?: { message: string } };
  if (!res.ok) return { sent: false, mode: 'live', error: data.error?.message ?? `HTTP ${res.status}` };
  return { sent: true, mode: 'live', id: data.messages?.[0]?.id };
}

/**
 * Envía la plantilla pre-aprobada "hello_world" (útil para PROBAR la conexión sin
 * depender de la ventana de 24h de sesión).
 */
export async function sendWhatsAppTemplate(to: string, template = 'hello_world'): Promise<SendResult> {
  const creds = await getCreds();
  if (!creds) return { sent: false, mode: 'demo' };

  const res = await fetch(`${GRAPH}/${creds.phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: normalizePhone(to), type: 'template', template: { name: template, language: { code: 'en_US' } } }),
  });
  const data = (await res.json()) as { messages?: { id: string }[]; error?: { message: string } };
  if (!res.ok) return { sent: false, mode: 'live', error: data.error?.message ?? `HTTP ${res.status}` };
  return { sent: true, mode: 'live', id: data.messages?.[0]?.id };
}
