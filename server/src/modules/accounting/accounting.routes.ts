import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireStaff, requireRole } from '../../middleware/auth.js';
import { cached, cacheKey, invalidate } from '../../utils/cache.js';
import { audit } from '../audit/audit.service.js';
import {
  TYPE_LABEL, METHOD_LABEL, cashSign,
  range, scopeOf, fmtDate, tipoId, invoiceByMethod,
} from './accounting.service.js';

export const accountingRouter = Router();

// Todo el módulo es de Administración (finanzas). El montaje en app.ts ya exige
// requireStaff + ADMIN; se repite requireRole aquí como cerrojo defensivo.
accountingRouter.use(requireStaff, requireRole('ADMIN'));

const TTL = 60_000; // los reportes contables se sondean poco; 60s recorta egress.

// ─────────────────────────────────────────────────────────────
// PLAN DE CUENTAS (categorías)
// ─────────────────────────────────────────────────────────────

accountingRouter.get('/categories', async (_req, res) => {
  const cats = await prisma.ledgerCategory.findMany({
    orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
  });
  res.json({ categories: cats });
});

const categorySchema = z.object({
  kind: z.enum(['INGRESO', 'EGRESO', 'RETIRO', 'APORTE', 'TRASLADO']),
  name: z.string().min(1, 'Escribe el nombre de la cuenta').max(80),
  code: z.string().max(20).optional(),
  sortOrder: z.number().int().optional(),
});

accountingRouter.post('/categories', async (req, res) => {
  const b = categorySchema.parse(req.body);
  const exists = await prisma.ledgerCategory.findUnique({ where: { kind_name: { kind: b.kind, name: b.name.trim() } } });
  if (exists) return res.status(409).json({ error: 'Ya existe una cuenta con ese nombre en ese grupo' });
  const c = await prisma.ledgerCategory.create({
    data: { kind: b.kind, name: b.name.trim(), code: b.code?.trim() || null, sortOrder: b.sortOrder ?? 0 },
  });
  invalidate('acc:');
  res.status(201).json({ ok: true, id: c.id });
});

accountingRouter.patch('/categories/:id', async (req, res) => {
  const b = z.object({
    name: z.string().min(1).max(80).optional(),
    code: z.string().max(20).nullable().optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  }).parse(req.body);
  const c = await prisma.ledgerCategory.findUnique({ where: { id: req.params.id } });
  if (!c) return res.status(404).json({ error: 'Cuenta no encontrada' });
  await prisma.ledgerCategory.update({
    where: { id: c.id },
    data: {
      ...(b.name !== undefined ? { name: b.name.trim() } : {}),
      ...(b.code !== undefined ? { code: b.code?.trim() || null } : {}),
      ...(b.active !== undefined ? { active: b.active } : {}),
      ...(b.sortOrder !== undefined ? { sortOrder: b.sortOrder } : {}),
    },
  });
  invalidate('acc:');
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────
// CIERRE DE PERÍODO — helpers
// ─────────────────────────────────────────────────────────────

/** ¿El mes de esa fecha está cerrado para esa sucursal (o consolidado)? */
async function periodLocked(period: string, branchId: string): Promise<boolean> {
  const lock = await prisma.accountingPeriod.findFirst({
    where: { period, status: 'CERRADO', OR: [{ branchId }, { branchId: null }] },
    select: { id: true },
  });
  return !!lock;
}

// ─────────────────────────────────────────────────────────────
// MOVIMIENTOS MANUALES (LedgerEntry)
// ─────────────────────────────────────────────────────────────

/** Lista de movimientos manuales del rango + el plan de cuentas (para el formulario). */
accountingRouter.get('/entries', async (req, res) => {
  const { from, to } = range(req.query as Record<string, unknown>);
  const scope = scopeOf(req.query as Record<string, unknown>);
  const type = (req.query.type as string | undefined) || undefined;
  const payload = await cached(
    cacheKey('acc:entries', req, { from: from.toISOString(), to: to.toISOString(), branch: scope ?? 'all', type: type ?? '' }),
    TTL,
    async () => {
      const [entries, categories, branches] = await Promise.all([
        prisma.ledgerEntry.findMany({
          where: { date: { gte: from, lte: to }, ...(scope ? { branchId: scope } : {}), ...(type ? { type } : {}) },
          orderBy: { date: 'desc' }, take: 400,
        }),
        prisma.ledgerCategory.findMany({ where: { active: true }, orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }] }),
        prisma.branch.findMany({ orderBy: { code: 'asc' }, select: { id: true, name: true } }),
      ]);
      const bname = new Map(branches.map((b) => [b.id, b.name]));
      return {
        branches,
        categories,
        entries: entries.map((e) => ({
          id: e.id, date: fmtDate(e.date), dateISO: e.date.toISOString().slice(0, 10),
          type: e.type, typeLabel: TYPE_LABEL[e.type] ?? e.type,
          category: e.categoryName || TYPE_LABEL[e.type] || e.type,
          amount: e.amount, method: METHOD_LABEL[e.method] ?? e.method,
          branchId: e.branchId, branch: bname.get(e.branchId) ?? '—',
          concept: e.concept, ncf: e.ncf, supplierRnc: e.supplierRnc, notes: e.notes,
        })),
      };
    },
  );
  res.json(payload);
});

