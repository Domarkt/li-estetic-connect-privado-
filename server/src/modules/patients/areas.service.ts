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

/**
 * Crea el tratamiento activo del paciente a partir de un ítem del catálogo (combo/paquete)
 * cuando se COBRA. Aquí es donde nace el plan que verá la esteticista: sesiones reales del
 * ítem (no un 10 fijo), áreas por defecto y conteo por técnica. Best-effort e idempotente:
 * si el paciente ya tiene un tratamiento activo de ese mismo ítem, no crea otro.
 *
 * @returns el id del tratamiento creado, o null si se omitió (ya existía o el ítem no aplica).
 */
export async function createTreatmentFromCatalog(
  patientId: string,
  catalogItemId: string,
  opts: { qty?: number; outstanding?: number } = {},
): Promise<string | null> {
  const item = await prisma.catalogItem.findUnique({
    where: { id: catalogItemId },
    include: { incluye: { include: { service: true } } },
  });
  // Solo los combos/paquetes generan un plan de sesiones; los servicios sueltos no.
  if (!item || (item.kind !== 'COMBO' && item.kind !== 'PAQUETE')) return null;

  // Idempotencia: no duplicar el plan si ya tiene uno activo de este mismo ítem.
  const yaTiene = await prisma.treatment.findFirst({ where: { patientId, catalogItemId: item.id, active: true } });
  if (yaTiene) return null;

  const qty = Math.max(1, opts.qty ?? 1);
  const total = Math.max(1, (item.sessions ?? 1) * qty);
  const precio = (item.price ?? 0) * qty;
  const treatment = await prisma.treatment.create({
    data: {
      patientId, name: item.name, catalogItemId: item.id,
      totalSessions: total, doneSessions: 0,
      // FUENTE ÚNICA del dinero pendiente de un plan: este balance.
      // Si el paciente abonó, aquí queda lo que falta; si pagó todo, queda en 0.
      // No se crean cargos sintéticos de "saldo" en paralelo.
      price: precio,
      balance: Math.max(0, Math.min(opts.outstanding ?? 0, precio)),
    },
  });
  if (item.defaultAreas?.length) await seedTreatmentAreas(treatment.id, item.defaultAreas, total);
  if (item.incluye?.length) await seedTreatmentTechniques(treatment.id, item.incluye.map((x) => ({ name: x.service.name, qty: x.qty * qty })));
  return treatment.id;
}

/**
 * Registra lo que se le APLICÓ al paciente en una visita y descuenta lo consumido.
 *
 * Es el punto donde queda constancia de cuál de las técnicas del combo se usó ese
 * día (antes solo se veía el contador, sin forma de decir cuál se aplicó) y de que
 * el paciente lo validó con su firma.
 *
 * Consume, sin pasarse de lo comprado:
 *  · 1 uso de cada técnica marcada,
 *  · 1 sesión de cada área trabajada,
 *  · 1 sesión del plan.
 */
export async function registrarSesionAplicada(
  treatmentId: string,
  datos: { techniques: string[]; areas: string[]; therapistId?: string | null; signature?: string | null; notes?: string | null },
) {
  const t = await prisma.treatment.findUnique({
    where: { id: treatmentId },
    include: { areas: true, techniques: true },
  });
  if (!t) return null;

  // Solo lo que realmente queda disponible (no se descuenta de más).
  const tecnicas = t.techniques.filter((x) => datos.techniques.includes(x.name) && x.done < x.total);
  const areas = t.areas.filter((a) => datos.areas.includes(a.area) && a.doneSessions < a.totalSessions);

  for (const tec of tecnicas) {
    await prisma.treatmentTechnique.update({ where: { id: tec.id }, data: { done: { increment: 1 } } });
  }
  for (const a of areas) {
    await prisma.treatmentArea.update({ where: { id: a.id }, data: { doneSessions: { increment: 1 } } });
  }

  const done = Math.min(t.totalSessions, t.doneSessions + 1);
  const restantes = Math.max(0, t.totalSessions - done);
  await prisma.treatment.update({
    where: { id: t.id },
    data: { doneSessions: done, ...(restantes === 0 ? { active: false } : {}) },
  });

  const sesion = await prisma.treatmentSession.create({
    data: {
      treatmentId: t.id, patientId: t.patientId, therapistId: datos.therapistId ?? null,
      techniques: tecnicas.map((x) => x.name),
      areas: areas.map((a) => a.area),
      signature: datos.signature ?? null,
      notes: datos.notes ?? null,
    },
  });

  return { sesion, done, restantes, total: t.totalSessions };
}

/** Resuelve nombres de esteticistas en una sola consulta. */
async function nombresTerapeutas(ids: (string | null)[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unicos.length) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: unicos } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

/** Sesiones ya registradas de un plan (historial de lo aplicado). */
export async function listarSesiones(treatmentId: string, labels: Record<string, string> = AREA_LABEL) {
  const rows = await prisma.treatmentSession.findMany({
    where: { treatmentId }, orderBy: { at: 'desc' }, take: 50,
  });
  const terapeutas = await nombresTerapeutas(rows.map((s) => s.therapistId));
  return rows.map((s) => ({
    id: s.id,
    at: s.at.toISOString(),
    fecha: s.at.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' }),
    techniques: s.techniques,
    areas: s.areas.map((a) => labels[a] ?? a),
    esteticista: s.therapistId ? terapeutas.get(s.therapistId) ?? null : null,
    firmada: !!s.signature,
    notes: s.notes,
  }));
}

/**
 * Bitácora digital del paciente: TODAS sus sesiones, de todos sus planes, en
 * orden cronológico. Sustituye al "control de citas" que se llenaba a mano.
 *
 * Incluye la esteticista de cada visita a propósito: un mismo paciente puede ser
 * atendido por varias según el combo y la técnica que toque ese día.
 */
export async function bitacoraPaciente(patientId: string, labels: Record<string, string> = AREA_LABEL) {
  const rows = await prisma.treatmentSession.findMany({
    where: { patientId },
    include: { treatment: { select: { name: true } } },
    orderBy: { at: 'asc' }, // la cita 1 es la primera: se lee como un historial
    take: 200,
  });
  const terapeutas = await nombresTerapeutas(rows.map((s) => s.therapistId));
  return rows.map((s, i) => ({
    id: s.id,
    numero: i + 1,
    at: s.at.toISOString(),
    fecha: s.at.toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    hora: s.at.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' }),
    tratamiento: s.treatment?.name ?? '—',
    techniques: s.techniques,
    areas: s.areas.map((a) => labels[a] ?? a),
    esteticista: s.therapistId ? terapeutas.get(s.therapistId) ?? null : null,
    observaciones: s.notes,
    firmada: !!s.signature,
  }));
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
