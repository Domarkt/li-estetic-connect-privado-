import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireStaff, requireRole, branchScope, assertBranchAccess } from '../../middleware/auth.js';
import {
  allocateSequence, splitItbis, invoiceInclude, invoiceListInclude, serializeInvoiceRow, serializeReceipt, rncValido, formatRnc,
} from './invoices.service.js';
import { awardSalePoints } from '../points/points.automation.js';
import { decrementSoldProducts } from '../inventory/inventory.service.js';
import { hashPassword } from '../../utils/password.js';
import { sendPatientAccess, sendReceipt } from '../mail/mail.service.js';
import { normalizePhone } from '../messaging/whatsapp.service.js';
import { cached, cacheKey } from '../../utils/cache.js';
import { tratoFormal, sucursalLabel } from '../../utils/trato.js';
import { upsertLead } from '../messaging/leads.service.js';
import { createTreatmentFromCatalog } from '../patients/areas.service.js';
import { audit } from '../audit/audit.service.js';

export const invoicesRouter = Router();

// Solo Recepción y Admin facturan.
const billers = ['ADMIN', 'RECEPCIONISTA'] as const;

/**
 * Detalle "qué incluye" de un combo/paquete/servicio para imprimir en el recibo:
 * las sesiones y las técnicas (con su cantidad). Devuelve null para productos/insumos
 * o si no hay nada que detallar. Ej.: "10 sesiones · Cavitación x6, Radiofrecuencia x6".
 */
function buildLineDetail(item: { kind: string; sessions: number; incluye?: { qty: number; service: { name: string } }[] }): string | null {
  if (!(item.kind === 'COMBO' || item.kind === 'PAQUETE' || item.kind === 'SERVICIO')) return null;
  const partes: string[] = [];
  if ((item.sessions ?? 1) > 1) partes.push(`${item.sessions} sesiones`);
  const tec = (item.incluye ?? []).map((x) => (x.qty > 1 ? `${x.service.name} x${x.qty}` : x.service.name));
  if (tec.length) partes.push(tec.join(', '));
  return partes.length ? partes.join(' · ') : null;
}

/** Recibos recientes (aislados por sucursal) + estadísticas del día. */
invoicesRouter.get('/', requireStaff, requireRole(...billers), branchScope, async (req, res) => {
  // Navegación por fecha: ?date=YYYY-MM-DD (por defecto, hoy).
  const dateStr = (req.query.date as string | undefined) ?? new Date().toISOString().slice(0, 10);
  const payload = await cached(cacheKey('inv:list', req, { date: dateStr }), 90_000, async () => {
    const start = new Date(dateStr + 'T00:00:00');
    const end = new Date(start); end.setDate(end.getDate() + 1);
    const isToday = dateStr === new Date().toISOString().slice(0, 10);

    const baseWhere = req.scopeBranchId ? { branchId: req.scopeBranchId } : {};
    const invoices = await prisma.invoice.findMany({
      where: { ...baseWhere, issuedAt: { gte: start, lt: end } },
      include: invoiceListInclude, orderBy: { issuedAt: 'desc' },
    });

    const paid = invoices.filter((i) => i.status === 'PAGADA');
    const total = paid.reduce((s, i) => s + i.total, 0);
    const cash = paid.reduce((s, i) => {
      const pays = (i.payments ?? null) as { method: string; amount: number }[] | null;
      if (Array.isArray(pays) && pays.length) return s + pays.filter((p) => p.method === 'EFECTIVO').reduce((a, p) => a + p.amount, 0);
      return s + (i.method === 'EFECTIVO' ? i.total : 0);
    }, 0);
    const suf = isToday ? 'hoy' : 'del día';

    return {
      date: dateStr,
      stats: [
        { label: `Cobrado ${suf}`, value: total },
        { label: `Recibos ${suf}`, value: paid.length },
        { label: `Efectivo ${suf}`, value: cash },
        { label: 'Otros métodos', value: total - cash },
      ],
      invoices: invoices.map(serializeInvoiceRow),
    };
  });
  res.json(payload);
});

/**
 * Relación de CUENTAS POR COBRAR (Recepción/Admin): todo lo pendiente de pago, con su
 * monto y la fecha en que se generó. Reúne los SALDOS de planes (abonos sin terminar de
 * pagar) y los CARGOS pendientes de facturar. Cada fila trae un WhatsApp ya escrito para
 * invitar a la clienta a saldar. Aislado por sucursal.
 */
