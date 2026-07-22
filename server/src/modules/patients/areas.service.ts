import { prisma } from '../../db/prisma.js';

/**
 * Áreas que cubren los paquetes y combos, en dos familias:
 *  - Corporal: combos reductores (abdomen, espalda, lateral).
 *  - Láser: depilación (piernas, axilas, brazos, cuerpo completo, bozo, cara, etc.).
 * En el corporal se incluyen 2 y la 3ra es adicional; en láser se eligen las que cubra el paquete.
 */
export const AREAS = [
  'ABDOMEN', 'ESPALDA', 'ABDOMEN_LATERAL',
  'PIERNAS', 'AXILAS', 'BRAZOS', 'CUERPO_COMPLETO', 'BOZO', 'CARA', 'ENTREPIERNAS', 'INTIMOS',
] as const;
export type Area = (typeof AREAS)[number];

// Etiquetas base de respaldo (por si la tabla BodyArea aún no está sembrada).
export const AREA_LABEL: Record<string, string> = {
  ABDOMEN: 'Abdomen', ESPALDA: 'Espalda', ABDOMEN_LATERAL: 'Abdomen lateral',
  MUSLO: 'Muslo', GLUTEOS: 'Glúteos',
  PIERNAS: 'Piernas', AXILAS: 'Axilas', BRAZOS: 'Brazos', CUERPO_COMPLETO: 'Cuerpo completo',
  BOZO: 'Bozo', CARA: 'Cara', ENTREPIERNAS: 'Entrepiernas', INTIMOS: 'Íntimos',
};

/** Mapa clave→etiqueta desde la tabla administrable (con respaldo estático). */
export async function getAreaLabelMap(): Promise<Record<string, string>> {
  try {
    const areas = await prisma.bodyArea.findMany({ select: { key: true, label: true } });
    const map: Record<string, string> = { ...AREA_LABEL };
    for (const a of areas) map[a.key] = a.label;
    return map;
  } catch {
    return { ...AREA_LABEL };
  }
}

/** Áreas administrables agrupadas (para los selectores del frontend). */
export async function getBodyAreasGrouped() {
  const areas = await prisma.bodyArea.findMany({ where: { active: true }, orderBy: [{ grupo: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }] });
  const byGroup = (g: string) => areas.filter((a) => a.grupo === g).map((a) => ({ key: a.key, label: a.label }));
  return [
    { label: 'Corporal', areas: byGroup('CORPORAL') },
    { label: 'Láser', areas: byGroup('LASER') },
  ];
}

/** Precio de la 3ra área (se cobra en recepción como cargo pendiente). */
export const AREA_EXTRA_PRECIO = 1500;

/**
 * Reparte las sesiones del paquete/combo entre las áreas elegidas.
 * 12 sesiones con 2 áreas → 6 y 6. Si no divide exacto, la primera se queda con el resto.
 */
export function repartirSesiones(total: number, cantidadAreas: number): number[] {
  if (cantidadAreas <= 0) return [];
  const base = Math.floor(total / cantidadAreas);
  const resto = total % cantidadAreas;
  return Array.from({ length: cantidadAreas }, (_, i) => base + (i < resto ? 1 : 0));
}

/** Serializa las áreas de un tratamiento para la interfaz. `labels` viene de getAreaLabelMap(). */
export function serializeAreas(
  areas: { id: string; area: string; totalSessions: number; doneSessions: number; isExtra: boolean }[],
  labels: Record<string, string> = AREA_LABEL,
) {
  return areas.map((a) => ({
    id: a.id,
    area: a.area,
    label: labels[a.area] ?? a.area,
    total: a.totalSessions,
    done: a.doneSessions,
    remaining: Math.max(0, a.totalSessions - a.doneSessions),
    isExtra: a.isExtra,
  }));
}

/**
 * Siembra las áreas incluidas de un tratamiento recién creado desde el combo/paquete
 * (las que se eligieron al crearlo en el catálogo). No hace nada si no hay áreas o si
 * el tratamiento ya tiene alguna.
 */
export async function seedTreatmentAreas(treatmentId: string, areas: string[], totalSessions: number): Promise<void> {
  const validas = areas.filter((a) => !!a && a.trim());
  if (!validas.length) return;
  const existentes = await prisma.treatmentArea.count({ where: { treatmentId } });
  if (existentes > 0) return;
  const reparto = repartirSesiones(totalSessions, validas.length);
  await prisma.treatmentArea.createMany({
    data: validas.map((area, i) => ({ treatmentId, area, totalSessions: reparto[i], isExtra: false })),
    skipDuplicates: true,
  });
}

/**
 * Siembra el conteo por técnica del combo (18 cavitaciones, 3 lipoláser…) al venderlo.
 * No hace nada si ya hay técnicas sembradas.
 */
export async function seedTreatmentTechniques(treatmentId: string, items: { name: string; qty: number }[]): Promise<void> {
  if (!items.length) return;
  const existentes = await prisma.treatmentTechnique.count({ where: { treatmentId } });
  if (existentes > 0) return;
  await prisma.treatmentTechnique.createMany({
    data: items.map((i) => ({ treatmentId, name: i.name, total: i.qty })),
    skipDuplicates: true,
  });
}

/** Serializa las técnicas de un tratamiento para la interfaz. */
export function serializeTechniques(techs: { id: string; name: string; total: number; done: number }[]) {
  return techs.map((t) => ({
    id: t.id, name: t.name, qty: t.total,
    total: t.total, done: t.done, remaining: Math.max(0, t.total - t.done),
  }));
}

/**
 * Define las 2 áreas incluidas de un combo y reparte sus sesiones.
 * Reemplaza las áreas incluidas anteriores; conserva las adicionales ya cobradas.
 */
export async function definirAreas(treatmentId: string, seleccion: string[]) {
  const t = await prisma.treatment.findUnique({ where: { id: treatmentId }, include: { areas: true } });
  if (!t) return null;

  const reparto = repartirSesiones(t.totalSessions, seleccion.length);

  // Las áreas adicionales (3ra, ya cobrada) no se tocan al redefinir las incluidas.
  await prisma.treatmentArea.deleteMany({ where: { treatmentId, isExtra: false } });
  await prisma.treatmentArea.createMany({
    data: seleccion.map((area, i) => ({
      treatmentId, area,
      totalSessions: reparto[i],
      // Si el área ya existía, se conserva lo consumido para no perder el avance.
      doneSessions: t.areas.find((x) => x.area === area)?.doneSessions ?? 0,
      isExtra: false,
    })),
    skipDuplicates: true,
  });

  return prisma.treatment.findUnique({ where: { id: treatmentId }, include: { areas: true } });
}
