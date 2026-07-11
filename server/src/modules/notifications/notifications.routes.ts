import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import { requireStaff } from '../../middleware/auth.js';

export const notificationsRouter = Router();

/** Mis alertas (últimas 30) + conteo sin leer. */
notificationsRouter.get('/', requireStaff, async (req, res) => {
  const userId = req.staff!.sub;
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 30 }),
    prisma.notification.count({ where: { userId, read: false } }),
  ]);
  res.json({
    unread,
    items: items.map((n) => ({
      id: n.id, type: n.type, title: n.title, body: n.body, link: n.link,
      read: n.read, createdAt: n.createdAt,
    })),
  });
});

/** Marcar todas como leídas. */
notificationsRouter.post('/read-all', requireStaff, async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.staff!.sub, read: false }, data: { read: true } });
  res.json({ ok: true });
});

/** Marcar una como leída (solo si es del usuario). */
notificationsRouter.post('/:id/read', requireStaff, async (req, res) => {
  await prisma.notification.updateMany({ where: { id: req.params.id, userId: req.staff!.sub }, data: { read: true } });
  res.json({ ok: true });
});
