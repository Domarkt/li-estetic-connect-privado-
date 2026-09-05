import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireStaff, requireRole, branchScope, assertBranchAccess } from '../../middleware/auth.js';
import { cached, cacheKey } from '../../utils/cache.js';

export const purchasesRouter = Router();

// El control de compras/facturas es de administración (gasto del negocio).
const GESTORES = ['ADMIN', 'RECEPCIONISTA'] as const;

/**
 * Lista de compras del mes indicado (?month=YYYY-MM; por defecto el mes actual).
 * Admin ve por sucursal (?branch) o todas; recepción, su sucursal.
 * No se devuelve la imagen de la factura en la lista (puede pesar): se pide aparte.
 */
purchasesRouter.get('/', requireStaff, requireRole(...GESTORES), branchScope, async (req, res) => {
  const month = (req.query.month as string | undefined) ?? new Date().toISOString().slice(0, 7);
  const payload = await cached(cacheKey('pur:list', req, { month }), 60_000, async () => {
    const desde = new Date(`${month}-01T00:00:00`);
    const hasta = new Date(desde); hasta.setMonth(hasta.getMonth() + 1);

    const where: Record<string, unknown> = { purchasedAt: { gte: desde, lt: hasta } };
    if (req.scopeBranchId) where.branchId = req.scopeBranchId;

    // No traemos invoiceImage (base64 pesado): solo los ids que SÍ tienen factura,
    // para marcar hasInvoice. Antes la lista arrastraba todas las imágenes → egress alto.
    const [rows, conFactura, branches] = await Promise.all([
      prisma.purchase.findMany({
        where, orderBy: { purchasedAt: 'desc' },
        select: { id: true, branchId: true, supplier: true, concept: true, category: true, amount: true, ncf: true, purchasedAt: true, notes: true },
      }),
      prisma.purchase.findMany({ where: { ...where, invoiceImage: { not: null } }, select: { id: true } }),
      req.staff!.role === 'ADMIN' ? prisma.branch.findMany({ orderBy: { code: 'asc' }, select: { id: true, name: true } }) : Promise.resolve([]),
    ]);
    const nombres = new Map((await prisma.branch.findMany({ select: { id: true, name: true } })).map((b) => [b.id, b.name]));
    const conImg = new Set(conFactura.map((p) => p.id));

    const total = rows.reduce((s, r) => s + r.amount, 0);
    return {
      month, total,
      branches,
      purchases: rows.map((r) => ({
        id: r.id, branchId: r.branchId, branch: nombres.get(r.branchId) ?? '—',
        supplier: r.supplier, concept: r.concept, category: r.category,
        amount: r.amount, ncf: r.ncf,
        date: r.purchasedAt.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' }),
        purchasedAt: r.purchasedAt.toISOString().slice(0, 10),
        hasInvoice: conImg.has(r.id), notes: r.notes,
      })),
    };
  });
  res.json(payload);
});

/** Imagen de la factura de una compra (base64). */
purchasesRouter.get('/:id/invoice', requireStaff, requireRole(...GESTORES), async (req, res) => {
  const p = await prisma.purchase.findUnique({ where: { id: req.params.id } });
  if (!p) return res.status(404).json({ error: 'Compra no encontrada' });
  if (!assertBranchAccess(req, p.branchId)) return res.status(403).json({ error: 'Compra de otra sucursal' });
  if (!p.invoiceImage) return res.status(404).json({ error: 'Esta compra no tiene factura anexa' });
  res.json({ invoiceImage: p.invoiceImage });
});

const createSchema = z.object({
  supplier: z.string().min(1, 'Escribe el proveedor'),
  concept: z.string().min(1, 'Escribe el concepto'),
  category: z.string().optional(),
  amount: z.number().int().positive('El monto debe ser mayor que cero'),
  ncf: z.string().optional(),
  purchasedAt: z.string().min(8, 'Falta la fecha'),
  branchId: z.string().optional(),
  invoiceImage: z.string().max(3_000_000).optional(), // imagen comprimida (~<2MB)
  notes: z.string().max(500).optional(),
});

/** Registrar una compra (con o sin imagen de factura). */
purchasesRouter.post('/', requireStaff, requireRole(...GESTORES), branchScope, async (req, res) => {
  const b = createSchema.parse(req.body);
  const branchId = b.branchId ?? req.scopeBranchId;
  if (!branchId) return res.status(400).json({ error: 'Selecciona una sucursal' });
  if (!assertBranchAccess(req, branchId)) return res.status(403).json({ error: 'Sucursal fuera de tu alcance' });

  const p = await prisma.purchase.create({
    data: {
      branchId, supplier: b.supplier.trim(), concept: b.concept.trim(),
      category: b.category ?? null, amount: b.amount, ncf: b.ncf?.trim() || null,
      purchasedAt: new Date(`${b.purchasedAt}T00:00:00`),
      invoiceImage: b.invoiceImage ?? null, notes: b.notes?.trim() || null,
      createdById: req.staff!.sub,
    },
  });
  res.status(201).json({ ok: true, id: p.id, message: 'Compra registrada' });
});

/** Eliminar una compra (solo Admin). */
purchasesRouter.delete('/:id', requireStaff, requireRole('ADMIN'), async (req, res) => {
  const p = await prisma.purchase.findUnique({ where: { id: req.params.id } });
  if (!p) return res.status(404).json({ error: 'Compra no encontrada' });
  await prisma.purchase.delete({ where: { id: p.id } });
  res.json({ ok: true, message: 'Compra eliminada' });
});