const entrySchema = z.object({
  date: z.string().min(8, 'Falta la fecha'),
  type: z.enum(['INGRESO', 'EGRESO', 'RETIRO', 'APORTE', 'TRASLADO']),
  categoryId: z.string().optional(),
  amount: z.number().int().positive('El monto debe ser mayor que cero'),
  method: z.enum(['EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'OTRO']).default('EFECTIVO'),
  branchId: z.string().min(1, 'Selecciona la sucursal'),
  concept: z.string().max(160).optional(),
  ncf: z.string().max(30).optional(),
  supplierRnc: z.string().max(15).optional(),
  notes: z.string().max(400).optional(),
});

accountingRouter.post('/entries', async (req, res) => {
  const b = entrySchema.parse(req.body);
  const period = b.date.slice(0, 7);
  if (await periodLocked(period, b.branchId)) {
    return res.status(409).json({ error: `El mes ${period} ya está cerrado. Reábrelo para registrar movimientos.` });
  }
  let categoryName = TYPE_LABEL[b.type] ?? b.type;
  if (b.categoryId) {
    const cat = await prisma.ledgerCategory.findUnique({ where: { id: b.categoryId }, select: { name: true, kind: true } });
    if (!cat) return res.status(400).json({ error: 'Cuenta no válida' });
    if (cat.kind !== b.type) return res.status(400).json({ error: 'La cuenta no corresponde al tipo de movimiento' });
    categoryName = cat.name;
  }
  const e = await prisma.ledgerEntry.create({
    data: {
      date: new Date(`${b.date}T12:00:00`), // mediodía: evita corrimiento de día por zona horaria
      type: b.type, categoryId: b.categoryId || null, categoryName,
      amount: b.amount, method: b.method, branchId: b.branchId,
      concept: b.concept?.trim() || '', ncf: b.ncf?.trim() || null,
      supplierRnc: b.supplierRnc?.trim() || null, notes: b.notes?.trim() || null,
      createdById: req.staff!.sub,
    },
  });
  await audit(req, { action: 'LEDGER_ENTRY', entity: 'LedgerEntry', entityId: e.id, branchId: b.branchId, summary: `Registró ${TYPE_LABEL[b.type]} · ${categoryName} · RD$${b.amount.toLocaleString('en-US')}` });
  invalidate('acc:');
  res.status(201).json({ ok: true, id: e.id, message: 'Movimiento registrado' });
});

accountingRouter.patch('/entries/:id', async (req, res) => {
  const e = await prisma.ledgerEntry.findUnique({ where: { id: req.params.id } });
  if (!e) return res.status(404).json({ error: 'Movimiento no encontrado' });
  const b = entrySchema.partial().parse(req.body);
  // Bloqueo por cierre: tanto el mes original como el nuevo (si cambia la fecha).
  const oldPeriod = e.date.toISOString().slice(0, 7);
  if (await periodLocked(oldPeriod, e.branchId)) return res.status(409).json({ error: `El mes ${oldPeriod} está cerrado.` });
  if (b.date) { const np = b.date.slice(0, 7); if (await periodLocked(np, b.branchId ?? e.branchId)) return res.status(409).json({ error: `El mes ${np} está cerrado.` }); }
  let categoryName = e.categoryName;
  if (b.categoryId !== undefined) {
    if (b.categoryId) {
      const cat = await prisma.ledgerCategory.findUnique({ where: { id: b.categoryId }, select: { name: true } });
      categoryName = cat?.name ?? categoryName;
    }
  }
  await prisma.ledgerEntry.update({
    where: { id: e.id },
    data: {
      ...(b.date ? { date: new Date(`${b.date}T12:00:00`) } : {}),
      ...(b.type ? { type: b.type } : {}),
      ...(b.categoryId !== undefined ? { categoryId: b.categoryId || null, categoryName } : {}),
      ...(b.amount !== undefined ? { amount: b.amount } : {}),
      ...(b.method ? { method: b.method } : {}),
      ...(b.branchId ? { branchId: b.branchId } : {}),
      ...(b.concept !== undefined ? { concept: b.concept?.trim() || '' } : {}),
      ...(b.ncf !== undefined ? { ncf: b.ncf?.trim() || null } : {}),
      ...(b.supplierRnc !== undefined ? { supplierRnc: b.supplierRnc?.trim() || null } : {}),
      ...(b.notes !== undefined ? { notes: b.notes?.trim() || null } : {}),
    },
  });
  await audit(req, { action: 'LEDGER_ENTRY', entity: 'LedgerEntry', entityId: e.id, branchId: e.branchId, summary: `Editó movimiento contable` });
  invalidate('acc:');
  res.json({ ok: true });
});

accountingRouter.delete('/entries/:id', async (req, res) => {
  const e = await prisma.ledgerEntry.findUnique({ where: { id: req.params.id } });
  if (!e) return res.status(404).json({ error: 'Movimiento no encontrado' });
  const period = e.date.toISOString().slice(0, 7);
  if (await periodLocked(period, e.branchId)) return res.status(409).json({ error: `El mes ${period} está cerrado.` });
  await prisma.ledgerEntry.delete({ where: { id: e.id } });
  await audit(req, { action: 'LEDGER_ENTRY_VOID', entity: 'LedgerEntry', entityId: e.id, branchId: e.branchId, summary: `Eliminó ${TYPE_LABEL[e.type]} · ${e.categoryName} · RD$${e.amount.toLocaleString('en-US')}` });
  invalidate('acc:');
  res.json({ ok: true, message: 'Movimiento eliminado' });
});

// ─────────────────────────────────────────────────────────────
// LIBRO / DIARIO — unión de Ventas (Invoice) + Compras (Purchase) + Movimientos
// ─────────────────────────────────────────────────────────────

accountingRouter.get('/ledger', async (req, res) => {
  const { from, to } = range(req.query as Record<string, unknown>);
  const scope = scopeOf(req.query as Record<string, unknown>);
  const typeF = (req.query.type as string | undefined) || undefined;   // INGRESO|EGRESO|...
  const sourceF = (req.query.source as string | undefined) || undefined; // venta|compra|manual
  const payload = await cached(
    cacheKey('acc:ledger', req, { from: from.toISOString(), to: to.toISOString(), branch: scope ?? 'all', type: typeF ?? '', source: sourceF ?? '' }),
    TTL,
    async () => {
      const bw = scope ? { branchId: scope } : {};
      const [invoices, purchases, entries, branches] = await Promise.all([
        sourceF && sourceF !== 'venta' ? Promise.resolve([]) : prisma.invoice.findMany({
          where: { ...bw, status: 'PAGADA', issuedAt: { gte: from, lte: to } },
          select: { id: true, number: true, issuedAt: true, concept: true, subtotal: true, itbis: true, total: true, method: true, payments: true, branchId: true, patient: { select: { name: true } } },
          orderBy: { issuedAt: 'desc' },
        }),
        sourceF && sourceF !== 'compra' ? Promise.resolve([]) : prisma.purchase.findMany({
          where: { ...bw, purchasedAt: { gte: from, lte: to } },
          select: { id: true, supplier: true, concept: true, category: true, amount: true, itbis: true, ncf: true, purchasedAt: true, branchId: true },
          orderBy: { purchasedAt: 'desc' },
        }),
        sourceF && sourceF !== 'manual' ? Promise.resolve([]) : prisma.ledgerEntry.findMany({
          where: { ...bw, date: { gte: from, lte: to } },
          orderBy: { date: 'desc' }, take: 500,
        }),
        prisma.branch.findMany({ orderBy: { code: 'asc' }, select: { id: true, name: true } }),
      ]);
      const bname = new Map(branches.map((b) => [b.id, b.name]));

      type Row = { at: Date; date: string; source: string; type: string; concept: string; category: string; method: string; branch: string; amount: number; sign: 1 | -1; ref: string | null };
      const rows: Row[] = [];
      for (const i of invoices) {
        const lines = invoiceByMethod(i);
        rows.push({ at: i.issuedAt, date: fmtDate(i.issuedAt), source: 'venta', type: 'INGRESO', concept: i.patient?.name ? `${i.concept} · ${i.patient.name}` : i.concept, category: 'Ventas', method: lines.length > 1 ? 'Mixto' : (METHOD_LABEL[lines[0].method] ?? lines[0].method), branch: bname.get(i.branchId) ?? '—', amount: i.total, sign: 1, ref: i.number });
      }
      for (const p of purchases) {
        rows.push({ at: p.purchasedAt, date: fmtDate(p.purchasedAt), source: 'compra', type: 'EGRESO', concept: `${p.supplier} · ${p.concept}`, category: p.category ?? 'Compras', method: '—', branch: bname.get(p.branchId) ?? '—', amount: p.amount, sign: -1, ref: p.ncf });
      }
      for (const e of entries) {
        rows.push({ at: e.date, date: fmtDate(e.date), source: 'manual', type: e.type, concept: e.concept || (TYPE_LABEL[e.type] ?? e.type), category: e.categoryName || (TYPE_LABEL[e.type] ?? e.type), method: METHOD_LABEL[e.method] ?? e.method, branch: bname.get(e.branchId) ?? '—', amount: e.amount, sign: cashSign(e.type), ref: e.ncf });
      }
      const filtered = typeF ? rows.filter((r) => r.type === typeF) : rows;
      filtered.sort((a, b) => b.at.getTime() - a.at.getTime());

      const totals = filtered.reduce(
        (acc, r) => {
          if (r.type === 'INGRESO') acc.ingresos += r.amount;
          else if (r.type === 'EGRESO') acc.egresos += r.amount;
          acc.neto += r.sign * r.amount;
          return acc;
        },
        { ingresos: 0, egresos: 0, neto: 0 },
      );

      return {
        branches,
        totals: { ...totals, count: filtered.length },
        rows: filtered.slice(0, 500).map(({ at, ...r }) => { void at; return r; }),
      };
    },
  );
  res.json(payload);
});

// ─────────────────────────────────────────────────────────────
// ESTADO DE RESULTADOS (P&L)
// ─────────────────────────────────────────────────────────────

accountingRouter.get('/pnl', async (req, res) => {
  const { from, to } = range(req.query as Record<string, unknown>);
  const scope = scopeOf(req.query as Record<string, unknown>);
  const payload = await cached(
    cacheKey('acc:pnl', req, { from: from.toISOString(), to: to.toISOString(), branch: scope ?? 'all' }),
    TTL,
    async () => {
      const bw = scope ? { branchId: scope } : {};
      const [ventasAgg, itbisAgg, comprasPorCat, entries] = await Promise.all([
        // Ventas netas (subtotal, ya sin ITBIS): base real de ingreso operativo.
        prisma.invoice.aggregate({ where: { ...bw, status: 'PAGADA', issuedAt: { gte: from, lte: to } }, _sum: { subtotal: true, itbis: true, total: true }, _count: true }),
        prisma.invoice.aggregate({ where: { ...bw, status: 'PAGADA', issuedAt: { gte: from, lte: to } }, _sum: { discount: true } }),
        prisma.purchase.groupBy({ by: ['category'], where: { ...bw, purchasedAt: { gte: from, lte: to } }, _sum: { amount: true } }),
        prisma.ledgerEntry.findMany({ where: { ...bw, date: { gte: from, lte: to } }, select: { type: true, categoryName: true, amount: true } }),
      ]);

      const ventasNetas = ventasAgg._sum.subtotal ?? 0;
      const itbisCobrado = ventasAgg._sum.itbis ?? 0;
      const ventasBruto = ventasAgg._sum.total ?? 0;

      // Ingresos operativos: ventas + INGRESO manual por categoría.
      const ingresos = new Map<string, number>();
      ingresos.set('Ventas de servicios y productos', ventasNetas);
      // Egresos operativos: compras por categoría + EGRESO manual por categoría.
      const egresos = new Map<string, number>();
      for (const c of comprasPorCat) {
        const key = c.category ?? 'Compras / Insumos';
        egresos.set(key, (egresos.get(key) ?? 0) + (c._sum.amount ?? 0));
      }
      // Memorandos (fuera de la utilidad): retiros, aportes, traslados.
      const memo = { retiros: 0, aportes: 0, traslados: 0 };
      for (const e of entries) {
        if (e.type === 'INGRESO') ingresos.set(e.categoryName || 'Otros ingresos', (ingresos.get(e.categoryName || 'Otros ingresos') ?? 0) + e.amount);
        else if (e.type === 'EGRESO') egresos.set(e.categoryName || 'Gastos varios', (egresos.get(e.categoryName || 'Gastos varios') ?? 0) + e.amount);
        else if (e.type === 'RETIRO') memo.retiros += e.amount;
        else if (e.type === 'APORTE') memo.aportes += e.amount;
        else if (e.type === 'TRASLADO') memo.traslados += e.amount;
      }

      const ingresoLines = [...ingresos.entries()].filter(([, v]) => v !== 0).map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);
      const egresoLines = [...egresos.entries()].filter(([, v]) => v !== 0).map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);
      const totalIngresos = ingresoLines.reduce((s, l) => s + l.amount, 0);
      const totalEgresos = egresoLines.reduce((s, l) => s + l.amount, 0);
      const utilidad = totalIngresos - totalEgresos;

      return {
        period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
        ingresos: ingresoLines, egresos: egresoLines,
        totalIngresos, totalEgresos, utilidad,
        margen: totalIngresos > 0 ? Math.round((utilidad / totalIngresos) * 100) : 0,
        memo: { ...memo, itbisCobrado, ventasBruto, recibos: ventasAgg._count, descuentos: itbisAgg._sum.discount ?? 0 },
      };
    },
  );
  res.json(payload);
});

