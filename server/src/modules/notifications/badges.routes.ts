import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import { requireStaff, branchScope } from '../../middleware/auth.js';

/**
 * Contadores del menú lateral (los globitos rojos).
 *
 * Antes eran números escritos a mano en el código ("Mensajes 6"), así que el
 * sistema avisaba de mensajes que no existían. Aquí salen de la base: si no hay
 * nada pendiente, no se muestra nada.
 */
export const badgesRouter = Router();

badgesRouter.get('/', requireStaff, branchScope, async (req, res) => {
  const rol = req.staff!.role;
  const scope = req.scopeBranchId ? { branchId: req.scopeBranchId } : {};

  // Citas de HOY que aún están por atender (no canceladas ni ya cerradas).
  const inicio = new Date(); inicio.setHours(0, 0, 0, 0);
  const fin = new Date(inicio); fin.setDate(fin.getDate() + 1);

  const [mensajes, agenda, notificaciones] = await Promise.all([
    // Conversaciones con mensajes sin leer del cliente.
    prisma.conversation.aggregate({
      where: { ...scope, unread: { gt: 0 } },
      _sum: { unread: true },
    }),
    prisma.appointment.count({
      where: {
        ...scope,
        startsAt: { gte: inicio, lt: fin },
        status: { notIn: ['CANCELADA', 'COMPLETADA'] },
        serviceEndedAt: null,
        // La esteticista solo cuenta las suyas.
        ...(rol === 'ESTETICISTA' ? { therapistId: req.staff!.sub } : {}),
      },
    }),
    prisma.notification.count({ where: { userId: req.staff!.sub, read: false } }),
  ]);

  res.json({
    // 0 = sin globito. El menú no muestra el número cuando no hay nada.
    mensajes: mensajes._sum.unread ?? 0,
    agenda,
    notificaciones,
  });
});
