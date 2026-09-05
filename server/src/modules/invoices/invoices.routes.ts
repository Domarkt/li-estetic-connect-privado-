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
  const payload = await cached(cacheKey('inv:list', req, { date: dateStr }), 45_000, async () => {
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
  const payload = await cached(cacheKey('inv:recv', req), 60_000, async () => {
  const branchId = req.scopeBranchId ?? null;
  const [treatments, charges] = await Promise.all([
    prisma.treatment.findMany({
      where: { balance: { gt: 0 }, ...(branchId ? { patient: { branchId } } : {}) },
      include: { patient: { select: { id: true, name: true, phone: true, sex: true, branch: { select: { name: true } } } } },
    }),
    prisma.chargeItem.findMany({
      where: { status: 'PENDIENTE_FACTURAR', ...(branchId ? { branchId } : {}) },
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
  const payload = await cached(cacheKey('inv:pat', req), 45_000, async () => {
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
        p.chargeItems.some((c) => AHORA - c.createdAt.getTime() <= DIA) ||
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

  const invoice = await prisma.invoice.create({
    data: {
      number, ncf, branchId, patientId: b.patientId ?? null, cashierId: req.staff!.sub,
      treatmentId: b.treatmentId ?? null, paymentKind: b.paymentKind,
      concept: b.concept, subtotal, itbis, total: amount, method: dominant,
      discount: descuento, discountReason: descuento > 0 ? (b.discountReason?.trim() || null) : null,
      ncfType: b.ncfType, itbisApplied: b.itbisApplied,
      clientRnc: b.ncfType === 'B01' ? formatRnc(b.clientRnc!) : null,
      clientName: b.ncfType === 'B01' ? b.clientName!.trim() : null,
      payments: b.payments, status: 'PAGADA',
      items: { create: lineItems },
    },
    include: invoiceInclude,
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

  // Crea el PLAN de sesiones cuando se cobra un combo/paquete: aquí es donde el servicio
  // pagado queda ligado al paciente (con sus sesiones reales, áreas y técnicas), para que
  // la esteticista lo vea al recibir la cita y pueda definir las áreas a trabajar.
  //
  // Si el cobro fue un abono, el faltante se registra en el balance del PLAN (fuente
  // única), no como un cargo pendiente aparte.
  if (!b.skipPlan && b.patientId && (b.items?.length || charges.length)) {
    // Tanto el carrito como los cargos que envió la esteticista (con su
    // catalogItemId) generan plan: así un servicio de varias sesiones cobrado por
    // recepción queda disponible para agendarle la cita después.
    // Si skipPlan viene activo, se omite: el plan YA existe en la ficha y solo se
    // está registrando el ingreso (no se duplica).
    const fuentes = [
      ...(b.items ?? []).filter((it) => it.catalogItemId).map((it) => ({ id: it.catalogItemId!, qty: it.qty })),
      ...charges.filter((c) => c.catalogItemId).map((c) => ({ id: c.catalogItemId!, qty: 1 })),
    ];
    let porRepartir = saldoPlan;
    for (const it of fuentes) {
      try {
        const creado = await createTreatmentFromCatalog(b.patientId, it.id, {
          qty: it.qty, outstanding: porRepartir,
        });
        if (creado) porRepartir = 0;
      } catch { /* el plan no debe bloquear el cobro */ }
    }
  }

  // Atribuye la venta a la esteticista que atiende al paciente (ficha) para puntos y comisiones.
  // TODO lo que sigue es POSTERIOR al cobro ya registrado: nunca debe tumbar la respuesta
  // (si fallara, el cajero vería "error interno" con la factura YA creada y recobraría).
  try {
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
