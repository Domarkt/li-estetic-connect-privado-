import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireStaff, requireRole, branchScope, assertBranchAccess } from '../../middleware/auth.js';
import { notify, notifyRole } from '../notifications/notifications.service.js';

export const cashCloseRouter = Router();

const DENOMS = [2000, 1000, 500, 200, 100, 50, 25, 10, 5, 1];
type MethodTotals = { EFECTIVO: number; TARJETA: number; TRANSFERENCIA: number; AZUL: number };

function dayBounds(dateStr?: string) {
  const base = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return { start, end };
}

/** Suma esperada por método según las facturas PAGADAS del día en la sucursal. */
async function expectedForDay(branchId: string, start: Date, end: Date): Promise<MethodTotals> {
  const invs = await prisma.invoice.findMany({
    where: { branchId, status: 'PAGADA', issuedAt: { gte: start, lt: end } },
  });
  const t: MethodTotals = { EFECTIVO: 0, TARJETA: 0, TRANSFERENCIA: 0, AZUL: 0 };
  for (const i of invs) {
    const pays = (i.payments ?? null) as { method: keyof MethodTotals; amount: number }[] | null;
    if (Array.isArray(pays) && pays.length) pays.forEach((p) => { t[p.method] = (t[p.method] ?? 0) + p.amount; });
    else t[i.method as keyof MethodTotals] += i.total;
  }
  return t;
}

function cashFromDenoms(denoms: Record<string, number>): number {
  return DENOMS.reduce((s, d) => s + d * (Number(denoms[String(d)]) || 0), 0);
}

// ─────────── RECEPCIÓN: conteo ciego ───────────

const submitSchema = z.object({
  denominations: z.record(z.number().int().nonnegative()).default({}),
  cardVouchers: z.array(z.number().int().nonnegative()).default([]),
  countedTransfer: z.number().int().nonnegative().default(0),
  countedAzul: z.number().int().nonnegative().default(0),
  notes: z.string().optional(),
});

/**
 * Estado del cierre de HOY para la recepción (sin exponer lo esperado).
 * Devuelve el conteo ya ingresado (si existe) para poder editarlo.
 */
cashCloseRouter.get('/today', requireStaff, requireRole('RECEPCIONISTA', 'ADMIN'), branchScope, async (req, res) => {
  const branchId = req.staff!.role === 'ADMIN' ? (req.scopeBranchId ?? null) : req.staff!.branchId;
  if (!branchId) return res.status(400).json({ error: 'Selecciona una sucursal' });
  const { start } = dayBounds();
  const close = await prisma.cashClose.findUnique({ where: { branchId_day: { branchId, day: start } } });
  res.json({
    denominations: DENOMS,
    status: close?.status ?? null,
    submitted: !!close,
    counted: close ? {
      denominations: close.denominations, cardVouchers: close.cardVouchers,
      countedCash: close.countedCash, countedCard: close.countedCard,
      countedTransfer: close.countedTransfer, countedAzul: close.countedAzul,
    } : null,
    // Nota: NO se envía lo esperado ni la diferencia a recepción (conteo ciego).
  });
});

/** Enviar el conteo del día (recepción). Calcula y guarda el snapshot esperado. */
cashCloseRouter.post('/', requireStaff, requireRole('RECEPCIONISTA', 'ADMIN'), branchScope, async (req, res) => {
  const b = submitSchema.parse(req.body);
  const branchId = req.staff!.role === 'ADMIN' ? (req.body.branchId ?? req.scopeBranchId) : req.staff!.branchId;
  if (!branchId) return res.status(400).json({ error: 'Selecciona una sucursal' });
  if (!assertBranchAccess(req, branchId)) return res.status(403).json({ error: 'Sucursal no permitida' });

  const { start, end } = dayBounds();
  const existing = await prisma.cashClose.findUnique({ where: { branchId_day: { branchId, day: start } } });
  if (existing?.status === 'CUADRADO') return res.status(409).json({ error: 'El cierre de hoy ya fue cuadrado por administración' });

  const countedCash = cashFromDenoms(b.denominations);
  const countedCard = b.cardVouchers.reduce((s, v) => s + v, 0);
  const expected = await expectedForDay(branchId, start, end);

  const data = {
    denominations: b.denominations, cardVouchers: b.cardVouchers,
    countedCash, countedCard, countedTransfer: b.countedTransfer, countedAzul: b.countedAzul,
    expectedCash: expected.EFECTIVO, expectedCard: expected.TARJETA,
    expectedTransfer: expected.TRANSFERENCIA, expectedAzul: expected.AZUL,
    notes: b.notes ?? null, submittedById: req.staff!.sub, status: 'ENVIADO',
  };
  await prisma.cashClose.upsert({
    where: { branchId_day: { branchId, day: start } },
    create: { branchId, day: start, ...data },
    update: data,
  });
  // Alerta al administrador: hay un cierre por cuadrar.
  const br = await prisma.branch.findUnique({ where: { id: branchId }, select: { name: true } });
  await notifyRole('ADMIN', {
    type: 'GENERAL',
    title: 'Cierre de caja para cuadrar',
    body: `${br?.name ?? 'Sucursal'} envió su conteo del día.`,
    link: '/app/cierre',
  });
  // Respuesta ciega: solo confirma el envío.
  res.status(201).json({ ok: true, message: 'Cierre enviado a administración para su cuadre', countedCash, countedCard });
});

// ─────────── ADMIN: cuadre por sucursal ───────────