invoicesRouter.get('/receivables', requireStaff, requireRole(...billers), branchScope, async (req, res) => {
  const payload = await cached(cacheKey('inv:recv', req), 90_000, async () => {
  const branchId = req.scopeBranchId ?? null;
  const [treatments, charges] = await Promise.all([
    prisma.treatment.findMany({
      where: { balance: { gt: 0 }, ...(branchId ? { patient: { branchId } } : {}) },
      include: { patient: { select: { id: true, name: true, phone: true, sex: true, branch: { select: { name: true } } } } },
    }),
    // Solo cargos con MONTO real: un cargo en RD$0 (procedimiento que la esteticista
    // registró sin precio, o ya incluido en un combo pagado) no es dinero por cobrar
    // y antes quedaba atascado aquí para siempre. Cuentas por cobrar = dinero pendiente.
    prisma.chargeItem.findMany({
      where: { status: 'PENDIENTE_FACTURAR', price: { gt: 0 }, ...(branchId ? { branchId } : {}) },
      include: { patient: { select: { id: true, name: true, phone: true, sex: true, branch: { select: { name: true } } } } },
    }),
  ]);

  const NEGOCIO = 'Li Estetic Center';
  const waLink = (phone: string, name: string, sex: string | null, monto: number) => {
    const p = normalizePhone(phone);
    const texto = `Hola ${tratoFormal(name, sex)} 💜 Le saludamos de ${NEGOCIO}. Tiene un saldo pendiente de RD$${monto.toLocaleString('en-US')}. Puede pasar a saldarlo cuando guste; con gusto le agendamos su próxima cita. 💜`;
    return p ? `https://wa.me/${p}?text=${encodeURIComponent(texto)}` : null;
  };
  const fmtFecha = (d: Date) => d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' });

  const rows = [
    ...treatments.filter((t) => t.patient).map((t) => ({
      id: `t_${t.id}`, patientId: t.patient!.id, patientName: t.patient!.name, phone: t.patient!.phone,
      branch: t.patient!.branch?.name ?? '—', concept: `Saldo de plan · ${t.name}`, tipo: 'Saldo de plan',
      monto: t.balance, fecha: fmtFecha(t.createdAt), at: t.createdAt.toISOString(),
      wa: waLink(t.patient!.phone, t.patient!.name, t.patient!.sex, t.balance),
    })),
    ...charges.filter((c) => c.patient).map((c) => ({
      id: `c_${c.id}`, patientId: c.patient!.id, patientName: c.patient!.name, phone: c.patient!.phone,
      branch: c.patient!.branch?.name ?? '—', concept: c.name, tipo: 'Cargo pendiente',
      monto: c.price, fecha: fmtFecha(c.createdAt), at: c.createdAt.toISOString(),
      wa: waLink(c.patient!.phone, c.patient!.name, c.patient!.sex, c.price),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at)); // más recientes primero

    return { rows, total: rows.reduce((s, r) => s + r.monto, 0), count: rows.length };
  });
  res.json(payload);
});

/** Pacientes para el listado del cobro (con plan, saldo y cargos pendientes). */
invoicesRouter.get('/patients', requireStaff, requireRole(...billers), branchScope, async (req, res) => {
  const payload = await cached(cacheKey('inv:pat', req), 90_000, async () => {
  const patients = await prisma.patient.findMany({
    where: req.scopeBranchId ? { branchId: req.scopeBranchId } : {},
    include: {
      treatments: true,
      chargeItems: { where: { status: 'PENDIENTE_FACTURAR' } },
      // Última cita agendada con servicio: recepción no debería tener que recordar
      // (ni ir a buscar) qué fue lo que el paciente agendó para poder cobrarle.
      //
      // treatmentId: null es CLAVE — si la cita consume un plan ya pagado, no se
      // precarga nada: volver a cobrarlo sería cobrar dos veces lo mismo.
      appointments: {
        where: { status: { not: 'CANCELADA' }, catalogItemId: { not: null }, treatmentId: null },
        orderBy: { startsAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { name: 'asc' },
  });

  // Precio y tipo del servicio agendado (Appointment solo guarda el id del ítem).
  const idsAgendados = [...new Set(patients.flatMap((p) => p.appointments.map((a) => a.catalogItemId)).filter((x): x is string => !!x))];
  const itemsAgendados = idsAgendados.length
    ? await prisma.catalogItem.findMany({ where: { id: { in: idsAgendados } }, select: { id: true, name: true, price: true, kind: true } })
    : [];
  const porId = new Map(itemsAgendados.map((i) => [i.id, i]));

  return (
    patients.map((p) => {
      const cita = p.appointments[0];
      const itemCita = cita?.catalogItemId ? porId.get(cita.catalogItemId) : undefined;
      // Segundo cerrojo contra el cobro duplicado: si ya tiene un plan ACTIVO de
      // ese mismo ítem, es que ya lo pagó y solo viene a consumir su sesión.
      const yaPagado = !!itemCita && p.treatments.some(
        (t) => t.active && t.catalogItemId === itemCita.id && t.doneSessions < t.totalSessions,
      );
      const t = p.treatments.find((x) => x.active) ?? p.treatments[0] ?? null;
      const pendingTotal = p.chargeItems.reduce((s, c) => s + c.price, 0);
      const remaining = t ? Math.max(0, t.totalSessions - t.doneSessions) : 0;
      // ¿Tiene un pendiente RECIENTE (creado en las últimas 24h)? La lista "Por cobrar"
      // de Facturación solo muestra lo reciente; lo que pasa de 24h vive en Cuentas por
      // cobrar (para no acumular cobros viejos en la pantalla del día).
      const AHORA = Date.now(); const DIA = 24 * 3_600_000;
      const recentPending =
        p.chargeItems.some((c) => c.price > 0 && AHORA - c.createdAt.getTime() <= DIA) ||
        p.treatments.some((x) => x.active && x.balance > 0 && AHORA - x.createdAt.getTime() <= DIA);
      return {
        id: p.id, name: p.name, phone: p.phone, avatarColor: p.avatarColor,
        recentPending,
        plan: t?.name ?? 'Sin paquete', balance: t?.balance ?? 0,
        treatment: t ? {
          id: t.id, name: t.name, price: t.price, balance: t.balance,
          total: t.totalSessions, done: t.doneSessions, remaining,
          perSession: remaining > 0 ? Math.round(t.balance / remaining) : t.balance,
        } : null,
        // TODOS los planes con saldo, no solo el primero: con varios paquetes
        // comprados, el saldo del segundo quedaba sin forma de cobrarse.
        treatmentsConSaldo: p.treatments
          .filter((x) => x.active && x.balance > 0)
          .map((x) => ({
            id: x.id, name: x.name, price: x.price, balance: x.balance,
            total: x.totalSessions, done: x.doneSessions,
            remaining: Math.max(0, x.totalSessions - x.doneSessions),
          })),
        pendingCharges: p.chargeItems.map((c) => ({ id: c.id, name: c.name, price: c.price })),
        pendingTotal,
        // Lo que el paciente agendó: el cobro lo precarga para no tener que buscarlo.
        // Solo si NO está ya pagado (ver los dos cerrojos de arriba).
        scheduled: itemCita && cita && !yaPagado ? {
          catalogItemId: itemCita.id,
          name: itemCita.name,
          price: itemCita.price,
          kind: itemCita.kind,
          fecha: cita.startsAt.toLocaleDateString('es-DO', { day: '2-digit', month: 'short' }),
        } : null,
      };
    })
  );
  });
  res.json(payload);
});

/** Esteticistas de la sucursal en foco: para elegir a quién se le acredita la venta. */
invoicesRouter.get('/therapists', requireStaff, requireRole(...billers), branchScope, async (req, res) => {
  const list = await prisma.user.findMany({
    where: { role: 'ESTETICISTA', active: true, ...(req.scopeBranchId ? { branchId: req.scopeBranchId } : {}) },
    select: { id: true, name: true, branchId: true },
    orderBy: { name: 'asc' },
  });
  res.json(list);
});

/** Asignar/corregir la esteticista de una factura (comisión/ranking). Solo Admin. */
invoicesRouter.patch('/:id/therapist', requireStaff, requireRole('ADMIN'), branchScope, async (req, res) => {
  const { therapistId } = z.object({ therapistId: z.string().nullable() }).parse(req.body);
  const inv = await prisma.invoice.findUnique({ where: { id: req.params.id }, select: { id: true, number: true, branchId: true } });
  if (!inv) return res.status(404).json({ error: 'Recibo no encontrado' });
  if (!assertBranchAccess(req, inv.branchId)) return res.status(403).json({ error: 'Recibo de otra sucursal' });
  let nombre = 'Sin esteticista';
  if (therapistId) {
    const u = await prisma.user.findUnique({ where: { id: therapistId }, select: { name: true } });
    if (!u) return res.status(400).json({ error: 'Esteticista no válida' });
    nombre = u.name;
  }
  await prisma.invoice.update({ where: { id: inv.id }, data: { therapistId } });
  await audit(req, {
    action: 'INVOICE_ATTRIBUTE', entity: 'Invoice', entityId: inv.id, branchId: inv.branchId,
    summary: `Atribuyó el recibo ${inv.number} a: ${nombre}`,
  });
  res.json({ ok: true, message: `Recibo atribuido a ${nombre}` });
});

const pendingChargeUpdateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  price: z.number().int().nonnegative().optional(),
}).refine((b) => b.name !== undefined || b.price !== undefined, { message: 'Indica el concepto o el monto a modificar' });

/** Editar un cargo que todavía no se ha facturado. Solo administración. */
invoicesRouter.patch('/pending-charges/:id', requireStaff, requireRole('ADMIN'), branchScope, async (req, res) => {
  const b = pendingChargeUpdateSchema.parse(req.body);
  const charge = await prisma.chargeItem.findUnique({ where: { id: req.params.id }, include: { patient: true } });
  if (!charge) return res.status(404).json({ error: 'Cobro pendiente no encontrado' });
  if (!assertBranchAccess(req, charge.branchId)) return res.status(403).json({ error: 'Cobro de otra sucursal' });
  if (charge.status !== 'PENDIENTE_FACTURAR') return res.status(409).json({ error: 'Solo se pueden editar cobros que siguen pendientes' });

  const updated = await prisma.chargeItem.update({ where: { id: charge.id }, data: b });
  await audit(req, {
    action: 'PENDING_CHARGE_UPDATE', entity: 'ChargeItem', entityId: charge.id, branchId: charge.branchId,
    summary: `${charge.patient.name} · ${charge.name} RD$${charge.price.toLocaleString('en-US')} → ${updated.name} RD$${updated.price.toLocaleString('en-US')}`,
  });
  res.json({ ok: true, message: 'Cobro pendiente actualizado' });
});

const pendingChargeVoidSchema = z.object({ reason: z.string().trim().min(3).max(250) });

/** Anular sin borrar el rastro de un cargo pendiente. Solo administración. */
invoicesRouter.post('/pending-charges/:id/void', requireStaff, requireRole('ADMIN'), branchScope, async (req, res) => {
  const { reason } = pendingChargeVoidSchema.parse(req.body);
  const charge = await prisma.chargeItem.findUnique({ where: { id: req.params.id }, include: { patient: true } });
  if (!charge) return res.status(404).json({ error: 'Cobro pendiente no encontrado' });
  if (!assertBranchAccess(req, charge.branchId)) return res.status(403).json({ error: 'Cobro de otra sucursal' });
  if (charge.status !== 'PENDIENTE_FACTURAR') return res.status(409).json({ error: 'El cobro ya no está pendiente' });

  await prisma.chargeItem.update({ where: { id: charge.id }, data: { status: 'ANULADO' } });
  await audit(req, {
    action: 'PENDING_CHARGE_VOID', entity: 'ChargeItem', entityId: charge.id, branchId: charge.branchId,
    summary: `${charge.patient.name} · ${charge.name} · RD$${charge.price.toLocaleString('en-US')} · Motivo: ${reason}`,
  });
  res.json({ ok: true, message: 'Cobro pendiente anulado' });
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
  therapistId: z.string().nullish(), // esteticista a la que se le acredita la venta (comisión)
  paymentKind: z.enum(['TOTAL', 'ABONO', 'SALDO']).default('TOTAL'),
  // Tipo de comprobante: consumo final (B02) o crédito fiscal (B01, exige RNC).
  ncfType: z.enum(['B02', 'B01']).default('B02'),
  clientRnc: z.string().trim().optional(),
  clientName: z.string().trim().max(120).optional(),
  // No todos los servicios estéticos llevan ITBIS: recepción lo decide al cobrar.
  itbisApplied: z.boolean().default(true),
  fullAmount: z.number().int().positive().optional(), // precio total del combo/compra (para abono a concepto libre)
  // Descuento aplicado por recepción/admin (monto en RD$ ya calculado). Tope: 20% del bruto.
  discount: z.number().int().nonnegative().optional(),
  discountReason: z.string().trim().max(160).nullish(),
  // "Solo registrar el ingreso": el paciente YA tiene estos servicios en su ficha
  // (plan cargado/usado). Emite el recibo pero NO crea/duplica el plan. Úsalo para
  // regularizar un cobro que faltaba de un plan que ya existe.
  skipPlan: z.boolean().optional(),
});

/** Emitir recibo (cobro). Asigna No. + NCF, calcula ITBIS y marca cargos facturados. */
invoicesRouter.post('/', requireStaff, requireRole(...billers), branchScope, async (req, res) => {
  try {
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
      if (amount > t.balance) return res.status(400).json({ error: `El cobro no puede superar el saldo del plan (RD$${t.balance.toLocaleString('en-US')})` });
      const newBalance = Math.max(0, t.balance - amount);
      await prisma.treatment.update({ where: { id: t.id }, data: { balance: newBalance } });
      const remaining = Math.max(0, t.totalSessions - t.doneSessions);
      treatmentAfter = { balance: newBalance, remaining, perSession: remaining > 0 ? Math.round(newBalance / remaining) : newBalance };
    }
  }

  // Crédito fiscal: la DGII exige identificar al comprador. Sin RNC/cédula válido
  // no se emite, porque después no se puede corregir el comprobante.
  if (b.ncfType === 'B01') {
    if (!b.clientRnc || !rncValido(b.clientRnc)) {
      return res.status(400).json({ error: 'Para crédito fiscal necesitas el RNC (9 dígitos) o la cédula (11 dígitos) del cliente' });
    }
    if (!b.clientName?.trim()) {
      return res.status(400).json({ error: 'Escribe el nombre o razón social a la que se emite la factura' });
    }
  }

  const { subtotal, itbis } = splitItbis(amount, b.itbisApplied);
  const { number, ncf } = await allocateSequence(branchId, b.ncfType);

  // Líneas de la factura: cada servicio/producto DETALLADO por separado (para conciliar).
  let lineItems: { name: string; qty: number; unitPrice: number; total: number; detail?: string | null }[];
  // Dónde queda el dinero pendiente cuando el cobro es un abono. Son excluyentes:
  //  · saldoPlan      → va al balance del tratamiento (combo/paquete comprado).
  //  · saldoServicios → queda como cargo pendiente (servicios sueltos sin plan).
  let saldoServicios = 0;
  let saldoPlan = 0;

  // ¿El carrito incluye un plan (combo/paquete)? Eso decide dónde vive el saldo.
  const idsCarrito = (b.items ?? []).map((i) => i.catalogItemId).filter((x): x is string => !!x);
  const planesEnCarrito = idsCarrito.length
    ? await prisma.catalogItem.count({ where: { id: { in: idsCarrito }, kind: { in: ['PAQUETE', 'COMBO'] } } })
    : 0;
  const carritoTienePlan = planesEnCarrito > 0;
  const charges = b.chargeItemIds?.length
    ? await prisma.chargeItem.findMany({
        where: {
          id: { in: b.chargeItemIds }, status: 'PENDIENTE_FACTURAR',
          // Si hay paciente, se busca por paciente (no por sucursal): así se puede cobrar
          // un cargo creado en OTRA estética tras transferir a la clienta. Sin paciente,
          // se acota a la sucursal del cobro.
          ...(b.patientId ? { patientId: b.patientId } : { branchId }),
        },
      })
    : [];
  if (b.chargeItemIds?.length && charges.length !== new Set(b.chargeItemIds).size) {
    return res.status(409).json({ error: 'Uno de los cargos seleccionados ya fue facturado, anulado o pertenece a otro paciente. Actualiza y vuelve a intentarlo.' });
  }

  // Detalle de cada combo/paquete/servicio: sesiones y técnicas que incluye, para que
  // el recibo diga QUÉ compró el paciente (hay combos con el mismo nombre y distinto
  // contenido). Se guarda como snapshot por línea, así funciona con varios combos en
  // una sola factura y no cambia aunque después se edite el combo.
  const idsDetalle = [
    ...idsCarrito,
    ...charges.map((c) => c.catalogItemId).filter((x): x is string => !!x),
  ];
  const catForDetail = idsDetalle.length
    ? await prisma.catalogItem.findMany({
        where: { id: { in: idsDetalle } },
        include: { incluye: { include: { service: { select: { name: true } } } } },
      })
    : [];
  const detailDe = new Map<string, string>();
  for (const it of catForDetail) {
    const d = buildLineDetail(it);
    if (d) detailDe.set(it.id, d);
  }

  // Carrito unificado: los cargos pendientes (que la esteticista envió) y los
  // servicios/productos agregados en el cobro van JUNTOS en el mismo recibo, cada
  // uno detallado por separado. Así un paciente recurrente puede agregar otro
  // producto o servicio a lo que ya tenía pendiente, en una sola factura.
  const chargeLines = charges.map((c) => ({ name: c.name, qty: 1, unitPrice: c.price, total: c.price, detail: c.catalogItemId ? detailDe.get(c.catalogItemId) ?? null : null }));
  const cartLines = (b.items ?? []).map((it) => ({ name: it.name, qty: it.qty, unitPrice: it.price, total: it.price * it.qty, detail: it.catalogItemId ? detailDe.get(it.catalogItemId) ?? null : null }));
  const detalle = [...chargeLines, ...cartLines];

  // Descuento (recepción/admin): tope 20% del bruto. Entra como línea NEGATIVA para que
  // el total cuadre solo, la caja concilie y el recibo lo muestre. No aplica al cobro de
  // un saldo de plan (ahí el precio ya está fijado).
  const MAX_DISCOUNT_PCT = Number(process.env.DISCOUNT_MAX_PCT || 20); // configurable sin código
  const brutoAntesDesc = detalle.reduce((s, l) => s + l.total, 0);
  let descuento = 0;
  if (!b.treatmentId && detalle.length > 0 && (b.discount ?? 0) > 0) {
    descuento = Math.round(b.discount!);
    const tope = Math.floor(brutoAntesDesc * (MAX_DISCOUNT_PCT / 100));
    if (descuento > tope) return res.status(400).json({ error: `El descuento no puede superar el ${MAX_DISCOUNT_PCT}% (RD$${tope.toLocaleString('en-US')})` });
    if (descuento >= brutoAntesDesc) return res.status(400).json({ error: 'El descuento no puede ser igual o mayor que el total' });
    const motivo = b.discountReason?.trim();
    detalle.push({ name: `Descuento${motivo ? ` · ${motivo}` : ''}`, qty: 1, unitPrice: -descuento, total: -descuento, detail: null });
  }
  const brutoDetalle = detalle.reduce((s, l) => s + l.total, 0);

  // Invariante contable: el dinero recibido debe coincidir con las líneas. Esta
  // validación del servidor protege incluso si el navegador tiene una versión vieja.
  if (detalle.length > 0 && b.paymentKind === 'TOTAL' && amount !== brutoDetalle) {
    return res.status(400).json({
      error: `El total cobrado (${`RD$${amount.toLocaleString('en-US')}`}) no coincide con los conceptos (${`RD$${brutoDetalle.toLocaleString('en-US')}`})`,
    });
  }
  if (detalle.length > 0 && b.paymentKind === 'ABONO' && amount >= brutoDetalle) {
    return res.status(400).json({ error: `El abono debe ser menor que el total de los conceptos (RD$${brutoDetalle.toLocaleString('en-US')})` });
  }

  if (detalle.length === 0) {
    // Cobro de concepto libre (sin cargos ni carrito): una sola línea.
    lineItems = [{ name: b.concept, qty: 1, unitPrice: amount, total: amount }];
    if (b.paymentKind === 'ABONO' && b.patientId && b.fullAmount && b.fullAmount > amount) {
      saldoServicios = b.fullAmount - amount;
      lineItems.push({ name: 'Saldo pendiente (por cobrar)', qty: 1, unitPrice: -saldoServicios, total: -saldoServicios });
    }
  } else {
    lineItems = detalle;
    // Abono: lo que falta del total real de lo comprado queda pendiente. Si el
    // carrito incluye un plan, ese saldo vive en el tratamiento; si no, como cargo.
    if (b.paymentKind === 'ABONO' && b.patientId) {
      const objetivo = b.fullAmount && b.fullAmount > 0 ? b.fullAmount : brutoDetalle;
      const faltante = Math.max(0, objetivo - amount);
      if (faltante > 0) {
        if (carritoTienePlan) saldoPlan = faltante; else saldoServicios = faltante;
        lineItems.push({ name: 'Saldo pendiente (por cobrar)', qty: 1, unitPrice: -faltante, total: -faltante });
      }
    }
  }

  const planSources = [
    ...(b.items ?? []).filter((it) => it.catalogItemId).map((it) => ({ id: it.catalogItemId!, qty: it.qty })),
    ...charges.filter((c) => c.catalogItemId).map((c) => ({ id: c.catalogItemId!, qty: 1 })),
  ];

  // "Solo registrar el ingreso" únicamente es válido si TODOS los planes ya
  // existen en la ficha. Antes podía activarse por error y el sistema aceptaba el
  // pago dejando al paciente sin sesiones y sin posibilidad de abrir el turno.
  if (b.skipPlan && b.patientId && planSources.length) {
    const sourceIds = [...new Set(planSources.map((s) => s.id))];
    const existingIds = await prisma.treatment.findMany({
      where: { patientId: b.patientId, catalogItemId: { in: sourceIds }, active: true },
      select: { catalogItemId: true },
    });
    const present = new Set(existingIds.map((t) => t.catalogItemId).filter((id): id is string => !!id));
    const missing = sourceIds.filter((id) => !present.has(id));
    if (missing.length) {
      return res.status(409).json({
        error: 'No puedes usar “Solo registrar el ingreso”: esta compra todavía no está cargada en la ficha. Desactiva esa opción para crear sus sesiones.',
      });
    }
  }

  // La factura y los planes comprados son una sola operación. Antes la factura se
  // guardaba primero y la creación del plan ocurría después con el error oculto;
  // eso dejaba recibos pagados sin sesiones en la ficha y bloqueaba el turno.
  const invoice = await prisma.$transaction(async (tx) => {
    const created = await tx.invoice.create({ data: {
      number, ncf, branchId, patientId: b.patientId ?? null, cashierId: req.staff!.sub,
      treatmentId: b.treatmentId ?? null, paymentKind: b.paymentKind,
      concept: b.concept, subtotal, itbis, total: amount, method: dominant,
      discount: descuento, discountReason: descuento > 0 ? (b.discountReason?.trim() || null) : null,
      ncfType: b.ncfType, itbisApplied: b.itbisApplied,
      clientRnc: b.ncfType === 'B01' ? formatRnc(b.clientRnc!) : null,
      clientName: b.ncfType === 'B01' ? b.clientName!.trim() : null,
      payments: b.payments, status: 'PAGADA',
      items: { create: lineItems },
    }, include: invoiceInclude });

    if (!b.skipPlan && b.patientId && planSources.length) {
      let porRepartir = saldoPlan;
      for (const it of planSources) {
        const creado = await createTreatmentFromCatalog(b.patientId, it.id, {
          qty: it.qty, outstanding: porRepartir,
        }, tx);
        if (creado) porRepartir = 0;
      }
    }
    return created;
  });

  // Marca como facturados los cargos cobrados.
  if (charges.length) {
    await prisma.chargeItem.updateMany({
      // Se marcan EXACTAMENTE los cargos cobrados (por id), no por sucursal: así también
      // se cierra el cargo creado en otra estética cuando la clienta fue transferida.
      where: { id: { in: charges.map((c) => c.id) } },
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

  await audit(req, {
    action: 'INVOICE_CREATE', entity: 'Invoice', entityId: invoice.id, branchId,
    summary: `Recibo ${number} · ${b.concept} · RD$${amount.toLocaleString('en-US')} (${dominant})`,
  });

  // Atribuye la venta a la esteticista que atiende al paciente (ficha) para puntos y comisiones.
  // TODO lo que sigue es POSTERIOR al cobro ya registrado: nunca debe tumbar la respuesta
  // (si fallara, el cajero vería "error interno" con la factura YA creada y recobraría).
  try {
  if (b.patientId) {
    // Esteticista de la venta (comisión/ranking) por PRIORIDAD:
    //  1) la que recepción eligió en el cobro (b.therapistId);
    //  2) la que agregó los cargos que se están facturando (createdById esteticista);
    //  3) la de la ficha clínica.
    // Antes SOLO era (3): las fichas sin esteticista dejaban la venta sin atribuir
    // (≈65% del mes), por eso las que más venden aparecían con menos ventas.
    let ventaTid: string | null = b.therapistId ?? null;
    if (!ventaTid && charges.length) {
      const creatorIds = [...new Set(charges.map((c) => c.createdById).filter((x): x is string => !!x))];
      if (creatorIds.length) {
        const creadores = await prisma.user.findMany({ where: { id: { in: creatorIds }, role: 'ESTETICISTA' }, select: { id: true } });
        ventaTid = creadores[0]?.id ?? null;
      }
    }
    if (!ventaTid) {
      const cr = await prisma.clinicalRecord.findUnique({ where: { patientId: b.patientId }, select: { therapistId: true } });
      ventaTid = cr?.therapistId ?? null;
    }
    if (ventaTid) {
      await prisma.invoice.update({ where: { id: invoice.id }, data: { therapistId: ventaTid } });
      await awardSalePoints(ventaTid, branchId, amount); // puntos automáticos (no rompe el cobro)
    }

    // El paciente pagó: activa su ACCESO al portal (correo + teléfono) y se lo envía por
    // correo. Best-effort — no rompe el cobro. Solo la primera vez (si aún no tiene cuenta).
    try {
      const pat = await prisma.patient.findUnique({ where: { id: b.patientId }, include: { patientAccount: true, branch: true } });
      // Basta con el TELÉFONO: la cuenta se crea con el teléfono (usuario y contraseña
      // inicial). Si además tiene correo, se le envía el acceso por correo. Así los
      // pacientes sin correo también quedan con acceso al pagar.
      if (pat?.phone && !pat.patientAccount) {
        const claveInicial = await hashPassword((pat.phone || '').replace(/\D/g, ''));
        await prisma.patientAccount.create({ data: { patientId: pat.id, login: pat.phone.trim(), passwordHash: claveInicial, active: true } });
        if (pat.email) await sendPatientAccess(pat.email, { name: pat.name, phone: pat.phone, replyTo: pat.branch?.email ?? undefined });
      }
    } catch { /* el acceso no debe bloquear la facturación */ }

    // Seguimiento automático: el pago mueve la tarjeta del paciente a "Vendido".
    const leadPat = await prisma.patient.findUnique({ where: { id: b.patientId }, select: { name: true, branchId: true } });
    if (leadPat) await upsertLead({ branchId: leadPat.branchId, patientId: b.patientId, name: leadPat.name, stage: 'VENDIDO', summary: 'Compra registrada' });
  }
  } catch (e) {
    // La factura ya quedó registrada: no se rompe el cobro por un fallo posterior.
    console.error('[invoices] post-cobro (atribución/portal/lead) falló:', e);
  }

  // Tras cobrar se ofrece enviar por WhatsApp la CITA del paciente CON su código:
  // ahora sí, porque ya pagó (al nuevo no se le entrega el código hasta este momento).
  // Se toma su próxima cita no cancelada y con el turno aún sin abrir.
  let citaWhatsappUrl: string | null = null;
  try {
  if (b.patientId) {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const [pat, cita] = await Promise.all([
      prisma.patient.findUnique({ where: { id: b.patientId }, select: { name: true, phone: true, sex: true } }),
      prisma.appointment.findFirst({
        where: { patientId: b.patientId, status: { not: 'CANCELADA' }, codeUsedAt: null, startsAt: { gte: hoy } },
        orderBy: { startsAt: 'asc' },
        include: { branch: { select: { name: true, place: true } } },
      }),
    ]);
    if (pat?.phone && cita?.code) {
      // Tras pagar solo se envía el CÓDIGO (la confirmación de la cita ya se
      // mandó al agendar; no se repite para no saturar al paciente).
      const texto = `Hola ${tratoFormal(pat.name, pat.sex)} 💜 Su código de cita en ${sucursalLabel(cita.branch.name, cita.branch.place)} es ${cita.code}. Preséntelo al llegar. Le esperamos 10 min antes. — Li Estetic Center`;
      citaWhatsappUrl = `https://wa.me/${normalizePhone(pat.phone)}?text=${encodeURIComponent(texto)}`;
    }
  }
  } catch (e) {
    console.error('[invoices] post-cobro (whatsapp de cita) falló:', e);
  }

  const pendiente = saldoServicios || saldoPlan;
  const msg = pendiente > 0
    ? `Abono registrado · saldo pendiente RD$${pendiente.toLocaleString('en-US')}`
    : (b.paymentKind === 'ABONO' || b.paymentKind === 'SALDO') && treatmentAfter
    ? `${b.paymentKind === 'SALDO' ? 'Saldo pagado' : 'Abono registrado'} · saldo restante ${'RD$' + treatmentAfter.balance.toLocaleString('en-US')}${treatmentAfter.balance > 0 ? ` (${'RD$' + treatmentAfter.perSession.toLocaleString('en-US')}/sesión en ${treatmentAfter.remaining} sesiones)` : ''}`
    : 'Recibo emitido · pago registrado en caja';
  res.status(201).json({ receipt: { ...serializeReceipt(invoice), paymentKind: b.paymentKind, treatmentAfter }, message: msg, citaWhatsappUrl });
  } catch (e) {
    // Red de seguridad: registra el error completo en el log de Render (para
    // diagnosticar) y devuelve un mensaje limpio. Nunca deja el cobro sin respuesta.
    console.error('[invoices][POST] fallo del cobro:', e);
    return res.status(500).json({ error: 'No se pudo registrar el cobro. Verifica los datos e inténtalo de nuevo.' });
  }
});

type RebillableInvoice = {
  id: string; number: string; branchId: string; patientId: string | null;
  treatmentId: string | null; total: number;
  items: { name: string; total: number }[];
};

/** Devuelve el cobro al paciente sin recrear el combo ni sus sesiones. */
async function prepareForRebilling(invoice: RebillableInvoice, createdById: string): Promise<number> {
  if (!invoice.patientId) return 0;

  // Un abono/saldo vuelve al balance del mismo plan; no se crea además un cargo,
  // porque aparecería dos veces en "Por cobrar".
  if (invoice.treatmentId) {
    const treatment = await prisma.treatment.findUnique({ where: { id: invoice.treatmentId } });
    if (treatment && treatment.patientId === invoice.patientId) {
      await prisma.treatment.update({
        where: { id: treatment.id },
        data: { active: true, balance: Math.min(treatment.price, treatment.balance + invoice.total) },
      });
      return 1;
    }
  }

  // Para una venta normal se recrean solo las líneas positivas como cargos sin
  // catalogItemId. Al refacturarlas no se genera un segundo combo: se conserva el
  // plan/sesiones que ya están cargados en el expediente.
  const lines = invoice.items.filter((it) => it.total > 0 && !it.name.toLowerCase().startsWith('saldo pendiente'));
  if (lines.length) {
    await prisma.chargeItem.createMany({
      data: lines.map((it) => ({
        branchId: invoice.branchId, patientId: invoice.patientId!,
        name: it.name, price: it.total, createdById,
      })),
    });
  }
  return lines.length;
}

/**
 * Anular un recibo (solo Administradora): se conserva para auditoría, deja de
 * contar en caja y el mismo cobro vuelve a "Por cobrar" para emitirlo correctamente.
 */
invoicesRouter.post('/:id/void', requireStaff, requireRole('ADMIN'), branchScope, async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Escribe el motivo de la anulación') }).parse(req.body ?? {});
  const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id }, include: { patient: true, items: true } });
  if (!invoice) return res.status(404).json({ error: 'Recibo no encontrado' });
  if (!assertBranchAccess(req, invoice.branchId)) return res.status(403).json({ error: 'Recibo de otra sucursal' });
  if (invoice.status === 'ANULADA') return res.status(409).json({ error: 'El recibo ya está anulado' });

  await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'ANULADA' } });
  const pending = await prepareForRebilling(invoice, req.staff!.sub);

  await audit(req, {
    action: 'INVOICE_VOID', entity: 'Invoice', entityId: invoice.id, branchId: invoice.branchId,
    summary: `Anuló recibo ${invoice.number} (${invoice.patient?.name ?? 'sin paciente'}): ${reason}`,
  });
  if (pending > 0) {
    await audit(req, {
      action: 'INVOICE_REBILL', entity: 'Invoice', entityId: invoice.id, branchId: invoice.branchId,
      summary: `Recibo ${invoice.number} devuelto a Por cobrar para refacturar`,
    });
  }
  res.json({ ok: true, message: pending > 0
    ? `Recibo ${invoice.number} anulado · ya está disponible en Por cobrar para refacturar`
    : `Recibo ${invoice.number} anulado` });
});

