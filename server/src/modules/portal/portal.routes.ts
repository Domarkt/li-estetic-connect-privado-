import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requirePatient } from '../../middleware/auth.js';
import { genApptCode } from '../appointments/appointments.service.js';
import { notifyBranchTherapists, notifyRole } from '../notifications/notifications.service.js';
import { sendAppointmentCancelled } from '../mail/mail.service.js';

export const portalRouter = Router();
portalRouter.use(requirePatient);

const CARE_TIPS = 'Toma abundante agua, evita alimentos con sodio y camina 20 min hoy para potenciar tus resultados.';

/** Inicio del día de hoy: las citas de hoy siguen visibles aunque su hora ya pasó. */
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

/** Mi Proceso: tratamiento activo, progreso, próxima cita y tips. */
portalRouter.get('/proceso', async (req, res) => {
  const patientId = req.patient!.patientId;
  const since = new Date(Date.now() - 30 * 24 * 36e5); // últimos 30 días
  const [treatment, nextAppt, cancelledByClinic] = await Promise.all([
    prisma.treatment.findFirst({ where: { patientId, active: true }, orderBy: { createdAt: 'desc' } }),
    prisma.appointment.findFirst({
      where: { patientId, startsAt: { gte: startOfToday() }, status: { not: 'CANCELADA' } },
      include: { therapist: true, branch: true }, orderBy: { startsAt: 'asc' },
    }),
    // Avisos: citas que la CLÍNICA canceló recientemente (el paciente debe enterarse).
    prisma.appointment.findMany({
      where: { patientId, status: 'CANCELADA', cancelledBy: 'STAFF', cancelledAt: { gte: since } },
      orderBy: { cancelledAt: 'desc' }, take: 5,
    }),
  ]);

  res.json({
    notices: cancelledByClinic.map((a) => ({
      id: a.id,
      service: a.serviceName,
      date: a.startsAt.toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
      reason: a.cancelReason ?? '',
    })),
    treatment: treatment ? {
      name: treatment.name, total: treatment.totalSessions, done: treatment.doneSessions,
      pct: treatment.totalSessions ? Math.round((treatment.doneSessions / treatment.totalSessions) * 100) : 0,
    } : null,
    nextAppointment: nextAppt ? {
      date: nextAppt.startsAt.toLocaleDateString('es-DO', { day: '2-digit', month: 'short' }),
      day: nextAppt.startsAt.toLocaleDateString('es-DO', { day: '2-digit' }),
      month: nextAppt.startsAt.toLocaleDateString('es-DO', { month: 'short' }).toUpperCase(),
      time: nextAppt.startsAt.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' }),
      service: nextAppt.serviceName,
      therapist: nextAppt.therapist?.name ?? 'Por asignar',
      branch: nextAppt.branch ? `${nextAppt.branch.name} · ${nextAppt.branch.place}` : '',
      code: nextAppt.code,
      checkedIn: !!nextAppt.codeUsedAt,
    } : null,
    tips: CARE_TIPS,
  });
});

