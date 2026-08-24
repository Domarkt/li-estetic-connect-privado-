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
  if (!item) return null;

  // Genera plan TODO lo que se consume en varias visitas:
  //  · combos y paquetes (aunque sean de 1 sesión: llevan áreas y técnicas), y
  //  · servicios de varias sesiones (ej. "Reducción de medidas · 10 sesiones").
  // Antes solo COMBO/PAQUETE: un servicio de 10 sesiones se cobraba y el paciente
  // quedaba sin plan, sin forma de agendar ni descontar lo que ya había pagado.
  // Todo lo que se ATIENDE (servicio, combo o paquete) genera un plan en la ficha
  // y el portal, aunque sea de 1 sola sesión (ej. un Scurpt). Solo se excluyen los
  // bienes físicos: productos e insumos no son tratamientos.
  const esPlan = item.kind === 'COMBO' || item.kind === 'PAQUETE' || item.kind === 'SERVICIO';
  if (!esPlan) return null;

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
  if (item.incluye?.length) {
    await seedTreatmentTechniques(treatment.id, item.incluye.map((x) => ({ name: x.service.name, qty: x.qty * qty })));
  } else {
    // Servicio suelto: se siembra a sí mismo como técnica. Sin esto la esteticista
    // no tenía nada que marcar al registrar y la sesión nunca se descontaba.
    await seedTreatmentTechniques(treatment.id, [{ name: item.name, qty: total }]);
  }
  return treatment.id;
}

/** Reparte un saldo histórico entre técnicas respetando la proporción del combo. */
export function repartirSesionesPorPeso(total: number, pesos: number[]): number[] {
  if (total <= 0 || !pesos.length) return pesos.map(() => 0);
  const normalizados = pesos.map((p) => Math.max(0, p));
  const suma = normalizados.reduce((acc, p) => acc + p, 0);
  if (suma <= 0) return repartirSesiones(total, pesos.length);
  const exactos = normalizados.map((p) => (p / suma) * total);
  const reparto = exactos.map(Math.floor);
  let faltan = total - reparto.reduce((acc, n) => acc + n, 0);
  const prioridad = exactos.map((n, i) => ({ i, resto: n - Math.floor(n) })).sort((a, b) => b.resto - a.resto);
  for (let n = 0; n < faltan; n += 1) reparto[prioridad[n % prioridad.length].i] += 1;
  return reparto;
}

/**
 * Carga un plan comprado antes de usar Li Estetic Connect.
 *
 * Solo registra las sesiones que todavía debe recibir el paciente. No crea cargos,
 * facturas, ventas ni comisiones. Si todavía debe dinero, ese saldo sí queda en el
 * plan para que los abonos futuros reduzcan una única fuente de verdad.
 */