// ─────────────────────────────────────────────────────────────
// FLUJO DE CAJA — entradas por método, salidas por categoría, neto
// ─────────────────────────────────────────────────────────────

accountingRouter.get('/cashflow', async (req, res) => {
  const { from, to } = range(req.query as Record<string, unknown>);
  const scope = scopeOf(req.query as Record<string, unknown>);
  const payload = await cached(
    cacheKey('acc:cashflow', req, { from: from.toISOString(), to: to.toISOString(), branch: scope ?? 'all' }),
    TTL,
    async () => {
      const bw = scope ? { branchId: scope } : {};
      const [invoices, comprasAgg, entries] = await Promise.all([
        prisma.invoice.findMany({ where: { ...bw, status: 'PAGADA', issuedAt: { gte: from, lte: to } }, select: { method: true, total: true, payments: true } }),
        prisma.purchase.aggregate({ where: { ...bw, purchasedAt: { gte: from, lte: to } }, _sum: { amount: true } }),
        prisma.ledgerEntry.findMany({ where: { ...bw, date: { gte: from, lte: to } }, select: { type: true, method: true, amount: true, categoryName: true } }),
      ]);

      const entradasMet = new Map<string, number>();
      for (const i of invoices) for (const p of invoiceByMethod(i)) entradasMet.set(p.method, (entradasMet.get(p.method) ?? 0) + p.amount);
      const salidas = new Map<string, number>();
      salidas.set('Compras / Gastos a proveedores', comprasAgg._sum.amount ?? 0);

      for (const e of entries) {
        if (cashSign(e.type) === 1) entradasMet.set(e.method, (entradasMet.get(e.method) ?? 0) + e.amount);
        else salidas.set(e.categoryName || TYPE_LABEL[e.type] || e.type, (salidas.get(e.categoryName || TYPE_LABEL[e.type] || e.type) ?? 0) + e.amount);
      }

      const entradas = [...entradasMet.entries()].filter(([, v]) => v !== 0).map(([m, amount]) => ({ label: METHOD_LABEL[m] ?? m, amount })).sort((a, b) => b.amount - a.amount);
      const salidasArr = [...salidas.entries()].filter(([, v]) => v !== 0).map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);
      const totalEntradas = entradas.reduce((s, l) => s + l.amount, 0);
      const totalSalidas = salidasArr.reduce((s, l) => s + l.amount, 0);
      return {
        entradas, salidas: salidasArr,
        totalEntradas, totalSalidas, neto: totalEntradas - totalSalidas,
      };
    },
  );
  res.json(payload);
});

