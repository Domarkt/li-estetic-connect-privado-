/** Fecha local de República Dominicana para controles y filtros del sistema. */
export function localISODate(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function localISOMonth(date = new Date()): string {
  return localISODate(date).slice(0, 7);
}
