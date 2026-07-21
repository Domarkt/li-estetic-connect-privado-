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

/** Serializa un paciente para la lista (columnas del prototipo). */
export function serializePatient(
  p: Prisma.PatientGetPayload<{
    include: {
      branch: true;
      clinicalRecord: true;
      treatments: { include: { areas: true } };
      appointments: { include: { therapist: true } };
    };
  }>,
) {
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

  return {
    id: p.id,
    name: p.name,
    phone: p.phone,
    sex: p.sex,
    age: ageFromBirth(p.birthDate) ?? p.age,
    branchId: p.branchId,
    branchName: p.branch.name,
    avatarColor: p.avatarColor,
    type: p.type, // NUEVO | RECURRENTE
    fichaStatus: p.clinicalRecord?.status ?? 'PENDIENTE',
    fichaLabel: p.clinicalRecord?.patientFilledAt && p.clinicalRecord.status !== 'COMPLETA'
      ? 'Recibida · validar con esteticista'
      : FICHA_LABEL[p.clinicalRecord?.status ?? 'PENDIENTE'],
    fichaSent: !!p.clinicalRecord?.sentToPatientAt,
    fichaFilled: !!p.clinicalRecord?.patientFilledAt,
    plan: packages.length > 1 ? `${packages.length} paquetes activos` : (treatment?.name ?? 'Sin paquete'),
    progLabel: treatment ? `${treatment.doneSessions}/${treatment.totalSessions}` : '—',
    progPct,
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
  treatments: { include: { areas: true } },
  appointments: { include: { therapist: true } },
} satisfies Prisma.PatientInclude;

/**
 * Recalcula el tipo del paciente según su ficha:
 * ficha COMPLETA => RECURRENTE; en otro caso => NUEVO.
 */
export async function syncPatientType(patientId: string) {
  const record = await prisma.clinicalRecord.findUnique({ where: { patientId } });
  const type = record?.status === 'COMPLETA' ? 'RECURRENTE' : 'NUEVO';
  await prisma.patient.update({ where: { id: patientId }, data: { type } });
  return type;
}
