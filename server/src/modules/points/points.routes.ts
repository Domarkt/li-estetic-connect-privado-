import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireStaff, requireRole, branchScope } from '../../middleware/auth.js';
import { tierFor, commissionFor, fmt, COMMISSION_RATE } from './points.service.js';

export const pointsRouter = Router();

/** Ranking global de esteticistas por puntos (para calcular la posición). */
async function rankedTherapists() {
  const list = await prisma.user.findMany({
    where: { role: 'ESTETICISTA', active: true },
    include: { therapistProfile: true, branch: true },
  });
  return list
    .map((u) => ({ user: u, points: u.therapistProfile?.points ?? 0, monthSales: u.therapistProfile?.monthSales ?? 0 }))
    .sort((a, b) => b.points - a.points);
}

/** Vista de la esteticista: mis puntos, comisión, ledger y premios. */
pointsRouter.get('/me', requireStaff, requireRole('ESTETICISTA'), async (req, res) => {
  const me = await prisma.user.findUnique({ where: { id: req.staff!.sub }, include: { therapistProfile: true } });
  const points = me?.therapistProfile?.points ?? 0;
  const monthSales = me?.therapistProfile?.monthSales ?? 0;
  const comm = commissionFor(monthSales, points);

  const ranking = await rankedTherapists();
  const rank = ranking.findIndex((r) => r.user.id === req.staff!.sub) + 1;

  const ledger = await prisma.pointsEntry.findMany({ where: { userId: req.staff!.sub }, orderBy: { createdAt: 'desc' }, take: 20 });
  const rewards = await prisma.reward.findMany({ where: { active: true }, orderBy: { cost: 'asc' } });

  res.json({
    points, tier: comm.tier, tierColor: comm.tierColor, rank: `#${rank} de ${ranking.length}`,
    commission: { sales: monthSales, base: comm.base, bonus: comm.bonus, total: comm.total, rate: COMMISSION_RATE },
    ledger: ledger.map((l) => ({ id: l.id, label: l.label, pts: l.points, time: l.createdAt.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) })),
    rewards: rewards.map((r) => ({ id: r.id, label: r.label, cost: r.cost, icon: r.icon, affordable: points >= r.cost })),
  });
});

const redeemSchema = z.object({ rewardId: z.string() });

/** Canjear un premio (descuenta puntos y registra el movimiento). */
pointsRouter.post('/redeem', requireStaff, requireRole('ESTETICISTA'), async (req, res) => {
  const { rewardId } = redeemSchema.parse(req.body);
  const reward = await prisma.reward.findUnique({ where: { id: rewardId } });
  if (!reward || !reward.active) return res.status(404).json({ error: 'Premio no disponible' });
  const profile = await prisma.therapistProfile.findUnique({ where: { userId: req.staff!.sub } });
  if (!profile || profile.points < reward.cost) return res.status(400).json({ error: 'Puntos insuficientes' });

  await prisma.$transaction([
    prisma.therapistProfile.update({ where: { userId: req.staff!.sub }, data: { points: { decrement: reward.cost } } }),
    prisma.pointsEntry.create({ data: { userId: req.staff!.sub, points: -reward.cost, reason: 'CANJE', label: `Canje: ${reward.label}` } }),
    prisma.redemption.create({ data: { userId: req.staff!.sub, rewardId: reward.id, cost: reward.cost } }),
  ]);
  res.json({ ok: true, message: `Canje solicitado: ${reward.label}` });
});

/** Vista admin: tabla de comisiones del equipo + reglas del programa. */
pointsRouter.get('/commissions', requireStaff, requireRole('ADMIN'), branchScope, async (req, res) => {
  const ranking = await rankedTherapists();
  const filtered = req.scopeBranchId ? ranking.filter((r) => r.user.branchId === req.scopeBranchId) : ranking;

  const rows = filtered.map((r, i) => {
    const comm = commissionFor(r.monthSales, r.points);
    return {
      rank: i + 1,
      id: r.user.id, name: r.user.name, avatarColor: r.user.avatarColor,
      branch: r.user.branch?.name ?? '—',
      points: r.points, tier: comm.tier, tierColor: comm.tierColor,
      sales: r.monthSales, commission: comm.total,
    };
  });
  const totalCommissions = rows.reduce((s, r) => s + r.commission, 0);

  // Trofeo "Estrella LI": sucursal con mayor % de cumplimiento de meta.
  const branches = await prisma.branch.findMany();
  const trophy = branches
    .map((b) => {
      const sales = ranking.filter((r) => r.user.branchId === b.id).reduce((s, r) => s + r.monthSales, 0);
      const pct = b.monthlyGoal ? Math.round((sales / b.monthlyGoal) * 100) : 0;
      return { name: b.name, pct };
    })
    .sort((a, b) => b.pct - a.pct)[0];

  res.json({
    rows,
    totalCommissions,
    trophy: trophy ? `${trophy.name} (${trophy.pct}%)` : '—',
    base: '8% ventas + bono por puntos',
  });
});

/** Reglas de ganar/perder puntos (para mostrar). */
pointsRouter.get('/rules', requireStaff, async (_req, res) => {
  const rules = await prisma.pointsRule.findMany({ where: { active: true }, orderBy: [{ isEarn: 'desc' }, { sortOrder: 'asc' }] });
  res.json({
    earn: rules.filter((r) => r.isEarn).map((r) => ({ label: r.label, pts: `+${r.points}` })),
    deduct: rules.filter((r) => !r.isEarn).map((r) => ({ label: r.label, pts: `${r.points}` })),
  });
});

// Utilidad de formato reexportada (para otros módulos si hiciera falta).
export { fmt };