/** Mis citas próximas. */
portalRouter.get('/appointments', async (req, res) => {
  const appts = await prisma.appointment.findMany({
    where: { patientId: req.patient!.patientId, status: { not: 'CANCELADA' }, startsAt: { gte: startOfToday() } },
    include: { therapist: true }, orderBy: { startsAt: 'asc' },
  });
  res.json(appts.map((a) => ({
    id: a.id,
    date: a.startsAt.toLocaleString('es-DO', { weekday: 'long', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
    service: a.serviceName,
    therapist: a.therapist?.name ?? 'Por asignar',
    code: a.code,
    checkedIn: !!a.codeUsedAt,
  })));
});

/** Ficha clínica del paciente (para autocompletar la parte de salud). */
portalRouter.get('/ficha', async (req, res) => {
  const record = await prisma.clinicalRecord.findUnique({ where: { patientId: req.patient!.patientId } });
  res.json({
    status: record?.status ?? 'PENDIENTE',
    sentToPatient: !!record?.sentToPatientAt,
    filled: !!record?.patientFilledAt,
    completed: record?.status === 'COMPLETA',
    ficha: record ? {
      antecedentes: record.antecedentes ?? {},
      ginecoObst: record.ginecoObst ?? {},
      quirurgicos: record.quirurgicos ?? {},
      medicamentos: record.medicamentos ?? {},
      fototipo: record.fototipo ?? '',
      tallaCm: record.tallaCm ?? null,
      pesoLb: record.pesoLb ?? null,
    } : null,
  });
});

const portalFichaSchema = z.object({
  antecedentes: z.record(z.any()).optional(),
  ginecoObst: z.record(z.any()).optional(),
  quirurgicos: z.record(z.any()).optional(),
  medicamentos: z.record(z.any()).optional(),
  fototipo: z.string().optional(),
  tallaCm: z.number().int().optional(),
  pesoLb: z.number().int().optional(),
});

/** El paciente guarda/actualiza su parte clínica. La esteticista la validará y finalizará. */
portalRouter.patch('/ficha', async (req, res) => {
  const b = portalFichaSchema.parse(req.body);
  const record = await prisma.clinicalRecord.findUnique({ where: { patientId: req.patient!.patientId } });
  if (!record) return res.status(404).json({ error: 'Ficha no disponible' });
  if (record.status === 'COMPLETA') return res.status(409).json({ error: 'Tu ficha ya fue validada por la esteticista' });

  await prisma.clinicalRecord.update({
    where: { patientId: req.patient!.patientId },
    data: {
      antecedentes: b.antecedentes ?? record.antecedentes ?? undefined,
      ginecoObst: b.ginecoObst ?? record.ginecoObst ?? undefined,
      quirurgicos: b.quirurgicos ?? record.quirurgicos ?? undefined,
      medicamentos: b.medicamentos ?? record.medicamentos ?? undefined,
      fototipo: b.fototipo ?? record.fototipo ?? undefined,
      tallaCm: b.tallaCm ?? record.tallaCm ?? undefined,
      pesoLb: b.pesoLb ?? record.pesoLb ?? undefined,
      patientFilledAt: new Date(),
    },
  });

  // Aviso a las esteticistas de la sucursal: la ficha está lista para validar.
  const patient = await prisma.patient.findUnique({
    where: { id: req.patient!.patientId },
    select: { name: true, branchId: true },
  });
  if (patient) {
    await notifyBranchTherapists(patient.branchId, {
      type: 'FICHA_FILLED',
      title: 'Ficha lista para validar',
      body: `${patient.name} completó su ficha clínica desde el portal.`,
      link: '/app/pacientes',
    });
  }

  res.json({ ok: true, message: 'Ficha enviada a tu esteticista para validarla. ¡Gracias!' });
});

/** Perfil del paciente: datos básicos + baseline de la primera evaluación + progreso. */
portalRouter.get('/profile', async (req, res) => {
  const patient = await prisma.patient.findUnique({
    where: { id: req.patient!.patientId },
    include: { clinicalRecord: true, branch: true, treatments: { where: { active: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  if (!patient) return res.status(404).json({ error: 'Paciente no encontrado' });
  const cr = patient.clinicalRecord;
  const t = patient.treatments[0] ?? null;
  const parts = patient.name.trim().split(' ');
  res.json({
    firstName: parts[0] ?? patient.name,
    lastName: parts.slice(1).join(' '),
    phone: patient.phone,
    branch: patient.branch ? `${patient.branch.name} · ${patient.branch.place}` : null,
    since: patient.createdAt.toLocaleDateString('es-DO', { day: '2-digit', month: 'long', year: 'numeric' }),
    firstEval: cr?.completedAt ? cr.completedAt.toLocaleDateString('es-DO', { day: '2-digit', month: 'long', year: 'numeric' }) : null,
    baseline: {
      tallaCm: cr?.tallaCm ?? null,
      pesoLb: cr?.pesoLb ?? null,
      fototipo: cr?.fototipo ?? null,
      motivos: cr?.motivos ?? [],
    },
    treatment: t ? { name: t.name, total: t.totalSessions, done: t.doneSessions, pct: t.totalSessions ? Math.round((t.doneSessions / t.totalSessions) * 100) : 0 } : null,
  });
});

/** Historial de citas atendidas (para calificar). */
portalRouter.get('/history', async (req, res) => {
  const appts = await prisma.appointment.findMany({
    where: {
      patientId: req.patient!.patientId, status: { not: 'CANCELADA' },
      // Ya atendida: turno cerrado por la esteticista, o su fecha ya pasó.
      OR: [{ serviceEndedAt: { not: null } }, { startsAt: { lt: new Date() } }],
    },
    include: { therapist: true }, orderBy: { startsAt: 'desc' }, take: 20,
  });
  res.json(appts.map((a) => ({
    id: a.id,
    date: a.startsAt.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' }),
    service: a.serviceName,
    therapist: a.therapist?.name ?? 'Li Estetic',
    rating: a.rating,
    ratingComment: a.ratingComment,
    durationMin: a.serviceDurationSec != null ? Math.round(a.serviceDurationSec / 60) : null,
  })));
});

const rateSchema = z.object({ stars: z.number().int().min(1).max(5), comment: z.string().optional() });

/** Calificar una cita recibida (si es < 5 estrellas, el comentario es obligatorio). */
portalRouter.post('/appointments/:id/rate', async (req, res) => {
  const { stars, comment } = rateSchema.parse(req.body);
  if (stars < 5 && !comment?.trim()) return res.status(400).json({ error: 'Cuéntanos qué ocurrió (comentario requerido para menos de 5 estrellas)' });
  const appt = await prisma.appointment.findUnique({ where: { id: req.params.id } });
  if (!appt || appt.patientId !== req.patient!.patientId) return res.status(404).json({ error: 'Cita no encontrada' });
  await prisma.appointment.update({ where: { id: appt.id }, data: { rating: stars, ratingComment: stars < 5 ? (comment ?? null) : null } });
  res.json({ ok: true, message: stars === 5 ? '¡Gracias por tu calificación! ⭐' : 'Gracias, tu comentario ayuda a mejorar' });
});

/** Sucursales con su WhatsApp para solicitar cita (evita agendar directo desde el portal). */
portalRouter.get('/branches', async (_req, res) => {
  const branches = await prisma.branch.findMany({ orderBy: { code: 'asc' } });
  res.json(branches.map((b) => {
    const digits = (b.phone || '').replace(/\D/g, '');
    const wa = digits.length === 10 ? '1' + digits : digits; // RD → +1
    return { id: b.id, name: b.name, place: b.place, phone: b.phone, waNumber: wa };
  }));
});

const bookSchema = z.object({ serviceName: z.string().min(1), date: z.string(), time: z.string() });

/** Solicitar/agendar cita desde el portal (queda SIN_CONFIRMAR para que recepción confirme). */
portalRouter.post('/appointments', async (req, res) => {
  const b = bookSchema.parse(req.body);
  const patient = await prisma.patient.findUnique({ where: { id: req.patient!.patientId } });
  if (!patient) return res.status(404).json({ error: 'Paciente no encontrado' });

  const created = await prisma.appointment.create({
    data: {
      branchId: patient.branchId, patientId: patient.id, serviceName: b.serviceName, code: genApptCode(),
      startsAt: new Date(`${b.date}T${b.time}:00`), patientType: patient.type, status: 'SIN_CONFIRMAR',
    },
  });
  res.status(201).json({ ok: true, code: created.code, message: `Solicitud enviada · tu código de turno es ${created.code}` });
});

const rescheduleSchema = z.object({ date: z.string(), time: z.string() });

/** Reagendar una cita propia. */
portalRouter.patch('/appointments/:id', async (req, res) => {
  const b = rescheduleSchema.parse(req.body);
  const appt = await prisma.appointment.findUnique({ where: { id: req.params.id } });
  if (!appt || appt.patientId !== req.patient!.patientId) return res.status(404).json({ error: 'Cita no encontrada' });
  await prisma.appointment.update({
    where: { id: appt.id },
    data: { startsAt: new Date(`${b.date}T${b.time}:00`), status: 'REAGENDADA' },
  });
  res.json({ ok: true, message: 'Cita reagendada · pendiente de confirmar' });
});

const portalCancelSchema = z.object({ reason: z.string().trim().min(3, 'Escribe el motivo de la cancelación') });

/**
 * Cancelar una cita propia con motivo obligatorio. Avisa al sistema (notificación
 * a recepción/admin de la sucursal) y envía un correo de aviso a la sucursal.
 * Política: recordatorio de 24h y límite de 5 cancelaciones.
 */
portalRouter.post('/appointments/:id/cancel', async (req, res) => {
  const { reason } = portalCancelSchema.parse(req.body);
  const appt = await prisma.appointment.findUnique({ where: { id: req.params.id }, include: { branch: true, patient: true } });
  if (!appt || appt.patientId !== req.patient!.patientId) return res.status(404).json({ error: 'Cita no encontrada' });
  if (appt.status === 'CANCELADA') return res.status(409).json({ error: 'La cita ya está cancelada' });

  const hoursToAppt = (appt.startsAt.getTime() - Date.now()) / 36e5;
  await prisma.appointment.update({
    where: { id: appt.id },
    data: { status: 'CANCELADA', cancelReason: reason, cancelledBy: 'PATIENT', cancelledAt: new Date() },
  });

  const fecha = appt.startsAt.toLocaleDateString('es-DO', { day: '2-digit', month: 'long', year: 'numeric' });
  const hora = appt.startsAt.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });

  // Aviso al sistema: notificación a recepción y admin de la sucursal.
  await notifyRole('RECEPCIONISTA', {
    type: 'APPOINTMENT_CANCELLED', title: 'Cita cancelada por el paciente',
    body: `${appt.patient.name} canceló · ${appt.serviceName} · ${fecha} ${hora}. Motivo: ${reason}`,
    link: '/app/agenda',
  }, appt.branchId);
  await notifyRole('ADMIN', {
    type: 'APPOINTMENT_CANCELLED', title: 'Cita cancelada por el paciente',
    body: `${appt.patient.name} (${appt.branch.name}) · ${appt.serviceName} · ${fecha} ${hora}. Motivo: ${reason}`,
    link: '/app/agenda',
  });

  // Correo de aviso a la sucursal (si tiene correo configurado).
  if (appt.branch.email) {
    await sendAppointmentCancelled(appt.branch.email, {
      name: appt.patient.name, service: appt.serviceName, date: fecha, time: hora,
      reason, by: 'patient', branchName: appt.branch.name,
    });
  }

  const cancelled = await prisma.appointment.count({ where: { patientId: req.patient!.patientId, status: 'CANCELADA' } });
  const warn = hoursToAppt < 24 ? ' (menos de 24h de anticipación)' : '';
  res.json({
    ok: true,
    cancelledCount: cancelled,
    message: cancelled >= 5
      ? 'Cita cancelada. Has alcanzado 5 cancelaciones — contacta a recepción sobre tu tratamiento.'
      : `Cita cancelada${warn}. Cancelaciones: ${cancelled}/5.`,
  });
});

/** Paquetes: activo + tienda de nuevos paquetes. */
portalRouter.get('/packages', async (req, res) => {
  const [treatment, shop] = await Promise.all([
    prisma.treatment.findFirst({ where: { patientId: req.patient!.patientId, active: true }, orderBy: { createdAt: 'desc' } }),
    prisma.catalogItem.findMany({ where: { active: true, kind: { in: ['PAQUETE', 'COMBO'] } }, orderBy: { price: 'asc' } }),
  ]);
  res.json({
    active: treatment ? {
      name: treatment.name, total: treatment.totalSessions, done: treatment.doneSessions,
      remaining: treatment.totalSessions - treatment.doneSessions,
      pct: treatment.totalSessions ? Math.round((treatment.doneSessions / treatment.totalSessions) * 100) : 0,
      expiresAt: treatment.expiresAt ? treatment.expiresAt.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' }) : null,
    } : null,
    shop: shop.map((p) => ({ id: p.id, name: p.name, sessions: p.sessions, price: p.price })),
  });
});

const purchaseSchema = z.object({ catalogItemId: z.string() });

/** Solicitar compra de un paquete (recepción la gestiona). */
portalRouter.post('/purchase', async (req, res) => {
  const { catalogItemId } = purchaseSchema.parse(req.body);
  const account = await prisma.patientAccount.findUnique({ where: { id: req.patient!.sub } });
  const item = await prisma.catalogItem.findUnique({ where: { id: catalogItemId } });
  if (!account || !item) return res.status(404).json({ error: 'No encontrado' });

  await prisma.purchaseRequest.create({ data: { patientAccountId: account.id, catalogItemId: item.id, itemName: item.name } });
  res.status(201).json({ ok: true, message: `Solicitud enviada · recepción gestionará tu compra de ${item.name}` });
});
