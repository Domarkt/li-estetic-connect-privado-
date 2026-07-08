import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import { requireStaff, branchScope } from '../../middleware/auth.js';

export const branchesRouter = Router();

/**
 * Lista pública de sucursales (solo datos no sensibles) para poblar el
 * selector del login interno antes de autenticarse.
 */
branchesRouter.get('/public', async (_req, res) => {
  const branches = await prisma.branch.findMany({
    orderBy: { code: 'asc' },
    select: { id: true, code: true, name: true, place: true, dotColor: true },
  });
  res.json(branches);
});

/**
 * Lista de sucursales visibles para el usuario.
 * - ADMIN: las 3.
 * - Personal de sucursal: solo la suya (aislamiento).
 */
branchesRouter.get('/', requireStaff, branchScope, async (req, res) => {
  const where = req.staff!.role === 'ADMIN' ? {} : { id: req.staff!.branchId! };
  const branches = await prisma.branch.findMany({ where, orderBy: { code: 'asc' } });
  res.json(branches);
});

/** Métricas resumidas por sucursal (Vista General admin / Sucursales). */
branchesRouter.get('/summary', requireStaff, branchScope, async (req, res) => {
  const where = req.staff!.role === 'ADMIN' ? {} : { id: req.staff!.branchId! };
  const branches = await prisma.branch.findMany({ where, orderBy: { code: 'asc' } });
  res.json(
    branches.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      place: b.place,
      dotColor: b.dotColor,
      monthlyGoal: b.monthlyGoal,
      dailyGoal: b.dailyGoal,
      perAsesorGoal: b.perAsesorGoal,
    })),
  );
});
