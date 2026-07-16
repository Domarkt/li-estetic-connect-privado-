import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireStaff, requireRole, branchScope, assertBranchAccess } from '../../middleware/auth.js';
import { adjustStock } from './inventory.service.js';
import { notifyRole } from '../notifications/notifications.service.js';
import { sendGenericAlert } from '../mail/mail.service.js';

export const inventoryRouter = Router();

// Ver inventario: Admin y Recepción.
// Recepción: solo INSUMOS, y solo ENTRADA (recibir, p. ej. toallas que vuelven de
//   lavar) y SALIDA (enviar a lavar). No hace consumo/ajuste/mínimos ni toca productos.
// Admin: control total sobre todo.
const viewers = ['ADMIN', 'RECEPCIONISTA'] as const;

/** Código corto para el comprobante de movimiento de insumos. */
function movementCode(reason: string) {
  const p = reason === 'ENTRADA' ? 'ENT' : reason === 'SALIDA' ? 'SAL' : 'MOV';
  return `${p}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

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
 *  Recepción: solo ENTRADA/SALIDA de INSUMOS (genera comprobante y avisa al admin).
 *  Admin: cualquier movimiento sobre productos e insumos. */
inventoryRouter.post('/adjust', requireStaff, requireRole(...viewers), branchScope, async (req, res) => {
  const b = adjustSchema.parse(req.body);
  const isAdmin = req.staff!.role === 'ADMIN';

  const branchId = isAdmin ? (b.branchId ?? req.scopeBranchId) : req.staff!.branchId;
  if (!branchId) return res.status(400).json({ error: 'Selecciona una sucursal' });
  if (!assertBranchAccess(req, branchId)) return res.status(403).json({ error: 'Sucursal no permitida' });
  if (b.delta === 0) return res.status(400).json({ error: 'La cantidad no puede ser cero' });

  const item = await prisma.catalogItem.findUnique({ where: { id: b.catalogItemId } });
  if (!item) return res.status(404).json({ error: 'Producto/insumo no encontrado' });

  // Recepción: solo insumos y solo entradas/salidas.
  if (!isAdmin) {
    if (item.kind !== 'INSUMO') return res.status(403).json({ error: 'Solo puedes mover insumos operativos' });
    if (b.reason !== 'ENTRADA' && b.reason !== 'SALIDA') {
      return res.status(403).json({ error: 'Solo puedes registrar entradas o salidas de insumos' });
    }
  }

  const level = await adjustStock({
    branchId, catalogItemId: b.catalogItemId, delta: b.delta,
    reason: b.reason, note: b.note, createdById: req.staff!.sub,
  });

  // Movimiento de recepción (entrada/salida): genera comprobante y avisa al admin.
  let document: Record<string, unknown> | undefined;
  if (!isAdmin && (b.reason === 'ENTRADA' || b.reason === 'SALIDA')) {
    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { name: true } });
    const qty = Math.abs(b.delta);
    const tipo = b.reason === 'ENTRADA' ? 'Entrada' : 'Salida';
    document = {
      code: movementCode(b.reason),
      type: b.reason,
      typeLabel: tipo,
      item: item.name,
      qty,
      unit: item.unit ?? 'u',
      branch: branch?.name ?? '',
      by: req.staff!.name,
      note: b.note ?? null,
      date: new Date().toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      qtyAfter: level.qty,
    };
    // Aviso al admin: notificación interna + correo.
    await notifyRole('ADMIN', {
      type: 'GENERAL',
      title: `${tipo} de insumo (${branch?.name ?? ''})`,
      body: `${req.staff!.name} registró ${tipo.toLowerCase()} de ${qty} ${item.unit ?? 'u'} · ${item.name}${b.note ? ` · ${b.note}` : ''}. Existencia: ${level.qty}.`,
      link: '/app/inventario',
    });
    try {
      const admins = await prisma.user.findMany({
        where: { role: 'ADMIN', active: true },
        select: { email: true },
      });
      for (const a of admins) {
        if (!a.email) continue;
        await sendGenericAlert(a.email, {
          subject: `${tipo} de insumo · ${item.name} · ${branch?.name ?? ''}`,
          heading: `${tipo} de insumo registrada`,
          lines: [
            `Comprobante: ${(document as { code: string }).code}`,
            `Insumo: ${item.name}`,
            `Cantidad: ${qty} ${item.unit ?? 'u'}`,
            `Existencia luego: ${level.qty} ${item.unit ?? 'u'}`,
            `Sucursal: ${branch?.name ?? ''}`,
            `Registrado por: ${req.staff!.name}`,
            ...(b.note ? [`Nota: ${b.note}`] : []),
          ],
        });
      }
    } catch {
      /* el correo no debe bloquear el movimiento */
    }
  }

  res.json({ ok: true, qty: level.qty, message: `Stock actualizado · ${item.name}: ${level.qty} ${item.unit ?? 'u'}`, document });
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
