import { prisma } from '../../db/prisma.js';

export interface NotifyInput {
  userId: string;
  type: 'NEW_APPOINTMENT' | 'FICHA_FILLED' | 'FICHA_SENT' | 'APPOINTMENT_CANCELLED' | 'GENERAL';
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
  await notifyRole('ESTETICISTA', n, branchId);
}

/**
 * Notifica a todos los usuarios activos de un rol. ADMIN se notifica global
 * (branchId null = ve todas); los demás roles se filtran por sucursal.
 */
export async function notifyRole(
  role: 'ADMIN' | 'RECEPCIONISTA' | 'ESTETICISTA',
  n: Omit<NotifyInput, 'userId'>,
  branchId?: string,
): Promise<void> {
  try {
    const users = await prisma.user.findMany({
      where: { role, active: true, ...(role !== 'ADMIN' && branchId ? { branchId } : {}) },
      select: { id: true },
    });
    if (users.length === 0) return;
    await prisma.notification.createMany({ data: users.map((u) => ({ ...n, userId: u.id })) });
  } catch {
    /* no-op */
  }
}
