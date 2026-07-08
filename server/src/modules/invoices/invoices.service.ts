import { prisma } from '../../db/prisma.js';
import type { Prisma, PaymentMethod } from '@prisma/client';

// RNC único de Li Estetic Center para las 3 sucursales.
export const RNC = '1-31-46233-2';

const METHOD_LABEL: Record<PaymentMethod, string> = {
  EFECTIVO: 'Efectivo', TRANSFERENCIA: 'Transferencia', TARJETA: 'Tarjeta', AZUL: 'Azul',
};

/** ITBIS 18% incluido en el monto: total dado → subtotal + itbis. */
export function splitItbis(total: number) {
  const subtotal = Math.round(total / 1.18);
  return { subtotal, itbis: total - subtotal };
}

/**
 * Reserva atómicamente el próximo No. de recibo y NCF (e-CF) de la sucursal.
 * En producción, el NCF/e-CF se valida y timbra contra la DGII.
 */
export async function allocateSequence(branchId: string) {
  return prisma.$transaction(async (tx) => {
    const seq = await tx.invoiceSequence.upsert({
      where: { branchId },
      create: { branchId },
      update: {},
    });
    const nextNumber = seq.lastNumber + 1;
    const nextNcf = seq.lastNcf + 1;
    await tx.invoiceSequence.update({
      where: { branchId },
      data: { lastNumber: nextNumber, lastNcf: nextNcf },
    });
    return {
      number: `F-${nextNumber}`,
      // e-CF consumidor final: prefijo + 10 dígitos. Placeholder hasta integrar DGII.
      ncf: `${seq.ncfType}${String(nextNcf).padStart(10, '0')}`,
    };
  });
}

export const invoiceInclude = {
  branch: true,
  patient: true,
  items: true,
} satisfies Prisma.InvoiceInclude;

function paymentLines(i: Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>) {
  const raw = (i.payments ?? null) as { method: keyof typeof METHOD_LABEL; amount: number }[] | null;
  if (!raw || raw.length === 0) return [{ method: METHOD_LABEL[i.method], amount: i.total }];
  return raw.map((p) => ({ method: METHOD_LABEL[p.method], amount: p.amount }));
}

export function serializeInvoiceRow(i: Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>) {
  const lines = paymentLines(i);
  return {
    id: i.id,
    number: i.number,
    patient: i.patient?.name ?? 'Cliente',
    date: i.issuedAt.toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
    branchName: i.branch.name,
    concept: i.concept,
    method: lines.length > 1 ? 'Mixto' : lines[0].method,
    total: i.total,
    status: i.status === 'PAGADA' ? 'Pagada' : i.status === 'ANULADA' ? 'Anulada' : 'Pendiente',
  };
}

/** Datos completos para el recibo imprimible. */
export function serializeReceipt(i: Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>) {
  return {
    id: i.number,
    ncf: i.ncf,
    branchName: i.branch.name,
    branchPlace: i.branch.place,
    branchAddress: i.branch.address,
    branchPhone: i.branch.phone,
    rnc: RNC,
    date: i.issuedAt.toLocaleString('es-DO', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    patient: i.patient?.name ?? 'Cliente',
    concept: i.concept,
    items: i.items.map((it) => ({ name: it.name, qty: it.qty, total: it.total })),
    subtotal: i.subtotal,
    itbis: i.itbis,
    total: i.total,
    method: paymentLines(i).length > 1 ? 'Mixto' : METHOD_LABEL[i.method],
    payments: paymentLines(i), // desglose para el recibo
    paymentKind: i.paymentKind,
  };
}
