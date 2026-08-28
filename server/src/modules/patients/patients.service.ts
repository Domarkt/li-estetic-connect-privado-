import { prisma } from '../../db/prisma.js';
import type { Prisma } from '@prisma/client';

const FICHA_LABEL: Record<string, string> = {
  PENDIENTE: 'Pendiente',
  PASO1_OK: 'En proceso (esteticista)',
  COMPLETA: 'Completa',
};

/** Edad calculada a partir de la fecha de nacimiento (o null si no hay fecha). */
export function ageFromBirth(birthDate: Date | null | undefined): number | null {
  if (!birthDate) return null;
  const now = new Date();
  let age = now.getFullYear() - birthDate.getFullYear();
  const m = now.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birthDate.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

// Forma mínima que necesita la lista. Se escribe a mano (no atada a un include
// concreto) para que la LISTA pueda traer solo lo indispensable y el DETALLE pueda
// pasar un objeto más rico: ambos cumplen esta forma (subtipado estructural).
interface PatientListShape {
  id: string; name: string; phone: string; sex: string | null;
  birthDate: Date | null; age: number | null; branchId: string; avatarColor: string; type: string; fromImport?: boolean;
  branch: { name: string };
  clinicalRecord: { status: string; patientFilledAt: Date | null; sentToPatientAt: Date | null; therapistId: string | null } | null;
  treatments: { id: string; name: string; totalSessions: number; doneSessions: number; price: number; balance: number; active: boolean }[];
  appointments: { startsAt: Date; status: string; therapist: { name: string } | null }[];
}

/** Serializa un paciente para la lista (columnas del prototipo). */
export function serializePatient(p: PatientListShape) {
  // Un paciente puede tener VARIOS paquetes/combos comprados y sin consumir a la vez
  // (antes solo se mostraba uno y por eso el control se llevaba en papel).
  const activos = p.treatments.filter((t) => t.active);
  const treatment = activos[0] ?? p.treatments[0] ?? null;
  const packages = activos.map((t) => ({
    id: t.id,
    name: t.name,
    total: t.totalSessions,
    done: t.doneSessions,
    remaining: Math.max(0, t.totalSessions - t.doneSessions),
    pct: t.totalSessions > 0 ? Math.round((t.doneSessions / t.totalSessions) * 100) : 0,
    price: t.price,
    balance: t.balance,
  }));
  const upcoming = p.appointments
    .filter((a) => a.startsAt >= new Date() && a.status !== 'CANCELADA')
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];

  const progPct = treatment && treatment.totalSessions > 0
    ? Math.round((treatment.doneSessions / treatment.totalSessions) * 100)
    : 0;

  // Avance consolidado de TODOS sus paquetes activos (para quien tiene varios).
  const sesionesHechas = packages.reduce((s, x) => s + x.done, 0);
  const sesionesTotales = packages.reduce((s, x) => s + x.total, 0);

  return {
    id: p.id,
    name: p.name,
    phone: p.phone,
    sex: p.sex,
    age: ageFromBirth(p.birthDate) ?? p.age,
    branchId: p.branchId,
    branchName: p.branch.name,
    avatarColor: p.avatarColor,
    // NUEVO solo si fue creado desde cero, sin paquetes y no importado; en cualquier
    // otro caso se muestra RECURRENTE (aunque el tipo guardado aún no se haya sincronizado).
    type: (p.type === 'NUEVO' && !p.fromImport && activos.length === 0) ? 'NUEVO' : 'RECURRENTE',
    fichaStatus: p.clinicalRecord?.status ?? 'PENDIENTE',
    fichaLabel: p.clinicalRecord?.patientFilledAt && p.clinicalRecord.status !== 'COMPLETA'
      ? 'Recibida · validar con esteticista'
      : FICHA_LABEL[p.clinicalRecord?.status ?? 'PENDIENTE'],
    fichaSent: !!p.clinicalRecord?.sentToPatientAt,
    fichaFilled: !!p.clinicalRecord?.patientFilledAt,
    plan: packages.length > 1 ? `${packages.length} paquetes activos` : (treatment?.name ?? 'Sin paquete'),
    // Con varios paquetes el avance es el CONSOLIDADO (suma de todos), no el del
    // primero: mostrar "2/5" cuando además tiene 2/18 de otro plan engaña.
    progLabel: packages.length > 1
      ? `${sesionesHechas}/${sesionesTotales}`
      : treatment ? `${treatment.doneSessions}/${treatment.totalSessions}` : '—',
    progPct: packages.length > 1
      ? (sesionesTotales > 0 ? Math.round((sesionesHechas / sesionesTotales) * 100) : 0)
      : progPct,
    // Saldo total: suma de lo pendiente en TODOS los paquetes activos.
    balance: packages.reduce((s, x) => s + x.balance, 0),
    packages,
    next: upcoming
      ? upcoming.startsAt.toLocaleString('es-DO', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
      : 'No agendada',
    therapist: p.clinicalRecord?.therapistId
      ? (p.appointments.find((a) => a.therapist)?.therapist?.name ?? null)
      : null,
  };
}

export const patientInclude = {
  branch: true,
  clinicalRecord: true,
  treatments: { include: { areas: true, techniques: true, catalogItem: { include: { incluye: { include: { service: true } } } } } },
  appointments: { include: { therapist: true } },
} satisfies Prisma.PatientInclude;

/**
 * Include LIVIANO para la LISTA de pacientes: solo lo que usa serializePatient.
 * Evita traer áreas/técnicas/catalogItem de cada tratamiento y TODAS las citas de
 * cada paciente (la causa principal de la lentitud al abrir Pacientes). Trae los
 * tratamientos activos y las últimas citas (para "próxima cita" y la esteticista).
 */
export const patientListInclude = {
  branch: { select: { name: true } },
  clinicalRecord: { select: { status: true, patientFilledAt: true, sentToPatientAt: true, therapistId: true } },
  treatments: {
    where: { active: true },
    select: { id: true, name: true, totalSessions: true, doneSessions: true, price: true, balance: true, active: true },
  },
  appointments: {
    where: { status: { not: 'CANCELADA' as const } },
    select: { startsAt: true, status: true, therapist: { select: { name: true } } },
    orderBy: { startsAt: 'desc' as const },
    take: 8,
  },
} satisfies Prisma.PatientInclude;

/**
 * Recalcula el tipo del paciente según su ficha:
 * ficha COMPLETA => RECURRENTE; en otro caso => NUEVO.
 */
export async function syncPatientType(patientId: string) {
  // "NUEVO" = cliente creado desde cero, SIN paquetes anteriores y NO cargado de la base
  // anterior. Si tiene ficha completa, o tiene algún tratamiento/paquete, o vino por
  // importación, es RECURRENTE (no es un cliente nuevo).
  const [patient, record, treatmentCount] = await Promise.all([
    prisma.patient.findUnique({ where: { id: patientId }, select: { fromImport: true } }),
    prisma.clinicalRecord.findUnique({ where: { patientId }, select: { status: true } }),
    prisma.treatment.count({ where: { patientId } }),
  ]);
  const esRecurrente = record?.status === 'COMPLETA' || treatmentCount > 0 || !!patient?.fromImport;
  const type = esRecurrente ? 'RECURRENTE' : 'NUEVO';
  await prisma.patient.update({ where: { id: patientId }, data: { type } });
  return type;
}
