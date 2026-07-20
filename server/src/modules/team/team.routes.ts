import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireStaff } from '../../middleware/auth.js';
import { notifyRole } from '../notifications/notifications.service.js';

export const teamRouter = Router();

/** Sucursal efectiva del hilo para este usuario: admin puede cualquiera; el resto, la suya. */
function resolveThreadBranch(req: Request, branchId?: string): string | null {
  if (req.staff!.role === 'ADMIN') return branchId ?? null;
  return req.staff!.branchId ?? null; // personal de sucursal: siempre la suya
}

/** Lista de hilos (uno por sucursal) con último mensaje y no leídos. */
teamRouter.get('/threads', requireStaff, async (req, res) => {
  const isAdmin = req.staff!.role === 'ADMIN';
  const branches = await prisma.branch.findMany({
    where: isAdmin ? {} : { id: req.staff!.branchId ?? '__none__' },
    orderBy: { code: 'asc' },
    select: { id: true, name: true, place: true, dotColor: true },
  });

  const reads = await prisma.teamThreadRead.findMany({ where: { userId: req.staff!.sub } });
  const readMap = new Map(reads.map((r) => [r.branchId, r.lastReadAt]));

  // El personal ve los mensajes dirigidos a él (ALL o su rol) y los que él mismo envió.
  const roleFilter = isAdmin ? {} : { OR: [{ targetRole: { in: ['ALL', req.staff!.role] } }, { senderId: req.staff!.sub }] };

  const threads = await Promise.all(branches.map(async (b) => {
    const last = await prisma.teamMessage.findFirst({ where: { branchId: b.id, ...roleFilter }, orderBy: { createdAt: 'desc' } });
    const since = readMap.get(b.id);
    const unread = await prisma.teamMessage.count({
      where: { branchId: b.id, senderId: { not: req.staff!.sub }, ...roleFilter, ...(since ? { createdAt: { gt: since } } : {}) },
    });
    return {
      branchId: b.id, name: b.name, place: b.place, dotColor: b.dotColor,
      lastMessage: last?.body ?? null,
      lastAt: last ? last.createdAt.toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : null,
      unread,
    };
  }));
  res.json(threads);
});

/** Mensajes de un hilo (sucursal). Marca como leído para este usuario. */
teamRouter.get('/threads/:branchId/messages', requireStaff, async (req, res) => {
  const branchId = resolveThreadBranch(req, req.params.branchId);
  if (!branchId) return res.status(400).json({ error: 'Sin sucursal' });
  if (req.staff!.role !== 'ADMIN' && branchId !== req.staff!.branchId) {
    return res.status(403).json({ error: 'Solo puedes ver el chat de tu sucursal' });
  }

  // El personal ve mensajes dirigidos a él (ALL o su rol) y los que él mismo envió; el admin ve todo.
  const roleFilter = req.staff!.role === 'ADMIN' ? {} : { OR: [{ targetRole: { in: ['ALL', req.staff!.role] } }, { senderId: req.staff!.sub }] };
  const messages = await prisma.teamMessage.findMany({ where: { branchId, ...roleFilter }, orderBy: { createdAt: 'asc' }, take: 200 });

  await prisma.teamThreadRead.upsert({
    where: { userId_branchId: { userId: req.staff!.sub, branchId } },
    create: { userId: req.staff!.sub, branchId, lastReadAt: new Date() },
    update: { lastReadAt: new Date() },
  });

  res.json(messages.map((m) => ({
    id: m.id,
    body: m.body,
    senderName: m.senderName,
    senderRole: m.senderRole,
    target: m.targetRole,
    mine: m.senderId === req.staff!.sub,
    patient: m.patientId ? { id: m.patientId, name: m.patientName ?? 'Paciente' } : null,
    attachment: m.attachmentData ? { data: m.attachmentData, name: m.attachmentName ?? 'archivo', kind: m.attachmentKind ?? 'file', mime: m.attachmentMime ?? '' } : null,
    time: m.createdAt.toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
  })));
});