// ─────────────────────────────────────────────────────────────
// ITBIS — débito (ventas) vs crédito (compras) = a pagar
// ─────────────────────────────────────────────────────────────

accountingRouter.get('/itbis', async (req, res) => {
  const { from, to } = range(req.query as Record<string, unknown>);
  const scope = scopeOf(req.query as Record<string, unknown>);
  const payload = await cached(
    cacheKey('acc:itbis', req, { from: from.toISOString(), to: to.toISOString(), branch: scope ?? 'all' }),
    TTL,
    async () => {
      const bw = scope ? { branchId: scope } : {};
      const [ventas, compras] = await Promise.all([
        prisma.invoice.aggregate({ where: { ...bw, status: 'PAGADA', issuedAt: { gte: from, lte: to } }, _sum: { itbis: true, subtotal: true }, _count: true }),
        prisma.purchase.aggregate({ where: { ...bw, purchasedAt: { gte: from, lte: to } }, _sum: { itbis: true, amount: true }, _count: true }),
      ]);
      const debito = ventas._sum.itbis ?? 0;
      const credito = compras._sum.itbis ?? 0;
      return {
        debito, credito, aPagar: Math.max(0, debito - credito), saldoFavor: Math.max(0, credito - debito),
        ventas: { base: ventas._sum.subtotal ?? 0, itbis: debito, recibos: ventas._count },
        compras: { base: (compras._sum.amount ?? 0) - credito, itbis: credito, facturas: compras._count },
      };
    },
  );
  res.json(payload);
});

