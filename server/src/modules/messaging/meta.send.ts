import type { Channel } from '@prisma/client';
import { sendWhatsAppText } from './whatsapp.service.js';
import { getPageToken } from './meta.config.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

export interface SendResult { sent: boolean; mode: 'live' | 'demo'; error?: string; id?: string }

/** Envía por Messenger o Instagram Direct usando el token de página (Graph API). */
async function sendViaPage(branchId: string, recipientId: string, text: string): Promise<SendResult> {
  const token = await getPageToken(branchId);
  if (!token) return { sent: false, mode: 'demo' }; // sin token: simulado
  const res = await fetch(`${GRAPH}/me/messages?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: recipientId }, messaging_type: 'RESPONSE', message: { text } }),
  });
  const data = (await res.json().catch(() => ({}))) as { message_id?: string; error?: { message: string } };
  if (!res.ok) return { sent: false, mode: 'live', error: data.error?.message ?? `HTTP ${res.status}` };
  return { sent: true, mode: 'live', id: data.message_id };
}

/**
 * Envía un texto por el canal correspondiente.
 * WhatsApp → whatsapp.service (Cloud API). Messenger/Instagram → token de página.
 * `recipientId` es el externalId de la conversación (wa_id / PSID / IGSID).
 */
export async function sendToChannel(
  channel: Channel,
  recipientId: string,
  text: string,
  branchId: string,
): Promise<SendResult> {
  if (channel === 'WHATSAPP') return sendWhatsAppText(recipientId, text);
  if (channel === 'MESSENGER' || channel === 'INSTAGRAM') return sendViaPage(branchId, recipientId, text);
  return { sent: false, mode: 'demo', error: 'Canal no soportado para envío automático' };
}