/** Repara facturas anuladas antes de que existiera la devolución automática. */
invoicesRouter.post('/:id/rebill', requireStaff, requireRole('ADMIN'), branchScope, async (req, res) => {
  const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id }, include: { items: true } });
  if (!invoice) return res.status(404).json({ error: 'Recibo no encontrado' });
  if (!assertBranchAccess(req, invoice.branchId)) return res.status(403).json({ error: 'Recibo de otra sucursal' });
  if (invoice.status !== 'ANULADA') return res.status(409).json({ error: 'Solo se puede refacturar un recibo anulado' });
  const already = await prisma.auditLog.findFirst({
    where: { action: 'INVOICE_REBILL', entity: 'Invoice', entityId: invoice.id }, select: { id: true },
  });
  if (already) return res.status(409).json({ error: 'Este recibo ya fue devuelto a Por cobrar' });

  const pending = await prepareForRebilling(invoice, req.staff!.sub);
  if (!pending) return res.status(400).json({ error: 'Este recibo no tiene un paciente o líneas que puedan refacturarse' });
  await audit(req, {
    action: 'INVOICE_REBILL', entity: 'Invoice', entityId: invoice.id, branchId: invoice.branchId,
    summary: `Recibo anulado ${invoice.number} devuelto manualmente a Por cobrar`,
  });
  res.json({ ok: true, message: `${invoice.number} ya está disponible en Por cobrar para emitir la factura correcta` });
});

