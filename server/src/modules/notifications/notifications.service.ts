import { prisma } from '../../db/prisma.js';

export interface NotifyInput {
  userId: string;
  type: 'NEW_APPOINTMENT' | 'FICHA_FILLED' | 'FICHA_SENT' | 'GENERAL';
  title: string;
  body: string;
  link?: string;
}

/** Crea una alerta interna. Nunca lanza: una notificación fallida no debe romper el flujo principal. */
export async function notify(input: NotifyInput): Promise<void> {
  try {
    await prisma.notification.create({ data: input });
  } catch {
    /* no-op: la acción de negocio ya se completó */
  }
}

/** Notifica a todas las esteticistas activas de una sucursal. */
export async function notifyBranchTherapists(
  branchId: string,
  n: Omit<NotifyInput, 'userId'>,
): Promise<void> {
  try {
    const therapists = await prisma.user.findMany({
      where: { role: 'ESTETICISTA', active: true, branchId },
      select: { id: true },
    });
    if (therapists.length === 0) return;
    await prisma.notification.createMany({
      data: therapists.map((t) => ({ ...n, userId: t.id })),
    });
  } catch {
    /* no-op */
  }
}
