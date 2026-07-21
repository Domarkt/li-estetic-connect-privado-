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

export const AREA_LABEL: Record<string, string> = {
  ABDOMEN: 'Abdomen',
  ESPALDA: 'Espalda',
  ABDOMEN_LATERAL: 'Abdomen lateral',
  PIERNAS: 'Piernas',
  AXILAS: 'Axilas',
  BRAZOS: 'Brazos',
  CUERPO_COMPLETO: 'Cuerpo completo',
  BOZO: 'Bozo',
  CARA: 'Cara',
  ENTREPIERNAS: 'Entrepiernas',
  INTIMOS: 'Íntimos',
};

/** Familias de áreas para agrupar el selector. */
export const AREA_GROUPS: { label: string; areas: Area[] }[] = [
  { label: 'Corporal', areas: ['ABDOMEN', 'ESPALDA', 'ABDOMEN_LATERAL'] },
  { label: 'Láser', areas: ['PIERNAS', 'AXILAS', 'BRAZOS', 'CUERPO_COMPLETO', 'BOZO', 'CARA', 'ENTREPIERNAS', 'INTIMOS'] },
];

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

/** Serializa las áreas de un tratamiento para la interfaz. */
export function serializeAreas(areas: { id: string; area: string; totalSessions: number; doneSessions: number; isExtra: boolean }[]) {
  return areas.map((a) => ({
    id: a.id,
    area: a.area,
    label: AREA_LABEL[a.area] ?? a.area,
    total: a.totalSessions,
    done: a.doneSessions,
    remaining: Math.max(0, a.totalSessions - a.doneSessions),
    isExtra: a.isExtra,
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
