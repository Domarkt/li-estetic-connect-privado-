import { Router } from 'express';
import type { Channel } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { metaVerifyToken, verifyMetaSignature, resolveBranchByRoute } from './meta.config.js';
import { sendToChannel } from './meta.send.js';
import { generateSofiaReply, sofiaConfigured } from './sofia.js';

/**
 * Webhook NATIVO de Meta (WhatsApp Cloud, Messenger, Instagram Direct).
 * PÚBLICO: lo llama Meta. Se monta FUERA de la autenticación.
 *   GET  /api/webhooks/meta  → verificación (hub.challenge)
 *   POST /api/webhooks/meta  → eventos entrantes (valida firma X-Hub-Signature-256)
 * Configura la MISMA URL como callback en los 3 productos de tu app de Meta.
 */
export const metaWebhookRouter = Router();

// Verificación del webhook (Meta hace un GET al configurarlo).
metaWebhookRouter.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = metaVerifyToken();
  if (mode === 'subscribe' && expected && token === expected) {
    return res.status(200).send(String(challenge ?? ''));
  }
  return res.sendStatus(403);
});

interface Inbound { channel: Channel; routeKey: string | null; senderId: string; name: string | null; body: string }

/** Normaliza el payload de Meta a una lista de mensajes entrantes de texto. */
function extractInbound(payload: any): Inbound[] {
  const out: Inbound[] = [];
  const object = payload?.object;
  const entries: any[] = Array.isArray(payload?.entry) ? payload.entry : [];

  if (object === 'whatsapp_business_account') {
    for (const entry of entries) {
      for (const change of entry?.changes ?? []) {
        const value = change?.value ?? {};
        const routeKey = value?.metadata?.phone_number_id ?? null;
        const contactName = value?.contacts?.[0]?.profile?.name ?? null;
        for (const m of value?.messages ?? []) {
          const text = m?.text?.body ?? m?.button?.text ?? m?.interactive?.list_reply?.title ?? m?.interactive?.button_reply?.title;
          if (m?.from && text) out.push({ channel: 'WHATSAPP', routeKey, senderId: String(m.from), name: contactName, body: String(text) });
        }
      }
    }
  } else if (object === 'page' || object === 'instagram') {
    const channel: Channel = object === 'instagram' ? 'INSTAGRAM' : 'MESSENGER';
    for (const entry of entries) {
      const routeKey = entry?.id ? String(entry.id) : null;
      for (const e of entry?.messaging ?? []) {
        if (e?.message?.is_echo) continue; // ignora ecos de nuestros propios envíos
        const text = e?.message?.text;
        const senderId = e?.sender?.id;
        if (senderId && text) out.push({ channel, routeKey, senderId: String(senderId), name: null, body: String(text) });
      }
    }
  }
  return out;
}

metaWebhookRouter.post('/', (req, res) => {
  const ok = verifyMetaSignature((req as any).rawBody, req.header('x-hub-signature-256'));
  if (!ok) return res.sendStatus(403);
  // Responder 200 de inmediato (Meta reintenta si tardamos). El trabajo va en segundo plano.
  res.sendStatus(200);
  const inbounds = extractInbound(req.body);
  for (const inb of inbounds) {
    handleInbound(inb).catch((err) => console.error('[meta-webhook] error procesando entrante:', err instanceof Error ? err.message : err));
  }
});

async function handleInbound(inb: Inbound): Promise<void> {
  const branch = await resolveBranchByRoute(inb.routeKey);
  if (!branch) { console.warn('[meta-webhook] sin sucursal para ruta', inb.routeKey); return; }

  const contactName = inb.name || `${inb.channel === 'INSTAGRAM' ? 'Instagram' : inb.channel === 'MESSENGER' ? 'Messenger' : 'WhatsApp'} ${inb.senderId.slice(-4)}`;

  let conv = await prisma.conversation.findFirst({ where: { branchId: branch.id, channel: inb.channel, externalId: inb.senderId } });
  if (!conv) {
    conv = await prisma.conversation.create({
      data: { branchId: branch.id, channel: inb.channel, externalId: inb.senderId, contactName, avatarColor: '#B31C86', unread: 0 },
    });
  }
  await prisma.message.create({ data: { conversationId: conv.id, fromMe: false, body: inb.body } });
  await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessage: inb.body, lastAt: new Date(), unread: { increment: 1 } } });

  // Sofía solo actúa si el hilo la tiene activa y hay credenciales de IA.
  if (!conv.botEnabled || !sofiaConfigured()) return;

  const branchFull = await prisma.branch.findUnique({ where: { id: branch.id } });
  if (!branchFull) return;
  const recent = await prisma.message.findMany({ where: { conversationId: conv.id }, orderBy: { sentAt: 'asc' }, take: 12, select: { fromMe: true, body: true } });

  const decision = await generateSofiaReply(branchFull, inb.channel, recent);
  if (!decision || !decision.mensaje) return; // error/duda sin texto → queda como no leído para el staff

  // Enviar la respuesta de Sofía por el mismo canal.
  const result = await sendToChannel(inb.channel, inb.senderId, decision.mensaje, branch.id);
  if (!result.sent) console.error('[meta-webhook] no se pudo enviar respuesta de Sofía:', result.error ?? result.mode);

  await prisma.message.create({ data: { conversationId: conv.id, fromMe: true, body: decision.mensaje, viaBot: true } });

  if (decision.responder) {
    // Sofía resolvió la consulta: hilo atendido, sin pendiente humano.
    await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessage: decision.mensaje, lastAt: new Date(), unread: 0 } });
  } else {
    // Escaló: Sofía se retira del hilo y lo marca para atención humana.
    await prisma.conversation.update({
      where: { id: conv.id },
      data: { lastMessage: decision.mensaje, lastAt: new Date(), botEnabled: false, needsHuman: true, handoffReason: decision.motivo || 'Escalado por Sofía' },
    });
  }
}