// ~10 MB de archivo ≈ 14 MB en base64 (data URL). Límite para no saturar la DB.
const MAX_ATTACHMENT_CHARS = 14_000_000;
const sendSchema = z.object({
  body: z.string().trim().max(4000).optional(),
  patientId: z.string().optional(),
  targetRole: z.enum(['ALL', 'ADMIN', 'RECEPCIONISTA', 'ESTETICISTA']).optional(),
  attachment: z.object({
    data: z.string().startsWith('data:').max(MAX_ATTACHMENT_CHARS, 'El archivo supera el límite de 10 MB'),
    name: z.string().min(1).max(200),
    kind: z.enum(['image', 'video', 'file']),
    mime: z.string().max(120).optional(),
  }).optional(),
}).refine((v) => (v.body && v.body.trim().length > 0) || v.attachment, {
  message: 'Escribe un mensaje o adjunta un archivo',
});

/** Enviar un mensaje al hilo de una sucursal (opcionalmente etiquetando un paciente). */
teamRouter.post('/threads/:branchId/messages', requireStaff, async (req, res) => {
  const b = sendSchema.parse(req.body);
  const branchId = resolveThreadBranch(req, req.params.branchId);
  if (!branchId) return res.status(400).json({ error: 'Sin sucursal' });
  if (req.staff!.role !== 'ADMIN' && branchId !== req.staff!.branchId) {
    return res.status(403).json({ error: 'Solo puedes escribir en el chat de tu sucursal' });
  }

  // Paciente etiquetado (opcional): debe existir y pertenecer a la sucursal del hilo.
  let patientName: string | null = null;
  if (b.patientId) {
    const p = await prisma.patient.findUnique({ where: { id: b.patientId }, select: { name: true, branchId: true } });
    if (!p) return res.status(404).json({ error: 'Paciente etiquetado no encontrado' });
    if (p.branchId !== branchId) return res.status(400).json({ error: 'El paciente no pertenece a esa sucursal' });
    patientName = p.name;
  }

  // Cualquier rol puede dirigir el mensaje (Recepción / Esteticista / Todos).
  const targetRole = b.targetRole ?? 'ALL';
  const body = (b.body ?? '').trim();

  await prisma.teamMessage.create({
    data: {
      branchId, senderId: req.staff!.sub, senderName: req.staff!.name, senderRole: req.staff!.role,
      targetRole, body, patientId: b.patientId ?? null, patientName,
      attachmentData: b.attachment?.data ?? null,
      attachmentName: b.attachment?.name ?? null,
      attachmentKind: b.attachment?.kind ?? null,
      attachmentMime: b.attachment?.mime ?? null,
    },
  });

  // Texto para la campana (si es solo adjunto, describe el tipo).
  const kindLabel = b.attachment ? (b.attachment.kind === 'image' ? '📷 Foto' : b.attachment.kind === 'video' ? '🎬 Video' : '📎 Archivo') : '';
  const preview = body || kindLabel || 'Nuevo mensaje';
  const tag = patientName ? ` · sobre ${patientName}` : '';
  const from = req.staff!.name;
  const notify = (role: 'RECEPCIONISTA' | 'ESTETICISTA' | 'ADMIN', link: string) =>
    notifyRole(role, { type: 'GENERAL', title: `Mensaje de ${from}`, body: `${preview}${tag}`, link }, role === 'ADMIN' ? undefined : branchId);

  // Avisar por la campana exactamente a la audiencia elegida (Todos = a los tres roles).
  if (targetRole === 'ALL' || targetRole === 'ADMIN') await notify('ADMIN', '/app/mensajes');
  if (targetRole === 'ALL' || targetRole === 'RECEPCIONISTA') await notify('RECEPCIONISTA', '/app/mensajes');
  if (targetRole === 'ALL' || targetRole === 'ESTETICISTA') await notify('ESTETICISTA', '/app/chat');

  res.status(201).json({ ok: true });
});