/** Vista de cuadre: esperado vs contado + diferencia por método, por sucursal. */
cashCloseRouter.get('/admin', requireStaff, requireRole('ADMIN'), async (req, res) => {
  const { start, end } = dayBounds(req.query.date as string | undefined);
  const branchFilter = (req.query.branch as string | undefined) && req.query.branch !== 'all' ? { id: req.query.branch as string } : {};
  const branches = await prisma.branch.findMany({ where: branchFilter, orderBy: { code: 'asc' } });

  const rows = await Promise.all(branches.map(async (br) => {
    const close = await prisma.cashClose.findUnique({ where: { branchId_day: { branchId: br.id, day: start } } });
    const expected = close
      ? { EFECTIVO: close.expectedCash, TARJETA: close.expectedCard, TRANSFERENCIA: close.expectedTransfer, AZUL: close.expectedAzul }
      : await expectedForDay(br.id, start, end);
    const counted = close
      ? { EFECTIVO: close.countedCash, TARJETA: close.countedCard, TRANSFERENCIA: close.countedTransfer, AZUL: close.countedAzul }
      : null;

    const methods = (['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'AZUL'] as const).map((m) => ({
      method: m,
      expected: expected[m],
      counted: counted ? counted[m] : null,
      diff: counted ? counted[m] - expected[m] : null,
    }));
    const totalExpected = methods.reduce((s, m) => s + m.expected, 0);
    const totalCounted = counted ? methods.reduce((s, m) => s + (m.counted ?? 0), 0) : null;
    const totalDiff = totalCounted != null ? totalCounted - totalExpected : null;

    const submitter = close?.submittedById
      ? await prisma.user.findUnique({ where: { id: close.submittedById }, select: { id: true, name: true } })
      : null;

    return {
      closeId: close?.id ?? null,
      branchId: br.id, branchName: br.name, dotColor: br.dotColor,
      status: close?.status ?? 'PENDIENTE', // PENDIENTE (no enviado) | ENVIADO | CUADRADO
      methods, totalExpected, totalCounted, totalDiff,
      denominations: close?.denominations ?? null,
      cardVouchers: close?.cardVouchers ?? null,
      notes: close?.notes ?? null,
      reconciledAt: close?.reconciledAt ?? null,
      adminNote: close?.adminNote ?? null,
      resolution: close?.resolution ?? null,
      deductAmount: close?.deductAmount ?? 0,
      submittedBy: submitter,
    };
  }));

  res.json({ date: start.toISOString().slice(0, 10), branches: rows });
});

const reconcileSchema = z.object({
  notes: z.string().optional(),
  // El admin ingresa/ajusta lo que arroja el sistema (esperado) por método.
  expectedCash: z.number().int().nonnegative().optional(),
  expectedCard: z.number().int().nonnegative().optional(),
  expectedTransfer: z.number().int().nonnegative().optional(),
  expectedAzul: z.number().int().nonnegative().optional(),
  // Resolución del descuadre.
  adminNote: z.string().optional(),
  resolution: z.enum(['NONE', 'REAL_OK', 'FALTANTE_DESCONTAR', 'SOBRANTE_DEPOSITAR', 'AJUSTE_METODO']).optional(),
  deductUserId: z.string().optional(),
  deductAmount: z.number().int().nonnegative().optional(),
});

/** Cuadrar (aprobar) el cierre de una sucursal, con el esperado del sistema y resolución del descuadre. */
cashCloseRouter.patch('/:id/reconcile', requireStaff, requireRole('ADMIN'), async (req, res) => {
  const b = reconcileSchema.parse(req.body ?? {});
  const close = await prisma.cashClose.findUnique({ where: { id: req.params.id } });
  if (!close) return res.status(404).json({ error: 'Cierre no encontrado' });

  const expected = {
    expectedCash: b.expectedCash ?? close.expectedCash,
    expectedCard: b.expectedCard ?? close.expectedCard,
    expectedTransfer: b.expectedTransfer ?? close.expectedTransfer,
    expectedAzul: b.expectedAzul ?? close.expectedAzul,
  };
  const diff = (close.countedCash + close.countedCard + close.countedTransfer + close.countedAzul)
    - (expected.expectedCash + expected.expectedCard + expected.expectedTransfer + expected.expectedAzul);

  // Faltante real: se descuenta al usuario y se registra en su expediente.
  const deductUserId = b.deductUserId ?? close.submittedById ?? null;
  const doDeduct = b.resolution === 'FALTANTE_DESCONTAR' && deductUserId && (b.deductAmount ?? 0) > 0;
  if (doDeduct) {
    await prisma.staffDeduction.create({
      data: {
        userId: deductUserId!, branchId: close.branchId, amount: b.deductAmount!,
        reason: `Faltante de caja ${close.day.toLocaleDateString('es-DO')}${b.adminNote ? ` · ${b.adminNote}` : ''}`,
        cashCloseId: close.id,
      },
    });
    await notify({
      userId: deductUserId!, type: 'GENERAL',
      title: 'Descuento por faltante de caja',
      body: `Se registró un faltante de RD$${b.deductAmount!.toLocaleString('en-US')} en tu expediente.`,
      link: '/app/cierre',
    });
  }

  await prisma.cashClose.update({
    where: { id: close.id },
    data: {
      ...expected, status: 'CUADRADO', reconciledById: req.staff!.sub, reconciledAt: new Date(),
      notes: b.notes ?? close.notes,
      adminNote: b.adminNote ?? close.adminNote,
      resolution: b.resolution ?? close.resolution,
      deductUserId: doDeduct ? deductUserId : close.deductUserId,
      deductAmount: doDeduct ? b.deductAmount! : close.deductAmount,
    },
  });
  res.json({
    ok: true, diff,
    message: diff === 0
      ? 'Caja cuadrada sin diferencias'
      : `Cuadrada con ${diff > 0 ? 'sobrante' : 'faltante'} de RD$${Math.abs(diff).toLocaleString('en-US')}${doDeduct ? ' · descontado al usuario' : ''}`,
  });
});
