import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireStaff, requireRole, branchScope, assertBranchAccess } from '../../middleware/auth.js';
import { adjustStock } from './inventory.service.js';

export const inventoryRouter = Router();

// Ver inventario: Admin y Recepción. Editar (entrada/consumo/ajuste/mínimos): solo Admin.
// Recepción solo puede registrar SALIDAS (p. ej. enviar toallas/sábanas a lavar).
const viewers = ['ADMIN', 'RECEPCIONISTA'] as const;

/**
 * Inventario por sucursal. ?kind=PRODUCTO|INSUMO (por defecto ambos).
 * - Personal de sucursal: su sucursal.
 * - Admin: la sucursal por ?branch=; con "Todas" muestra el desglose por sucursal.
 */
inventoryRouter.get('/', requireStaff, requireRole(...viewers), branchScope, async (req, res) => {
  const kindQ = req.query.kind as string | undefined;
  const kinds = kindQ ? [kindQ] : ['PRODUCTO', 'INSUMO'];

  const [items, branches] = await Promise.all([
    prisma.catalogItem.findMany({
      where: { active: true, kind: { in: kinds as never[] } },
      include: { stockLevels: req.scopeBranchId ? { where: { branchId: req.scopeBranchId } } : true },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    }),
    prisma.branch.findMany({ orderBy: { code: 'asc' }, select: { id: true, name: true, code: true } }),
  ]);

  const byId = new Map(branches.map((b) => [b.id, b]));
  res.json({
    scope: req.scopeBranchId ?? 'all',
    items: items.map((it) => {
      const levels = it.stockLevels;
      if (req.scopeBranchId) {
        const lv = levels[0];
        const qty = lv?.qty ?? 0;
        const minQty = lv?.minQty ?? 0;
        return { id: it.id, kind: it.kind, name: it.name, unit: it.unit, price: it.price, qty, minQty, low: qty <= minQty };
      }
      // Admin "Todas": total + desglose por sucursal.
      const total = levels.reduce((s, l) => s + l.qty, 0);
      return {
        id: it.id, kind: it.kind, name: it.name, unit: it.unit, price: it.price,
        qty: total, minQty: 0, low: levels.some((l) => l.qty <= l.minQty && l.minQty > 0),
        levels: levels.map((l) => ({ branchId: l.branchId, branch: byId.get(l.branchId)?.name ?? '', qty: l.qty, minQty: l.minQty, low: l.qty <= l.minQty })),
      };
    }),
    branches,
  });
});

const adjustSchema = z.object({
  catalogItemId: z.string(),
  branchId: z.string().optional(), // admin puede elegir; personal usa la suya
  delta: z.number().int(),
  reason: z.enum(['ENTRADA', 'CONSUMO', 'AJUSTE', 'SALIDA']),
  note: z.string().optional(),
});

/** Registra entrada, consumo, ajuste o salida de stock en una sucursal.
 *  Recepción solo puede SALIDA (enviar a lavar, etc.); el resto es solo Admin. */
inventoryRouter.post('/adjust', requireStaff, requireRole(...viewers), branchScope, async (req, res) => {
  const b = adjustSchema.parse(req.body);
  if (req.staff!.role !== 'ADMIN' && b.reason !== 'SALIDA') {
    return res.status(403).json({ error: 'Solo puedes registrar salidas del inventario' });
  }
  const branchId = req.staff!.role === 'ADMIN' ? (b.branchId ?? req.scopeBranchId) : req.staff!.branchId;
  if (!branchId) return res.status(400).json({ error: 'Selecciona una sucursal' });
  if (!assertBranchAccess(req, branchId)) return res.status(403).json({ error: 'Sucursal no permitida' });
  if (b.delta === 0) return res.status(400).json({ error: 'La cantidad no puede ser cero' });

  const item = await prisma.catalogItem.findUnique({ where: { id: b.catalogItemId } });
  if (!item) return res.status(404).json({ error: 'Producto/insumo no encontrado' });

  const level = await adjustStock({
    branchId, catalogItemId: b.catalogItemId, delta: b.delta,
    reason: b.reason, note: b.note, createdById: req.staff!.sub,
  });
  res.json({ ok: true, qty: level.qty, message: `Stock actualizado · ${item.name}: ${level.qty} ${item.unit ?? 'u'}` });
});

const minSchema = z.object({ catalogItemId: z.string(), branchId: z.string().optional(), minQty: z.number().int().nonnegative() });

/** Define el umbral de alerta de stock bajo para un ítem en una sucursal (solo Admin). */
inventoryRouter.post('/min', requireStaff, requireRole('ADMIN'), branchScope, async (req, res) => {
  const b = minSchema.parse(req.body);
  const branchId = req.staff!.role === 'ADMIN' ? (b.branchId ?? req.scopeBranchId) : req.staff!.branchId;
  if (!branchId) return res.status(400).json({ error: 'Selecciona una sucursal' });
  if (!assertBranchAccess(req, branchId)) return res.status(403).json({ error: 'Sucursal no permitida' });

  await prisma.stockLevel.upsert({
    where: { branchId_catalogItemId: { branchId, catalogItemId: b.catalogItemId } },
    create: { branchId, catalogItemId: b.catalogItemId, qty: 0, minQty: b.minQty },
    update: { minQty: b.minQty },
  });
  res.json({ ok: true, message: 'Umbral de alerta actualizado' });
});

/** Movimientos recientes de una sucursal (traza del inventario). */
inventoryRouter.get('/movements', requireStaff, requireRole('ADMIN', 'RECEPCIONISTA'), branchScope, async (req, res) => {
  const where = req.scopeBranchId ? { branchId: req.scopeBranchId } : {};
  const moves = await prisma.stockMovement.findMany({
    where, include: { catalogItem: { select: { name: true, unit: true } } },
    orderBy: { createdAt: 'desc' }, take: 50,
  });
  res.json(moves.map((m) => ({
    id: m.id, name: m.catalogItem.name, unit: m.catalogItem.unit,
    delta: m.delta, reason: m.reason, note: m.note,
    date: m.createdAt.toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
  })));
});
