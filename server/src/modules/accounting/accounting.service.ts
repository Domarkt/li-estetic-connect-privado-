// Contabilidad — helpers puros compartidos por las rutas.
// El dinero se maneja en pesos enteros (RD$). Las fechas se formatean fijando la
// zona horaria de RD para que el servidor en UTC (Render) muestre la hora local.

export const TZ_RD = 'America/Santo_Domingo';

export type LedgerType = 'INGRESO' | 'EGRESO' | 'RETIRO' | 'APORTE' | 'TRASLADO';
export const LEDGER_TYPES: LedgerType[] = ['INGRESO', 'EGRESO', 'RETIRO', 'APORTE', 'TRASLADO'];

export const TYPE_LABEL: Record<string, string> = {
  INGRESO: 'Ingreso',
  EGRESO: 'Egreso / Gasto',
  RETIRO: 'Retiro de socia',
  APORTE: 'Aporte de socia',
  TRASLADO: 'Traslado / Depósito',
};

export const METHOD_LABEL: Record<string, string> = {
  EFECTIVO: 'Efectivo', TRANSFERENCIA: 'Transferencia', TARJETA: 'Tarjeta', AZUL: 'Azul', OTRO: 'Otro',
};

/** Signo en el FLUJO DE CAJA: entra (+1) o sale (−1). El depósito bancario saca
 *  efectivo de la caja hacia el banco, por eso TRASLADO cuenta como salida. */
export function cashSign(type: string): 1 | -1 {
  return type === 'INGRESO' || type === 'APORTE' ? 1 : -1;
}

/** ¿Entra al Estado de Resultados? Solo la operación: ingresos y egresos.
 *  Retiros, aportes y traslados mueven caja/patrimonio, no son utilidad. */
export function affectsPnl(type: string): boolean {
  return type === 'INGRESO' || type === 'EGRESO';
}

/** Rango [from, to] a partir del query (por defecto, el mes actual completo). */
export function range(q: Record<string, unknown>) {
  const today = new Date();
  const defFrom = new Date(today.getFullYear(), today.getMonth(), 1);
  const from = q.from ? new Date(String(q.from) + 'T00:00:00') : defFrom;
  const to = q.to
    ? new Date(String(q.to) + 'T23:59:59')
    : new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
  return { from, to };
}

/** Sucursal en foco a partir de ?branch (solo admin usa este módulo). null = todas. */
export function scopeOf(q: Record<string, unknown>): string | null {
  const b = q.branch as string | undefined;
  return b && b !== 'all' ? b : null;
}

/** DD/MM/YYYY en hora RD. */
export function fmtDate(d: Date): string {
  return d.toLocaleDateString('es-DO', { timeZone: TZ_RD, day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** YYYY-MM del rango o fecha (para agrupar por mes / cierres). */
export function periodOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/** Tipo de identificación DGII: 1 = RNC (9 díg.), 2 = Cédula (11 díg.), '' = inválido. */
export function tipoId(rnc: string | null | undefined): '1' | '2' | '' {
  const d = (rnc || '').replace(/\D/g, '');
  if (d.length === 9) return '1';
  if (d.length === 11) return '2';
  return '';
}

/** Desglosa el pago de una factura por método (usa payments si está dividido). */
export function invoiceByMethod(
  inv: { method: string; total: number; payments: unknown },
): Array<{ method: string; amount: number }> {
  const raw = (inv.payments ?? null) as { method: string; amount: number }[] | null;
  if (Array.isArray(raw) && raw.length) return raw.map((p) => ({ method: p.method, amount: p.amount }));
  return [{ method: inv.method, amount: inv.total }];
}
