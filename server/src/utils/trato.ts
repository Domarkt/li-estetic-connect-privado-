/**
 * Trato formal para los mensajes al paciente (correo / WhatsApp):
 *   sexo F → "Sra. Eileen"   ·   sexo M → "Sr. Juan"   ·   sin sexo → solo el nombre.
 * Usa el PRIMER nombre para que suene cercano pero formal.
 */
export function tratoFormal(name: string, sex?: string | null): string {
  const first = (name || '').trim().split(/\s+/)[0] || (name || '').trim();
  const titulo = sex === 'F' ? 'Sra.' : sex === 'M' ? 'Sr.' : '';
  return titulo ? `${titulo} ${first}` : first;
}

/**
 * Nombre de la sucursal CON su ubicación para los mensajes al paciente. Como
 * Estética 1 y 2 están en la misma calle en plazas distintas, se incluye el lugar
 * para que el paciente sepa a cuál ir. Ej: "Estética 2 · Plaza Baró, 2do nivel".
 */
export function sucursalLabel(name: string, place?: string | null): string {
  const p = (place || '').trim();
  return p ? `${name} · ${p}` : name;
}