export async function createHistoricalTreatmentFromCatalog(
  patientId: string,
  catalogItemId: string,
  remainingSessions: number,
  outstandingBalance = 0,
  remainingTechniques: { serviceId: string; remaining: number }[] = [],
): Promise<{ id: string; name: string; sessions: number } | { error: 'notfound' | 'notplan' | 'duplicate' | 'techniques' }> {
  const item = await prisma.catalogItem.findUnique({
    where: { id: catalogItemId },
    include: { incluye: { include: { service: true } } },
  });
  if (!item) return { error: 'notfound' };
  if (!(item.kind === 'COMBO' || item.kind === 'PAQUETE' || item.kind === 'SERVICIO')) {
    return { error: 'notplan' };
  }

  // Evita que una carga histórica duplique un plan que el paciente ya tiene activo.
  const existing = await prisma.treatment.findFirst({
    where: { patientId, catalogItemId: item.id, active: true },
    select: { id: true },
  });
  if (existing) return { error: 'duplicate' };

  // Si el combo tiene varias técnicas, recepción debe declarar exactamente
  // cuánto queda de cada una. No se infiere: son datos clínico-operativos reales.
  if (item.incluye?.length) {
    const entered = new Map(remainingTechniques.map((x) => [x.serviceId, x.remaining]));
    const valid = entered.size === item.incluye.length && item.incluye.every(
      (x) => entered.has(x.serviceId) && (entered.get(x.serviceId) ?? -1) >= 0 && (entered.get(x.serviceId) ?? 0) <= x.qty,
    );
    if (!valid) return { error: 'techniques' };
  }

  const sessions = Math.max(1, Math.trunc(remainingSessions));
  const treatment = await prisma.treatment.create({
    data: {
      patientId,
      catalogItemId: item.id,
      name: item.name,
      totalSessions: sessions,
      doneSessions: 0,
      // Un saldo histórico no es una venta nueva: solo habilita cobros futuros.
      price: outstandingBalance > 0 ? item.price : 0,
      balance: outstandingBalance,
    },
  });

  if (item.defaultAreas?.length) {
    await seedTreatmentAreas(treatment.id, item.defaultAreas, sessions);
  }
  // Las técnicas nacen con las cantidades restantes exactas informadas por
  // recepción; `done=0` porque el sistema empieza a controlar desde hoy.
  if (item.incluye?.length) {
    const entered = new Map(remainingTechniques.map((x) => [x.serviceId, x.remaining]));
    await seedTreatmentTechniques(treatment.id, item.incluye.map((x) => ({ name: x.service.name, qty: entered.get(x.serviceId) ?? 0 })));
  } else {
    await seedTreatmentTechniques(treatment.id, [{ name: item.name, qty: sessions }]);
  }

  return { id: treatment.id, name: item.name, sessions };
}

/**
 * Cambio de combo: la clienta pasa a un combo de MAYOR valor (más áreas/sesiones).
 * Se conserva el avance (sesiones hechas, áreas y técnicas ya consumidas) y solo se
 * cobra la DIFERENCIA de precio. Las áreas adicionales ya cobradas (isExtra) se
 * mantienen. No se toca el saldo previo del plan: la diferencia es un cargo aparte.
 *
 * Devuelve la diferencia a cobrar (nunca negativa) para que recepción la facture.
 */
