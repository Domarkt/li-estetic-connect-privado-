import type { StaffUser } from './types';

/**
 * ¿Puede crear/editar el catálogo (servicios, paquetes, combos, productos, insumos)?
 *
 * TEMPORAL (fase de carga de datos): incluye a RECEPCIONISTA para que las tres
 * estéticas avancen cargando su base. Cuando esté lista, se quita 'RECEPCIONISTA'
 * de aquí y del backend (ROLES_CATALOGO en catalog.routes.ts) y el permiso vuelve
 * a concederse solo por persona desde Equipo.
 */
export function puedeGestionarCatalogo(staff: StaffUser | null | undefined): boolean {
  if (!staff) return false;
  return staff.role === 'ADMIN' || staff.role === 'RECEPCIONISTA' || !!staff.canManageCatalog;
}