// ─────────────────────────────────────────────────────────────
// DGII 607 (VENTAS) y 606 (COMPRAS/GASTOS) — filas por NCF (CSV lo arma el front)
// ─────────────────────────────────────────────────────────────

accountingRouter.get('/dgii/607', async (req, res) => {
  const { from, to } = range(req.query as Record<string, unknown>);
  const scope = scopeOf(req.query as Record<string, unknown>);
  const payload = await cached(
    cacheKey('acc:607', req, { from: from.toISOString(), to: to.toISOString(), branch: scope ?? 'all' }),
    TTL,
    async () => {
      const bw = scope ? { branchId: scope } : {};
      const all = await prisma.invoice.findMany({
        where: { ...bw, status: 'PAGADA', issuedAt: { gte: from, lte: to } },
        select: { number: true, ncf: true, clientRnc: true, clientName: true, subtotal: true, itbis: true, total: true, issuedAt: true },
        orderBy: { issuedAt: 'asc' },
      });
      const rows = all.filter((i) => i.ncf).map((i) => ({
        rnc: (i.clientRnc || '').replace(/\D/g, ''), tipoId: tipoId(i.clientRnc), cliente: i.clientName ?? '',
        ncf: i.ncf!, fecha: i.issuedAt.toISOString().slice(0, 10).replace(/-/g, ''),
        montoBase: i.subtotal, itbis: i.itbis, total: i.total, numero: i.number,
      }));
      const sinNcf = all.length - rows.length;
      const tot = rows.reduce((a, r) => ({ base: a.base + r.montoBase, itbis: a.itbis + r.itbis, total: a.total + r.total }), { base: 0, itbis: 0, total: 0 });
      return { rows, count: rows.length, sinNcf, totales: tot };
    },
  );
  res.json(payload);
});

