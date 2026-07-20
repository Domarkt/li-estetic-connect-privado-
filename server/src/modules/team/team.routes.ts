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

  // El personal solo cuenta los mensajes dirigidos a él (ALL o su rol).
  const roleFilter = isAdmin ? {} : { targetRole: { in: ['ALL', req.staff!.role] } };

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

  // El personal solo ve mensajes dirigidos a él (ALL o su rol); el admin ve todo.
  const roleFilter = req.staff!.role === 'ADMIN' ? {} : { targetRole: { in: ['ALL', req.staff!.role] } };
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
    time: m.createdAt.toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
  })));
});

const sendSchema = z.object({
  body: z.string().trim().min(1),
  patientId: z.string().optional(),
  targetRole: z.enum(['ALL', 'RECEPCIONISTA', 'ESTETICISTA']).optional(),
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

  // El admin puede dirigir el mensaje (Recepción / Esteticista / Todos); el personal siempre ALL.
  const targetRole = req.staff!.role === 'ADMIN' ? (b.targetRole ?? 'ALL') : 'ALL';

  await prisma.teamMessage.create({
    data: {
      branchId, senderId: req.staff!.sub, senderName: req.staff!.name, senderRole: req.staff!.role,
      targetRole, body: b.body, patientId: b.patientId ?? null, patientName,
    },
  });

  // Aviso por la campana según el destinatario elegido.
  const tag = patientName ? ` · sobre ${patientName}` : '';
  if (req.staff!.role === 'ADMIN') {
    const title = 'Mensaje del administrador';
    if (targetRole === 'ALL' || targetRole === 'RECEPCIONISTA') await notifyRole('RECEPCIONISTA', { type: 'GENERAL', title, body: `${b.body}${tag}`, link: '/app/mensajes' }, branchId);
    if (targetRole === 'ALL' || targetRole === 'ESTETICISTA') await notifyRole('ESTETICISTA', { type: 'GENERAL', title, body: `${b.body}${tag}`, link: '/app/chat' }, branchId);
  } else {
    await notifyRole('ADMIN', { type: 'GENERAL', title: `Mensaje de ${req.staff!.name}`, body: `${b.body}${tag}`, link: '/app/mensajes' });
  }

  res.status(201).json({ ok: true });
});