/**
 * Recupera una compra pagada cuyo plan no llegó a crearse por un fallo posterior
 * a la facturación. Usa las líneas del recibo y las cruza por nombre exacto con el
 * catálogo; es idempotente y nunca duplica un plan activo.
 */
invoicesRouter.post('/:id/restore-plan', requireStaff, requireRole(...billers), branchScope, async (req, res) => {
  const invoice = await prisma.invoice.findUnique({
    where: { id: req.params.id },
    include: { items: true, patient: { select: { name: true } } },
  });
  if (!invoice) return res.status(404).json({ error: 'Recibo no encontrado' });
  if (!assertBranchAccess(req, invoice.branchId)) return res.status(403).json({ error: 'Recibo de otra sucursal' });
  if (invoice.status !== 'PAGADA') return res.status(409).json({ error: 'Solo se recuperan compras de recibos pagados' });
  if (!invoice.patientId) return res.status(400).json({ error: 'El recibo no tiene un paciente asociado' });

  const lines = invoice.items.filter((it) =>
    it.total > 0 &&
    !it.name.toLowerCase().startsWith('saldo pendiente') &&
    !it.name.toLowerCase().startsWith('descuento'),
  );
  const catalog = lines.length ? await prisma.catalogItem.findMany({
    // El catálogo es pequeño; traer solo nombre/id permite comparar sin depender
    // de mayúsculas o espacios de recibos emitidos con versiones anteriores.
    where: { active: true, kind: { in: ['COMBO', 'PAQUETE', 'SERVICIO'] } },
    select: { id: true, name: true },
  }) : [];
  const byName = new Map(catalog.map((it) => [it.name.trim().toLocaleUpperCase('es'), it]));

  const restored: string[] = [];
  const recognized: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const line of lines) {
      const item = byName.get(line.name.trim().toLocaleUpperCase('es'));
      if (!item) continue;
      recognized.push(item.name);
      const treatmentId = await createTreatmentFromCatalog(invoice.patientId!, item.id, { qty: line.qty }, tx);
      if (!treatmentId) continue;
      restored.push(item.name);
      // Enlaza también las citas existentes de esa compra para que el turno abra y
      // cierre contra el plan correcto, incluso si se agendaron antes de facturar.
      await tx.appointment.updateMany({
        where: {
          patientId: invoice.patientId!, catalogItemId: item.id, treatmentId: null,
          status: { not: 'CANCELADA' }, serviceEndedAt: null,
        },
        data: { treatmentId },
      });
    }
  });

  if (!recognized.length) {
    return res.status(400).json({ error: 'Las líneas del recibo no coinciden con un servicio, combo o paquete activo del catálogo' });
  }
  await audit(req, {
    action: 'INVOICE_PLAN_RESTORE', entity: 'Invoice', entityId: invoice.id, branchId: invoice.branchId,
    summary: `${invoice.number} · ${invoice.patient?.name ?? 'Paciente'} · ${restored.length ? `planes recuperados: ${restored.join(', ')}` : 'el plan ya estaba cargado'}`,
  });
  res.json({
    ok: true,
    message: restored.length
      ? `Compra cargada en la ficha: ${restored.join(', ')}. Ya puede abrir y cerrar el turno.`
      : 'La compra ya estaba cargada en la ficha; no se duplicó.',
  });
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