accountingRouter.get('/dgii/606', async (req, res) => {
  const { from, to } = range(req.query as Record<string, unknown>);
  const scope = scopeOf(req.query as Record<string, unknown>);
  const payload = await cached(
    cacheKey('acc:606', req, { from: from.toISOString(), to: to.toISOString(), branch: scope ?? 'all' }),
    TTL,
    async () => {
      const bw = scope ? { branchId: scope } : {};
      const [compras, entries] = await Promise.all([
        prisma.purchase.findMany({
          where: { ...bw, purchasedAt: { gte: from, lte: to } },
          select: { supplier: true, supplierRnc: true, ncf: true, amount: true, itbis: true, purchasedAt: true, concept: true },
          orderBy: { purchasedAt: 'asc' },
        }),
        // Gastos manuales que llevan NCF (nómina no lleva; alquiler/servicios a veces sí).
        prisma.ledgerEntry.findMany({ where: { ...bw, type: 'EGRESO', ncf: { not: null }, date: { gte: from, lte: to } }, select: { concept: true, categoryName: true, supplierRnc: true, ncf: true, amount: true, date: true } }),
      ]);
      const fromPurchase = compras.filter((p) => p.ncf).map((p) => ({
        rnc: (p.supplierRnc || '').replace(/\D/g, ''), tipoId: tipoId(p.supplierRnc), proveedor: p.supplier,
        ncf: p.ncf!, fecha: p.purchasedAt.toISOString().slice(0, 10).replace(/-/g, ''),
        montoBase: p.amount - p.itbis, itbis: p.itbis, total: p.amount, concepto: p.concept,
      }));
      const fromManual = entries.map((e) => ({
        rnc: (e.supplierRnc || '').replace(/\D/g, ''), tipoId: tipoId(e.supplierRnc), proveedor: e.categoryName,
        ncf: e.ncf!, fecha: e.date.toISOString().slice(0, 10).replace(/-/g, ''),
        montoBase: e.amount, itbis: 0, total: e.amount, concepto: e.concept,
      }));
      const rows = [...fromPurchase, ...fromManual].sort((a, b) => a.fecha.localeCompare(b.fecha));
      const sinNcf = compras.length - fromPurchase.length;
      const sinRnc = rows.filter((r) => !r.rnc).length;
      const tot = rows.reduce((a, r) => ({ base: a.base + r.montoBase, itbis: a.itbis + r.itbis, total: a.total + r.total }), { base: 0, itbis: 0, total: 0 });
      return { rows, count: rows.length, sinNcf, sinRnc, totales: tot };
    },
  );
  res.json(payload);
});

