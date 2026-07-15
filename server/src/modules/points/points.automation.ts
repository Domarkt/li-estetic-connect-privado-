import { prisma } from '../../db/prisma.js';
import type { PointsReason } from '@prisma/client';

/**
 * Reglas automáticas de puntos "Líderes LI" (las que se pueden validar con datos
 * del sistema). Quedan FUERA por ahora: "venta fuera de horario" y "cliente
 * referido" (no hay forma de validarlos automáticamente).
 */
export const AUTO_POINTS = {
  FIRST_SALE_BEFORE_11: 50, // 1ª venta del día antes de 11 AM (> RD$3,000)
  BEAT_GOAL_BEFORE_4: 75, // supera su meta personal del mes antes de 4 PM
  PREMIUM_PACKAGE: 150, // venta de paquete premium (> RD$15,000)
  FIVE_STAR_REVIEW: 25, // reseña 5★ de un paciente que atendió
} as const;

/** Otorga puntos y registra el movimiento. Nunca lanza (no rompe el flujo de venta). */
async function award(userId: string, points: number, reason: PointsReason, label: string) {
  try {
    await prisma.therapistProfile.upsert({
      where: { userId },
      create: { userId, points: Math.max(0, points) },
      update: { points: { increment: points } },
    });
    await prisma.pointsEntry.create({ data: { userId, points, reason, label } });
  } catch { /* no-op: los puntos automáticos no deben romper la operación */ }
}

/**
 * Evalúa las reglas automáticas al registrarse una venta atribuida a una esteticista.
 * Recibe el monto de ESTA venta; calcula el acumulado del mes desde las facturas.
 */
export async function awardSalePoints(therapistId: string, branchId: string, amount: number, when: Date = new Date()) {
  if (!therapistId || amount <= 0) return;
  try {
    const monthStart = new Date(when.getFullYear(), when.getMonth(), 1);
    const dayStart = new Date(when.getFullYear(), when.getMonth(), when.getDate());
    const hour = when.getHours();

    const [monthAgg, salesTodayCount, branch] = await Promise.all([
      prisma.invoice.aggregate({ where: { therapistId, status: 'PAGADA', issuedAt: { gte: monthStart } }, _sum: { total: true } }),
      prisma.invoice.count({ where: { therapistId, status: 'PAGADA', issuedAt: { gte: dayStart } } }),
      prisma.branch.findUnique({ where: { id: branchId } }),
    ]);
    const monthTotal = monthAgg._sum.total ?? 0; // incluye esta venta
    const monthBefore = monthTotal - amount;

    // Mantiene monthSales del perfil en sincronía (base de comisión, resumen de equipo).
    await prisma.therapistProfile.upsert({
      where: { userId: therapistId }, create: { userId: therapistId, monthSales: monthTotal }, update: { monthSales: monthTotal },
    });

    // 1ª venta del día antes de 11 AM (> 3,000)
    if (salesTodayCount === 1 && hour < 11 && amount > 3000) {
      await award(therapistId, AUTO_POINTS.FIRST_SALE_BEFORE_11, 'VENTA', '1ª venta antes de 11 AM');
    }
    // Venta de paquete premium (> 15,000)
    if (amount > 15000) {
      await award(therapistId, AUTO_POINTS.PREMIUM_PACKAGE, 'VENTA', 'Venta de paquete premium');
    }
    // Supera meta personal del mes antes de 4 PM (solo al cruzarla)
    const goal = branch?.perAsesorGoal ?? 0;
    if (goal > 0 && monthBefore < goal && monthTotal >= goal && hour < 16) {
      await award(therapistId, AUTO_POINTS.BEAT_GOAL_BEFORE_4, 'META', 'Superó meta personal del mes');
    }
  } catch { /* no-op */ }
}

/** Reseña 5★ de un paciente → puntos a la esteticista que lo atendió. */
export async function awardFiveStar(therapistId: string | null | undefined) {
  if (!therapistId) return;
  await award(therapistId, AUTO_POINTS.FIVE_STAR_REVIEW, 'RESENA', 'Reseña 5★ de un paciente');
}
