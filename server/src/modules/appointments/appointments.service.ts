import type { Prisma, AppointmentStatus } from '@prisma/client';

const STATUS_META: Record<AppointmentStatus, { label: string; color: string }> = {
  SIN_CONFIRMAR: { label: 'Sin confirmar', color: '#C9880E' },
  CONFIRMADA: { label: 'Confirmada', color: '#1F9D6B' },
  COMPLETADA: { label: 'Completada', color: '#6A7089' },
  CANCELADA: { label: 'Cancelada', color: '#C0392B' },
  REAGENDADA: { label: 'Reagendada', color: '#2C7FB8' },
};

export const apptInclude = {
  patient: { include: { clinicalRecord: true, treatments: true } },
  therapist: true,
  branch: true,
} satisfies Prisma.AppointmentInclude;

export function serializeAppt(
  a: Prisma.AppointmentGetPayload<{ include: typeof apptInclude }>,
) {
  const meta = STATUS_META[a.status];
  const fichaComplete = a.patient.clinicalRecord?.status === 'COMPLETA';
  // La etiqueta Nuevo/Recurrente refleja el estado ACTUAL del paciente (regla del
  // handoff: es "Nuevo" mientras su ficha esté pendiente; al completarla pasa a
  // Recurrente). No usamos el snapshot guardado en la cita para que la agenda se
  // actualice en vivo cuando la esteticista termina la ficha.
  const liveType = a.patient.type; // NUEVO | RECURRENTE
  const activeTreatment = a.patient.treatments.find((t) => t.active) ?? a.patient.treatments[0] ?? null;
  const balance = activeTreatment?.balance ?? 0;
  return {
    id: a.id,
    time: a.startsAt.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' }),
    startsAt: a.startsAt.toISOString(),
    patientId: a.patientId,
    patient: a.patient.name,
    patientType: liveType,
    service: a.serviceName,
    therapist: a.therapist?.name ?? 'Sin asignar',
    branchId: a.branchId,
    branchName: a.branch.name,
    status: a.status,
    statusLabel: meta.label,
    statusColor: meta.color,
    barColor: liveType === 'NUEVO' ? '#B31C86' : meta.color,
    reminderSent: !!a.reminderSentAt,
    googleSynced: !!a.googleEventId,
    // La esteticista abre la ficha; si es cliente nuevo aún sin ficha completa, "llenar ficha"
    fichaComplete,
    // Saldo pendiente: si > 0, el paciente debe pagar antes de ser atendido.
    balance,
  };
}

/** Rango [inicio, fin) de un día local a partir de un string YYYY-MM-DD (o hoy). */
export function dayRange(dateStr?: string) {
  const base = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}