// ─────────────────────────────────────────────────────────────
// CIERRES DE PERÍODO
// ─────────────────────────────────────────────────────────────

accountingRouter.get('/periods', async (req, res) => {
  const periods = await prisma.accountingPeriod.findMany({ orderBy: [{ period: 'desc' }, { branchId: 'asc' }] });
  const branches = await prisma.branch.findMany({ orderBy: { code: 'asc' }, select: { id: true, name: true } });
  const bname = new Map(branches.map((b) => [b.id, b.name]));
  res.json({
    branches,
    periods: periods.map((p) => ({
      id: p.id, period: p.period, branch: p.branchId ? (bname.get(p.branchId) ?? '—') : 'Consolidado (todas)',
      branchId: p.branchId, status: p.status,
      totalIngresos: p.totalIngresos, totalEgresos: p.totalEgresos, utilidad: p.utilidad,
      closedAt: fmtDate(p.closedAt), note: p.note,
    })),
  });
});

const closeSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/, 'Período inválido (YYYY-MM)'),
  branchId: z.string().optional(), // ausente/'' = consolidado (todas)
  note: z.string().max(300).optional(),
});

accountingRouter.post('/periods/close', async (req, res) => {
  const b = closeSchema.parse(req.body);
  const branchId = b.branchId && b.branchId !== 'all' ? b.branchId : null;
  const existing = await prisma.accountingPeriod.findFirst({ where: { period: b.period, branchId } });
  if (existing) return res.status(409).json({ error: 'Ese período ya está cerrado para ese alcance' });

  // Snapshot de totales del mes (misma base que el P&L).
  const from = new Date(`${b.period}-01T00:00:00`);
  const to = new Date(from); to.setMonth(to.getMonth() + 1);
  const bw = branchId ? { branchId } : {};
  const [ventas, comprasAgg, entries] = await Promise.all([
    prisma.invoice.aggregate({ where: { ...bw, status: 'PAGADA', issuedAt: { gte: from, lt: to } }, _sum: { subtotal: true } }),
    prisma.purchase.aggregate({ where: { ...bw, purchasedAt: { gte: from, lt: to } }, _sum: { amount: true } }),
    prisma.ledgerEntry.findMany({ where: { ...bw, date: { gte: from, lt: to } }, select: { type: true, amount: true } }),
  ]);
  let ingresos = ventas._sum.subtotal ?? 0;
  let egresos = comprasAgg._sum.amount ?? 0;
  for (const e of entries) { if (e.type === 'INGRESO') ingresos += e.amount; else if (e.type === 'EGRESO') egresos += e.amount; }

  const p = await prisma.accountingPeriod.create({
    data: { period: b.period, branchId, totalIngresos: ingresos, totalEgresos: egresos, utilidad: ingresos - egresos, closedById: req.staff!.sub, note: b.note?.trim() || null },
  });
  await audit(req, { action: 'PERIOD_CLOSE', entity: 'AccountingPeriod', entityId: p.id, branchId, summary: `Cerró el período ${b.period}${branchId ? '' : ' (consolidado)'} · utilidad RD$${(ingresos - egresos).toLocaleString('en-US')}` });
  invalidate('acc:');
  res.status(201).json({ ok: true, id: p.id, message: `Período ${b.period} cerrado` });
});

accountingRouter.post('/periods/reopen', async (req, res) => {
  const id = z.object({ id: z.string().min(1) }).parse(req.body).id;
  const p = await prisma.accountingPeriod.findUnique({ where: { id } });
  if (!p) return res.status(404).json({ error: 'Cierre no encontrado' });
  await prisma.accountingPeriod.delete({ where: { id } });
  await audit(req, { action: 'PERIOD_REOPEN', entity: 'AccountingPeriod', entityId: id, branchId: p.branchId, summary: `Reabrió el período ${p.period}` });
  invalidate('acc:');
  res.json({ ok: true, message: `Período ${p.period} reabierto` });
});
