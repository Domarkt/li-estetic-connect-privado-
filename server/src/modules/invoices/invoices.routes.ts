import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireStaff, requireRole, branchScope, assertBranchAccess } from '../../middleware/auth.js';
import {
  allocateSequence, splitItbis, invoiceInclude, serializeInvoiceRow, serializeReceipt,
} from './invoices.service.js';

export const invoicesRouter = Router();

// Solo Recepción y Admin facturan.
const billers = ['ADMIN', 'RECEPCIONISTA'] as const;

/** Recibos recientes (aislados por sucursal) + estadísticas del día. */
invoicesRouter.get('/', requireStaff, requireRole(...billers), branchScope, async (req, res) => {
  const where = req.scopeBranchId ? { branchId: req.scopeBranchId } : {};
  const invoices = await prisma.invoice.findMany({
    where, include: invoiceInclude, orderBy: { issuedAt: 'desc' }, take: 50,
  });

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todays = invoices.filter((i) => i.issuedAt >= startOfDay && i.status === 'PAGADA');
  const total = todays.reduce((s, i) => s + i.total, 0);
  const cash = todays.filter((i) => i.method === 'EFECTIVO').reduce((s, i) => s + i.total, 0);

  res.json({
    stats: [
      { label: 'Cobrado hoy', value: total },
      { label: 'Recibos hoy', value: todays.length },
      { label: 'Efectivo hoy', value: cash },
      { label: 'Otros métodos', value: total - cash },
    ],
    invoices: invoices.map(serializeInvoiceRow),
  });
});

/** Pacientes para el listado del cobro (con plan, saldo y cargos pendientes). */
invoicesRouter.get('/patients', requireStaff, requireRole(...billers), branchScope, async (req, res) => {
  const patients = await prisma.patient.findMany({
    where: req.scopeBranchId ? { branchId: req.scopeBranchId } : {},
    include: { treatments: true, chargeItems: { where: { status: 'PENDIENTE_FACTURAR' } } },
    orderBy: { name: 'asc' },
  });
  res.json(
    patients.map((p) => {
      const t = p.treatments.find((x) => x.active) ?? p.treatments[0] ?? null;
      const pendingTotal = p.chargeItems.reduce((s, c) => s + c.price, 0);
      const remaining = t ? Math.max(0, t.totalSessions - t.doneSessions) : 0;
      return {
        id: p.id, name: p.name, phone: p.phone, avatarColor: p.avatarColor,
        plan: t?.name ?? 'Sin paquete', balance: t?.balance ?? 0,
        treatment: t ? {
          id: t.id, name: t.name, price: t.price, balance: t.balance,
          total: t.totalSessions, done: t.doneSessions, remaining,
          perSession: remaining > 0 ? Math.round(t.balance / remaining) : t.balance,
        } : null,
        pendingCharges: p.chargeItems.map((c) => ({ id: c.id, name: c.name, price: c.price })),
        pendingTotal,
      };
    }),
  );
});

const billSchema = z.object({
  patientId: z.string().nullish(),
  concept: z.string().min(1),
  amount: z.number().int().positive(),
  method: z.enum(['EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'AZUL']),
  chargeItemIds: z.array(z.string()).optional(), // marca estos cargos como facturados
  treatmentId: z.string().nullish(), // aplica el pago/abono a este tratamiento
  paymentKind: z.enum(['TOTAL', 'ABONO']).default('TOTAL'),
});

/** Emitir recibo (cobro). Asigna No. + NCF, calcula ITBIS y marca cargos facturados. */
invoicesRouter.post('/', requireStaff, requireRole(...billers), branchScope, async (req, res) => {
  const b = billSchema.parse(req.body);

  // Sucursal: la del recepcionista; admin usa la del paciente o la activa por ?branch=.
  let branchId = req.staff!.role === 'ADMIN' ? req.scopeBranchId : req.staff!.branchId;
  if (b.patientId) {
    const p = await prisma.patient.findUnique({ where: { id: b.patientId } });
    if (!p) return res.status(404).json({ error: 'Paciente no encontrado' });
    if (!assertBranchAccess(req, p.branchId)) return res.status(403).json({ error: 'Paciente de otra sucursal' });
    branchId = p.branchId;
  }
  if (!branchId) return res.status(400).json({ error: 'Selecciona una sucursal para facturar' });

  // Si el pago aplica a un tratamiento, ajusta el saldo (total = salda todo; abono = descuenta).
  let treatmentAfter: { balance: number; perSession: number; remaining: number } | null = null;
  if (b.treatmentId) {
    const t = await prisma.treatment.findUnique({ where: { id: b.treatmentId } });
    if (t && t.patientId === b.patientId) {
      const newBalance = Math.max(0, t.balance - b.amount);
      await prisma.treatment.update({ where: { id: t.id }, data: { balance: newBalance } });
      const remaining = Math.max(0, t.totalSessions - t.doneSessions);
      treatmentAfter = { balance: newBalance, remaining, perSession: remaining > 0 ? Math.round(newBalance / remaining) : newBalance };
    }
  }

  const { subtotal, itbis } = splitItbis(b.amount);
  const { number, ncf } = await allocateSequence(branchId);

  const invoice = await prisma.invoice.create({
    data: {
      number, ncf, branchId, patientId: b.patientId ?? null, cashierId: req.staff!.sub,
      treatmentId: b.treatmentId ?? null, paymentKind: b.paymentKind,
      concept: b.concept, subtotal, itbis, total: b.amount, method: b.method, status: 'PAGADA',
      items: { create: { name: b.concept, qty: 1, unitPrice: b.amount, total: b.amount } },
    },
    include: invoiceInclude,
  });

  // Marca como facturados los cargos que la esteticista envió a recepción.
  if (b.chargeItemIds?.length) {
    await prisma.chargeItem.updateMany({
      where: { id: { in: b.chargeItemIds }, branchId },
      data: { status: 'FACTURADO' },
    });
  }

  const msg = b.paymentKind === 'ABONO' && treatmentAfter
    ? `Abono registrado · saldo restante ${'RD$' + treatmentAfter.balance.toLocaleString('en-US')} (${'RD$' + treatmentAfter.perSession.toLocaleString('en-US')}/sesión en ${treatmentAfter.remaining} sesiones)`
    : 'Recibo emitido · pago registrado en caja';
  res.status(201).json({ receipt: { ...serializeReceipt(invoice), paymentKind: b.paymentKind, treatmentAfter }, message: msg });
});

/** Datos del recibo para reimprimir. */
invoicesRouter.get('/:id/receipt', requireStaff, requireRole(...billers), branchScope, async (req, res) => {
  const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id }, include: invoiceInclude });
  if (!invoice) return res.status(404).json({ error: 'Recibo no encontrado' });
  if (!assertBranchAccess(req, invoice.branchId)) return res.status(403).json({ error: 'Recibo de otra sucursal' });
  res.json(serializeReceipt(invoice));
});
