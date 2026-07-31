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
