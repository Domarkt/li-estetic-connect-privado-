import { prisma } from '../../db/prisma.js';
import type { Prisma } from '@prisma/client';

const FICHA_LABEL: Record<string, string> = {
  PENDIENTE: 'Pendiente',
  PASO1_OK: 'En proceso (esteticista)',
  COMPLETA: 'Completa',
};

/** Serializa un paciente para la lista (columnas del prototipo). */
export function serializePatient(
  p: Prisma.PatientGetPayload<{
    include: {
      branch: true;
      clinicalRecord: true;
      treatments: true;
      appointments: { include: { therapist: true } };
    };
  }>,
) {
  const treatment = p.treatments.find((t) => t.active) ?? p.treatments[0] ?? null;
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
    age: p.age,
    branchId: p.branchId,
    branchName: p.branch.name,
    avatarColor: p.avatarColor,
    type: p.type, // NUEVO | RECURRENTE
    fichaStatus: p.clinicalRecord?.status ?? 'PENDIENTE',
    fichaLabel: FICHA_LABEL[p.clinicalRecord?.status ?? 'PENDIENTE'],
    plan: treatment?.name ?? 'Sin paquete',
    progLabel: treatment ? `${treatment.doneSessions}/${treatment.totalSessions}` : '—',
    progPct,
    balance: treatment?.balance ?? 0,
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
  treatments: true,
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
