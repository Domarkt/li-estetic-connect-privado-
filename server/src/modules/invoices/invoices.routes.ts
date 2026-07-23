import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireStaff, requireRole, branchScope, assertBranchAccess } from '../../middleware/auth.js';
import {
  allocateSequence, splitItbis, invoiceInclude, serializeInvoiceRow, serializeReceipt,
} from './invoices.service.js';
import { awardSalePoints } from '../points/points.automation.js';
import { decrementSoldProducts } from '../inventory/inventory.service.js';
import { hashPassword } from '../../utils/password.js';
import { sendPatientAccess, sendReceipt } from '../mail/mail.service.js';
import { normalizePhone } from '../messaging/whatsapp.service.js';
import { upsertLead } from '../messaging/leads.service.js';
import { createTreatmentFromCatalog } from '../patients/areas.service.js';

export const invoicesRouter = Router();

// Solo Recepción y Admin facturan.
const billers = ['ADMIN', 'RECEPCIONISTA'] as const;

/** Recibos recientes (aislados por sucursal) + estadísticas del día. */
invoicesRouter.get('/', requireStaff, requireRole(...billers), branchScope, async (req, res) => {
  // Navegación por fecha: ?date=YYYY-MM-DD (por defecto, hoy).
  const dateStr = (req.query.date as string | undefined) ?? new Date().toISOString().slice(0, 10);
  const start = new Date(dateStr + 'T00:00:00');
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const isToday = dateStr === new Date().toISOString().slice(0, 10);

  const baseWhere = req.scopeBranchId ? { branchId: req.scopeBranchId } : {};
  const invoices = await prisma.invoice.findMany({
    where: { ...baseWhere, issuedAt: { gte: start, lt: end } },
    include: invoiceInclude, orderBy: { issuedAt: 'desc' },
  });

  const paid = invoices.filter((i) => i.status === 'PAGADA');
  const total = paid.reduce((s, i) => s + i.total, 0);
  const cash = paid.reduce((s, i) => {
    const pays = (i.payments ?? null) as { method: string; amount: number }[] | null;
    if (Array.isArray(pays) && pays.length) return s + pays.filter((p) => p.method === 'EFECTIVO').reduce((a, p) => a + p.amount, 0);
    return s + (i.method === 'EFECTIVO' ? i.total : 0);
  }, 0);
  const suf = isToday ? 'hoy' : 'del día';

  res.json({
    date: dateStr,
    stats: [
      { label: `Cobrado ${suf}`, value: total },
      { label: `Recibos ${suf}`, value: paid.length },
      { label: `Efectivo ${suf}`, value: cash },
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

const methodEnum = z.enum(['EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'AZUL']);
const billSchema = z.object({
  patientId: z.string().nullish(),
  concept: z.string().min(1),
  // Pago dividido: una o varias líneas por método que suman el total.
  payments: z.array(z.object({ method: methodEnum, amount: z.number().int().positive() })).min(1),
  chargeItemIds: z.array(z.string()).optional(), // marca estos cargos como facturados
  // Carrito: varios servicios/productos en un mismo recibo (cada uno detallado, con cantidad).
  // catalogItemId: si la línea es un combo/paquete, con esto se le crea el plan de sesiones al paciente.
  items: z.array(z.object({ name: z.string().min(1), price: z.number().int().nonnegative(), qty: z.number().int().positive().default(1), catalogItemId: z.string().optional() })).optional(),
  treatmentId: z.string().nullish(), // aplica el pago/abono a este tratamiento
  paymentKind: z.enum(['TOTAL', 'ABONO', 'SALDO']).default('TOTAL'),
  fullAmount: z.number().int().positive().optional(), // precio total del combo/compra (para abono a concepto libre)
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

  // Total = suma del pago dividido. Método dominante = el de mayor monto.
  const amount = b.payments.reduce((s, p) => s + p.amount, 0);
  if (amount <= 0) return res.status(400).json({ error: 'El monto debe ser mayor que cero' });
  const dominant = [...b.payments].sort((x, y) => y.amount - x.amount)[0].method;

  // Si el pago aplica a un tratamiento, ajusta el saldo (abono/saldo descuentan lo pagado).
  let treatmentAfter: { balance: number; perSession: number; remaining: number } | null = null;
  if (b.treatmentId) {
    const t = await prisma.treatment.findUnique({ where: { id: b.treatmentId } });
    if (t && t.patientId === b.patientId) {
      const newBalance = Math.max(0, t.balance - amount);
      await prisma.treatment.update({ where: { id: t.id }, data: { balance: newBalance } });
      const remaining = Math.max(0, t.totalSessions - t.doneSessions);
      treatmentAfter = { balance: newBalance, remaining, perSession: remaining > 0 ? Math.round(newBalance / remaining) : newBalance };
    }
  }

  const { subtotal, itbis } = splitItbis(amount);
  const { number, ncf } = await allocateSequence(branchId);

  // Líneas de la factura: cada servicio/producto DETALLADO por separado (para conciliar).
  let lineItems: { name: string; qty: number; unitPrice: number; total: number }[];
  let saldoServicios = 0; // saldo pendiente cuando el cobro de servicios es un abono
  const charges = b.chargeItemIds?.length
    ? await prisma.chargeItem.findMany({ where: { id: { in: b.chargeItemIds }, branchId } })
    : [];
  if (charges.length) {
    const chargesTotal = charges.reduce((s, c) => s + c.price, 0);
    // Cada servicio/producto SIEMPRE detallado por separado (a su precio).
    lineItems = charges.map((c) => ({ name: c.name, qty: 1, unitPrice: c.price, total: c.price }));
    if (b.paymentKind === 'ABONO' && amount < chargesTotal) {
      // Abono: se muestran los servicios y una línea de saldo pendiente para conciliar el total pagado.
      saldoServicios = chargesTotal - amount;
      lineItems.push({ name: 'Saldo pendiente (por cobrar)', qty: 1, unitPrice: -saldoServicios, total: -saldoServicios });
    }
  } else if (b.items?.length) {
    // Carrito: cada servicio/producto detallado a su precio y cantidad.
    lineItems = b.items.map((it) => ({ name: it.name, qty: it.qty, unitPrice: it.price, total: it.price * it.qty }));
    // Abono al carrito: el resto (total del carrito − abonado) queda como saldo pendiente.
    if (b.paymentKind === 'ABONO' && b.patientId && b.fullAmount && b.fullAmount > amount) {
      saldoServicios = b.fullAmount - amount;
      lineItems.push({ name: 'Saldo pendiente (por cobrar)', qty: 1, unitPrice: -saldoServicios, total: -saldoServicios });
    }
  } else {
    lineItems = [{ name: b.concept, qty: 1, unitPrice: amount, total: amount }];
    // Abono a un combo/compra nuevo (concepto libre): el resto queda como saldo pendiente.
    if (b.paymentKind === 'ABONO' && b.patientId && b.fullAmount && b.fullAmount > amount) {
      saldoServicios = b.fullAmount - amount;
      lineItems.push({ name: 'Saldo pendiente (por cobrar)', qty: 1, unitPrice: -saldoServicios, total: -saldoServicios });
    }
  }

  const invoice = await prisma.invoice.create({
    data: {
      number, ncf, branchId, patientId: b.patientId ?? null, cashierId: req.staff!.sub,
      treatmentId: b.treatmentId ?? null, paymentKind: b.paymentKind,
      concept: b.concept, subtotal, itbis, total: amount, method: dominant,
      payments: b.payments, status: 'PAGADA',
      items: { create: lineItems },
    },
    include: invoiceInclude,
  });

  // Marca como facturados los cargos cobrados.
  if (charges.length) {
    await prisma.chargeItem.updateMany({
      where: { id: { in: b.chargeItemIds! }, branchId },
      data: { status: 'FACTURADO' },
    });
    // Descuenta del inventario los productos vendidos (por sucursal).
    await decrementSoldProducts(
      branchId,
      charges.map((c) => c.catalogItemId).filter((x): x is string => !!x),
      req.staff!.sub,
    );
    // El resto del abono queda como nuevo cargo pendiente para cobrar luego.
    if (saldoServicios > 0 && b.patientId) {
      await prisma.chargeItem.create({
        data: { branchId, patientId: b.patientId, name: 'Saldo pendiente de servicios', price: saldoServicios, createdById: req.staff!.sub },
      });
    }
  } else if (saldoServicios > 0 && b.patientId) {
    // Abono a un combo/compra de concepto libre: el resto queda pendiente para cobrar luego.
    await prisma.chargeItem.create({
      data: { branchId, patientId: b.patientId, name: `Saldo pendiente: ${b.concept}`, price: saldoServicios, createdById: req.staff!.sub },
    });
  }

  // Crea el PLAN de sesiones cuando se cobra un combo/paquete: aquí es donde el servicio
  // pagado queda ligado al paciente (con sus sesiones reales, áreas y técnicas), para que
  // la esteticista lo vea al recibir la cita y pueda definir las áreas a trabajar.
  if (b.patientId && b.items?.length) {
    for (const it of b.items) {
      if (!it.catalogItemId) continue;
      try {
        await createTreatmentFromCatalog(b.patientId, it.catalogItemId, { qty: it.qty, paid: true });
      } catch { /* el plan no debe bloquear el cobro */ }
    }
  }

  // Atribuye la venta a la esteticista que atiende al paciente (ficha) para puntos y comisiones.
  if (b.patientId) {
    const cr = await prisma.clinicalRecord.findUnique({ where: { patientId: b.patientId }, select: { therapistId: true } });
    if (cr?.therapistId) {
      await prisma.invoice.update({ where: { id: invoice.id }, data: { therapistId: cr.therapistId } });
      await awardSalePoints(cr.therapistId, branchId, amount); // puntos automáticos (no rompe el cobro)
    }

    // El paciente pagó: activa su ACCESO al portal (correo + teléfono) y se lo envía por
    // correo. Best-effort — no rompe el cobro. Solo la primera vez (si aún no tiene cuenta).
    try {
      const pat = await prisma.patient.findUnique({ where: { id: b.patientId }, include: { patientAccount: true, branch: true } });
      if (pat?.email && pat.phone && !pat.patientAccount) {
        const unusedHash = await hashPassword('li' + Math.random().toString(36).slice(2, 12));
        await prisma.patientAccount.create({ data: { patientId: pat.id, login: pat.phone.trim(), passwordHash: unusedHash, active: true } });
        await sendPatientAccess(pat.email, { name: pat.name, phone: pat.phone, replyTo: pat.branch?.email ?? undefined });
      }
    } catch { /* el acceso no debe bloquear la facturación */ }

    // Seguimiento automático: el pago mueve la tarjeta del paciente a "Vendido".
    const leadPat = await prisma.patient.findUnique({ where: { id: b.patientId }, select: { name: true, branchId: true } });
    if (leadPat) await upsertLead({ branchId: leadPat.branchId, patientId: b.patientId, name: leadPat.name, stage: 'VENDIDO', summary: 'Compra registrada' });
  }

  const msg = saldoServicios > 0
    ? `Abono registrado · saldo pendiente RD$${saldoServicios.toLocaleString('en-US')}`
    : (b.paymentKind === 'ABONO' || b.paymentKind === 'SALDO') && treatmentAfter
    ? `${b.paymentKind === 'SALDO' ? 'Saldo pagado' : 'Abono registrado'} · saldo restante ${'RD$' + treatmentAfter.balance.toLocaleString('en-US')}${treatmentAfter.balance > 0 ? ` (${'RD$' + treatmentAfter.perSession.toLocaleString('en-US')}/sesión en ${treatmentAfter.remaining} sesiones)` : ''}`
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

const sendReceiptSchema = z.object({
  channels: z.array(z.enum(['whatsapp', 'correo'])).min(1, 'Selecciona al menos una vía'),
  email: z.string().email().optional(), // permite corregir/completar el correo al vuelo
  phone: z.string().optional(),         // permite enviar a otro número (familiar, etc.)
});

/**
 * Enviar el recibo al paciente por correo y/o WhatsApp (sustituye a imprimirlo).
 * El correo se manda desde el servidor; para WhatsApp se devuelve el enlace wa.me
 * con el mensaje ya redactado, que recepción abre y envía con un toque.
 */
invoicesRouter.post('/:id/send', requireStaff, requireRole(...billers), branchScope, async (req, res) => {
  const b = sendReceiptSchema.parse(req.body);
  const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id }, include: invoiceInclude });
  if (!invoice) return res.status(404).json({ error: 'Recibo no encontrado' });
  if (!assertBranchAccess(req, invoice.branchId)) return res.status(403).json({ error: 'Recibo de otra sucursal' });

  const r = serializeReceipt(invoice);
  const partes: string[] = [];

  // ── Correo ──
  let emailSent = false;
  if (b.channels.includes('correo')) {
    const to = (b.email ?? invoice.patient?.email ?? '').trim();
    if (!to) {
      partes.push('sin correo registrado');
    } else {
      const mail = await sendReceipt(to, r, invoice.branch.email ?? undefined);
      emailSent = mail.sent;
      partes.push(mail.sent ? `enviado a ${to}` : 'no se pudo enviar el correo');
      // Guarda el correo si el paciente no lo tenía, para la próxima vez.
      if (mail.sent && !invoice.patient?.email && invoice.patientId) {
        await prisma.patient.update({ where: { id: invoice.patientId }, data: { email: to } }).catch(() => {});
      }
    }
  }

  // ── WhatsApp ──
  let whatsappUrl: string | null = null;
  if (b.channels.includes('whatsapp')) {
    const phone = (b.phone ?? invoice.patient?.phone ?? '').trim();
    if (!phone) {
      partes.push('sin celular registrado');
    } else {
      const detalle = r.items.map((it) => `• ${it.name}${it.qty > 1 ? ` x${it.qty}` : ''}: RD$${it.total.toLocaleString('en-US')}`).join('\n');
      const texto =
        `Hola ${r.patient} 💜 Gracias por tu visita en ${r.branchName}.\n\n` +
        `*Recibo ${r.id}*${r.ncf ? ` · NCF ${r.ncf}` : ''}\n${r.date}\n\n${detalle}\n\n` +
        `*Total: RD$${r.total.toLocaleString('en-US')}* (ITBIS incluido)\nForma de pago: ${r.method}\n\n` +
        `— Li Estetic Center`;
      whatsappUrl = `https://wa.me/${normalizePhone(phone)}?text=${encodeURIComponent(texto)}`;
      partes.push('WhatsApp listo para enviar');
    }
  }

  res.json({ ok: true, emailSent, whatsappUrl, message: `Recibo ${r.id} · ${partes.join(' · ')}` });
});
