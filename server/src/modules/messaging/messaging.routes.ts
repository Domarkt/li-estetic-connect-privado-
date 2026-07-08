import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireStaff, requireRole, branchScope, assertBranchAccess } from '../../middleware/auth.js';
import { serializeConversation, serializeMessage } from './messaging.service.js';

export const messagingRouter = Router();

// Bandeja: Recepción y Admin.
const inboxRoles = ['ADMIN', 'RECEPCIONISTA'] as const;

/** Lista de conversaciones (aislada por sucursal; filtro opcional ?channel=). */
messagingRouter.get('/conversations', requireStaff, requireRole(...inboxRoles), branchScope, async (req, res) => {
  const channel = req.query.channel as string | undefined;
  const where = {
    ...(req.scopeBranchId ? { branchId: req.scopeBranchId } : {}),
    ...(channel && channel !== 'all' ? { channel: channel as never } : {}),
  };
  const conversations = await prisma.conversation.findMany({
    where, include: { branch: true }, orderBy: { lastAt: 'desc' },
  });
  res.json(conversations.map(serializeConversation));
});

/** Mensajes de una conversación (marca como leída). */
messagingRouter.get('/conversations/:id', requireStaff, requireRole(...inboxRoles), branchScope, async (req, res) => {
  const conv = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: { branch: true, messages: { orderBy: { sentAt: 'asc' } } },
  });
  if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });
  if (!assertBranchAccess(req, conv.branchId)) return res.status(403).json({ error: 'Conversación de otra sucursal' });

  if (conv.unread > 0) await prisma.conversation.update({ where: { id: conv.id }, data: { unread: 0 } });

  res.json({
    conversation: { ...serializeConversation(conv), unread: 0 },
    messages: conv.messages.map(serializeMessage),
  });
});

const sendSchema = z.object({ body: z.string().min(1) });

/** Responder en una conversación (envío saliente). */
messagingRouter.post('/conversations/:id/messages', requireStaff, requireRole(...inboxRoles), branchScope, async (req, res) => {
  const { body } = sendSchema.parse(req.body);
  const conv = await prisma.conversation.findUnique({ where: { id: req.params.id } });
  if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });
  if (!assertBranchAccess(req, conv.branchId)) return res.status(403).json({ error: 'Conversación de otra sucursal' });

  const msg = await prisma.message.create({ data: { conversationId: conv.id, fromMe: true, body } });
  await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessage: body, lastAt: new Date(), unread: 0 } });
  // En producción aquí se llama a la API del canal (Meta Graph / WhatsApp Cloud / TikTok).
  res.status(201).json(serializeMessage(msg));
});

const webhookSchema = z.object({
  branchCode: z.string(), // sucursal destino (por número/página conectada)
  channel: z.enum(['INSTAGRAM', 'WHATSAPP', 'MESSENGER', 'TIKTOK']),
  externalId: z.string().optional(),
  contactName: z.string(),
  body: z.string(),
});

/**
 * Webhook de ENTRADA (Meta Graph / WhatsApp Cloud / TikTok Messaging).
 * Público (las plataformas lo llaman). En producción: verificar la firma del canal.
 * Crea/actualiza la conversación y agrega el mensaje entrante a la sucursal.
 */
messagingRouter.post('/webhook/:channel', async (req, res) => {
  const parsed = webhookSchema.safeParse({ ...req.body, channel: (req.params.channel || '').toUpperCase() });
  if (!parsed.success) return res.status(400).json({ error: 'Payload inválido' });
  const { branchCode, channel, externalId, contactName, body } = parsed.data;

  const branch = await prisma.branch.findUnique({ where: { code: branchCode } });
  if (!branch) return res.status(404).json({ error: 'Sucursal no encontrada' });

  let conv = await prisma.conversation.findFirst({
    where: { branchId: branch.id, channel, ...(externalId ? { externalId } : { contactName }) },
  });
  if (!conv) {
    conv = await prisma.conversation.create({
      data: { branchId: branch.id, channel, externalId: externalId ?? null, contactName, avatarColor: '#B31C86', unread: 0 },
    });
  }
  await prisma.message.create({ data: { conversationId: conv.id, fromMe: false, body, externalId: externalId ?? null } });
  await prisma.conversation.update({
    where: { id: conv.id },
    data: { lastMessage: body, lastAt: new Date(), unread: { increment: 1 } },
  });
  res.json({ ok: true });
});