export async function cambiarCombo(
  treatmentId: string,
  newCatalogItemId: string,
  priceOverride?: number,
) {
  const t = await prisma.treatment.findUnique({
    where: { id: treatmentId },
    include: { areas: true, techniques: true },
  });
  if (!t) return { error: 'notfound' as const };
  const item = await prisma.catalogItem.findUnique({
    where: { id: newCatalogItemId },
    include: { incluye: { include: { service: true } } },
  });
  if (!item) return { error: 'nocatalog' as const };
  if (!(item.kind === 'COMBO' || item.kind === 'PAQUETE')) return { error: 'notcombo' as const };
  if (item.id === t.catalogItemId) return { error: 'same' as const };

  const nuevoPrecio = item.price ?? 0;
  // Diferencia = precio del nuevo combo − precio del actual (nunca negativa). Si
  // recepción negocia un monto, se usa el override.
  const diferencia = Math.max(0, (priceOverride ?? nuevoPrecio) - t.price);
  // El total nunca baja de lo ya realizado (no se pierde el avance del paciente).
  const nuevoTotal = Math.max(t.doneSessions, item.sessions ?? 1);
  const oldName = t.name;

  // Áreas incluidas: se reemplazan por las del nuevo combo, conservando el avance
  // de las que coinciden. Las adicionales ya cobradas (isExtra) se mantienen intactas.
  if (item.defaultAreas?.length) {
    const prevDone = new Map(t.areas.filter((a) => !a.isExtra).map((a) => [a.area, a.doneSessions]));
    const reparto = repartirSesiones(nuevoTotal, item.defaultAreas.length);
    await prisma.treatmentArea.deleteMany({ where: { treatmentId: t.id, isExtra: false } });
    await prisma.treatmentArea.createMany({
      data: item.defaultAreas.map((area, i) => ({
        treatmentId: t.id, area, totalSessions: reparto[i],
        doneSessions: Math.min(prevDone.get(area) ?? 0, reparto[i]),
        isExtra: false,
      })),
      skipDuplicates: true,
    });
  }

  // Técnicas: se reemplazan por las del nuevo combo, conservando lo ya aplicado.
  if (item.incluye?.length) {
    const prevDone = new Map(t.techniques.map((x) => [x.name, x.done]));
    await prisma.treatmentTechnique.deleteMany({ where: { treatmentId: t.id } });
    await prisma.treatmentTechnique.createMany({
      data: item.incluye.map((x) => ({
        treatmentId: t.id, name: x.service.name, total: x.qty,
        done: Math.min(prevDone.get(x.service.name) ?? 0, x.qty),
      })),
      skipDuplicates: true,
    });
  }

  await prisma.treatment.update({
    where: { id: t.id },
    data: { name: item.name, catalogItemId: item.id, totalSessions: nuevoTotal, price: nuevoPrecio, active: true },
  });

  return { ok: true as const, diferencia, nuevoPrecio, nombre: item.name, oldName, totalSessions: nuevoTotal };
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

  // El plan consume TANTAS sesiones como áreas se trabajaron: sus sesiones se
  // repartieron entre las áreas (18 en 2 áreas = 9 y 9), así que trabajar las dos
  // en una visita gasta 2. Si no se marcó ninguna área, se cuenta como 1.
  const consumidas = areas.length || 1;
  const done = Math.min(t.totalSessions, t.doneSessions + consumidas);
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

/**
 * Rectificar una sesión ya registrada: AGREGAR un área o técnica que se trabajó
 * pero no se marcó (el caso "faltó un área y no se podía editar"). No re-firma:
 * es una corrección de la misma visita. Cada área agregada que aún tenga cupo
 * consume su sesión del plan, igual que si se hubiera marcado al registrar.
 * No se quitan las que ya estaban: solo se añaden las nuevas.
 */
export async function rectificarSesion(
  sessionId: string,
  datos: { areas: string[]; techniques: string[] },
) {
  const s = await prisma.treatmentSession.findUnique({ where: { id: sessionId } });
  if (!s) return null;
  const t = await prisma.treatment.findUnique({
    where: { id: s.treatmentId }, include: { areas: true, techniques: true },
  });
  if (!t) return null;

  // Solo lo que aún no estaba en la sesión y todavía tiene cupo disponible.
  const areasNuevas = t.areas.filter(
    (a) => datos.areas.includes(a.area) && !s.areas.includes(a.area) && a.doneSessions < a.totalSessions,
  );
  const tecNuevas = t.techniques.filter(
    (x) => datos.techniques.includes(x.name) && !s.techniques.includes(x.name) && x.done < x.total,
  );

  for (const a of areasNuevas) {
    await prisma.treatmentArea.update({ where: { id: a.id }, data: { doneSessions: { increment: 1 } } });
  }
  for (const x of tecNuevas) {
    await prisma.treatmentTechnique.update({ where: { id: x.id }, data: { done: { increment: 1 } } });
  }

  // Cada área añadida gasta una sesión del plan (se reparten por área).
  const done = Math.min(t.totalSessions, t.doneSessions + areasNuevas.length);
  const restantes = Math.max(0, t.totalSessions - done);
  await prisma.treatment.update({
    where: { id: t.id },
    data: { doneSessions: done, active: restantes > 0 },
  });

  const sesion = await prisma.treatmentSession.update({
    where: { id: s.id },
    data: {
      areas: [...s.areas, ...areasNuevas.map((a) => a.area)],
      techniques: [...s.techniques, ...tecNuevas.map((x) => x.name)],
    },
  });

  return { sesion, done, restantes, total: t.totalSessions, agregadas: areasNuevas.length + tecNuevas.length };
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
