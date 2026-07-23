import { prisma } from '../../db/prisma.js';
import type { Prisma, PaymentMethod } from '@prisma/client';

// RNC único de Li Estetic Center para las 3 sucursales.
export const RNC = '1-31-46233-2';

// Zona horaria de RD (UTC-4). Se fija explícitamente al formatear fechas para
// que el recibo muestre la hora local aunque el servidor corra en UTC (Render).
const TZ_RD = 'America/Santo_Domingo';

const METHOD_LABEL: Record<PaymentMethod, string> = {
  EFECTIVO: 'Efectivo', TRANSFERENCIA: 'Transferencia', TARJETA: 'Tarjeta', AZUL: 'Azul',
};

/** Tipos de comprobante que emite la estética. */
export type NcfType = 'B02' | 'B01';
export const NCF_LABEL: Record<NcfType, string> = {
  B02: 'Factura de consumo',
  B01: 'Factura de crédito fiscal',
};

/**
 * Desglose del ITBIS.
 *
 * El precio SIEMPRE se cobra con el impuesto ya incluido; aquí solo se separa
 * para el comprobante. No todos los servicios estéticos llevan ITBIS, así que
 * cuando no aplica el subtotal es el total y el impuesto queda en cero.
 */
export function splitItbis(total: number, aplica = true) {
  if (!aplica) return { subtotal: total, itbis: 0 };
  const subtotal = Math.round(total / 1.18);
  return { subtotal, itbis: total - subtotal };
}

/**
 * Valida un RNC (9 dígitos) o cédula (11 dígitos) dominicanos.
 * Solo se comprueba el formato: el timbrado real lo valida la DGII.
 */
export function rncValido(raw: string): boolean {
  const d = (raw || '').replace(/\D/g, '');
  return d.length === 9 || d.length === 11;
}

/** Formato legible: 1-31-46233-2 (RNC) / 001-1234567-8 (cédula). */
export function formatRnc(raw: string): string {
  const d = (raw || '').replace(/\D/g, '');
  if (d.length === 9) return `${d[0]}-${d.slice(1, 3)}-${d.slice(3, 8)}-${d[8]}`;
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 10)}-${d[10]}`;
  return raw;
}

/**
 * Reserva atómicamente el próximo No. de recibo y NCF de la sucursal.
 *
 * Cada tipo de comprobante lleva su PROPIA secuencia (la DGII las exige
 * separadas): B02 para consumo final y B01 para crédito fiscal.
 * En producción, el NCF/e-CF se valida y timbra contra la DGII.
 */
export async function allocateSequence(branchId: string, ncfType: NcfType = 'B02') {
  return prisma.$transaction(async (tx) => {
    const seq = await tx.invoiceSequence.upsert({
      where: { branchId },
      create: { branchId },
      update: {},
    });
    const nextNumber = seq.lastNumber + 1;
    const esCredito = ncfType === 'B01';
    const nextNcf = (esCredito ? seq.lastNcfB01 : seq.lastNcf) + 1;

    await tx.invoiceSequence.update({
      where: { branchId },
      data: {
        lastNumber: nextNumber,
        ...(esCredito ? { lastNcfB01: nextNcf } : { lastNcf: nextNcf }),
      },
    });
    return {
      number: `F-${nextNumber}`,
      // NCF: prefijo del tipo + 10 dígitos. Placeholder hasta integrar DGII.
      ncf: `${ncfType}${String(nextNcf).padStart(10, '0')}`,
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
    date: i.issuedAt.toLocaleString('es-DO', { timeZone: TZ_RD, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
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
    invoiceId: i.id, // id real, para reenviar el recibo por correo/WhatsApp
    ncf: i.ncf,
    branchName: i.branch.name,
    branchPlace: i.branch.place,
    branchAddress: i.branch.address,
    branchPhone: i.branch.phone,
    branchEmail: i.branch.email,
    rnc: RNC,
    date: i.issuedAt.toLocaleString('es-DO', { timeZone: TZ_RD, day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    patient: i.patient?.name ?? 'Cliente',
    // Contacto para enviarle el recibo (sustituye a imprimirlo).
    patientEmail: i.patient?.email ?? null,
    patientPhone: i.patient?.phone ?? null,
    concept: i.concept,
    items: i.items.map((it) => ({ name: it.name, qty: it.qty, total: it.total })),
    subtotal: i.subtotal,
    itbis: i.itbis,
    total: i.total,
    // Comprobante fiscal: en crédito fiscal el recibo debe mostrar a quién se emite.
    ncfType: i.ncfType,
    ncfLabel: NCF_LABEL[(i.ncfType as NcfType)] ?? 'Factura de consumo',
    itbisApplied: i.itbisApplied,
    clientRnc: i.clientRnc,
    clientName: i.clientName,
    method: paymentLines(i).length > 1 ? 'Mixto' : METHOD_LABEL[i.method],
    payments: paymentLines(i), // desglose para el recibo
    paymentKind: i.paymentKind,
  };
}
