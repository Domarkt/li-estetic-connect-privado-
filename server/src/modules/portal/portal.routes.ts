import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requirePatient } from '../../middleware/auth.js';
import { genApptCode } from '../appointments/appointments.service.js';
import { ageFromBirth } from '../patients/patients.service.js';
import { awardFiveStar } from '../points/points.automation.js';
import { notifyBranchTherapists, notifyRole } from '../notifications/notifications.service.js';
import { sendAppointmentCancelled, sendRatingFeedback, sendGenericAlert } from '../mail/mail.service.js';
import { decryptJson, encryptJson } from '../../utils/crypto.js';
import { upsertLead } from '../messaging/leads.service.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';

export const portalRouter = Router();
portalRouter.use(requirePatient);

/**
 * Consejos post-tratamiento. Antes había uno solo y el paciente veía siempre el
 * mismo mensaje, que dejaba de leerse. Se rota por día y por paciente, así cada
 * visita al portal aporta algo distinto.
 */
const CARE_TIPS = [
  { icon: '💧', title: 'Hidrátate bien', body: 'Toma al menos 8 vasos de agua hoy: ayuda a tu cuerpo a eliminar lo que movilizamos en la sesión.' },
  { icon: '🧂', title: 'Cuida el sodio', body: 'Evita los alimentos muy salados y los embutidos por 24 horas. El sodio retiene líquido y frena tus resultados.' },
  { icon: '🚶‍♀️', title: 'Muévete un poco', body: 'Una caminata de 20 a 30 minutos potencia el efecto del tratamiento. No hace falta ir al gimnasio.' },
  { icon: '🥗', title: 'Come ligero hoy', body: 'Prioriza proteína magra, frutas y vegetales. Tu cuerpo aprovecha mejor la sesión cuando no está pesado.' },
  { icon: '😴', title: 'Descansa', body: 'Dormir de 7 a 8 horas es parte del tratamiento: es cuando tu piel y tus tejidos se reparan.' },
  { icon: '☀️', title: 'Protégete del sol', body: 'Usa protector solar en las zonas tratadas. La exposición directa puede manchar la piel sensibilizada.' },
  { icon: '🧴', title: 'Humecta la zona', body: 'Aplica crema humectante en las áreas trabajadas. La piel bien hidratada responde mejor a la próxima sesión.' },
  { icon: '🚭', title: 'Evita alcohol y cigarrillo', body: 'Ambos reducen la oxigenación de los tejidos y hacen que veas resultados más lento.' },
  { icon: '📅', title: 'Sé constante', body: 'Los resultados se construyen con la continuidad. No dejes pasar mucho tiempo entre una sesión y otra.' },
  { icon: '👗', title: 'Ropa cómoda', body: 'Usa prendas holgadas el resto del día para no comprimir las zonas trabajadas.' },
];

/** Elige el consejo del día: cambia cada día y no es igual para todas las pacientes. */
function tipDelDia(patientId: string) {
  const dia = Math.floor(Date.now() / 86_400_000);
  const semilla = patientId.split('').reduce((s, c) => s + c.charCodeAt(0), 0);
  return CARE_TIPS[(dia + semilla) % CARE_TIPS.length];
}

/** Inicio del día de hoy: las citas de hoy siguen visibles aunque su hora ya pasó. */
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

/** Mi Proceso: tratamiento activo, progreso, próxima cita y tips. */
portalRouter.get('/proceso', async (req, res) => {
  const patientId = req.patient!.patientId;
  const since = new Date(Date.now() - 30 * 24 * 36e5); // últimos 30 días
  const [treatment, nextAppt, cancelledByClinic] = await Promise.all([
    prisma.treatment.findFirst({ where: { patientId, active: true }, orderBy: { createdAt: 'desc' } }),
    prisma.appointment.findFirst({
      // Próxima cita = pendiente de atender (no cancelada, no completada, turno no cerrado).
      where: { patientId, startsAt: { gte: startOfToday() }, status: { notIn: ['CANCELADA', 'COMPLETADA'] }, serviceEndedAt: null },
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
      // "Abierto" solo mientras el turno sigue abierto (no si ya se cerró).
      checkedIn: !!nextAppt.codeUsedAt && !nextAppt.serviceEndedAt,
    } : null,
    tips: tipDelDia(patientId),
    // Mensajes y ofertas que la dirección publicó para las pacientes.
    mensajes: await mensajesVigentes(patientId),
  });
});

/**
 * Mensajes/ofertas vigentes para este paciente: activos, dentro de fechas y de su
 * sucursal (o de todas). Best-effort: un fallo aquí no puede tumbar el portal.
 */
async function mensajesVigentes(patientId: string) {
  try {
    const p = await prisma.patient.findUnique({ where: { id: patientId }, select: { branchId: true } });
    const ahora = new Date();
    const rows = await prisma.portalMessage.findMany({
      where: {
        active: true,
        OR: [{ branchId: null }, { branchId: p?.branchId ?? undefined }],
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: ahora } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: ahora } }] },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    return rows.map((m) => ({
      id: m.id, kind: m.kind, title: m.title, body: m.body,
      ctaLabel: m.ctaLabel, ctaLink: m.ctaLink,
    }));
  } catch {
    return [];
  }
}

const cambioClaveSchema = z.object({
  actual: z.string().min(1, 'Escribe tu contraseña actual'),
  nueva: z.string().min(6, 'La nueva contraseña debe tener al menos 6 caracteres').max(100),
});

/**
 * Cambiar la contraseña del portal. La inicial es el teléfono del paciente, que
 * cualquiera cercano puede conocer; aquí puede poner una propia.
 * Se exige la actual para que nadie la cambie desde una sesión abierta ajena.
 */
portalRouter.post('/change-password', async (req, res) => {
  const b = cambioClaveSchema.parse(req.body);
  const cuenta = await prisma.patientAccount.findUnique({
    where: { id: req.patient!.sub },
    include: { patient: true },
  });
  if (!cuenta) return res.status(404).json({ error: 'Cuenta no encontrada' });

  if (!(await verifyPassword(b.actual, cuenta.passwordHash))) {
    return res.status(401).json({ error: 'Tu contraseña actual no es correcta' });
  }
  const telefono = (cuenta.patient.phone || '').replace(/\D/g, '');
  if (b.nueva.replace(/\D/g, '') === telefono && telefono.length > 0) {
    return res.status(400).json({ error: 'Elige una contraseña distinta a tu número de teléfono' });
  }
  if (b.nueva === b.actual) {
    return res.status(400).json({ error: 'La nueva contraseña debe ser distinta a la actual' });
  }

  await prisma.patientAccount.update({
    where: { id: cuenta.id },
    data: { passwordHash: await hashPassword(b.nueva) },
  });
  res.json({ ok: true, message: 'Contraseña actualizada. Úsala la próxima vez que entres.' });
});

/** Mis citas próximas. */
portalRouter.get('/appointments', async (req, res) => {
  const appts = await prisma.appointment.findMany({
    // Próximas = pendientes de atender (no canceladas, no completadas, turno no cerrado).
    where: { patientId: req.patient!.patientId, status: { notIn: ['CANCELADA', 'COMPLETADA'] }, serviceEndedAt: null, startsAt: { gte: startOfToday() } },
    include: { therapist: true }, orderBy: { startsAt: 'asc' },
  });
  res.json(appts.map((a) => ({
    id: a.id,
    date: a.startsAt.toLocaleString('es-DO', { weekday: 'long', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
    service: a.serviceName,
    therapist: a.therapist?.name ?? 'Por asignar',
    code: a.code,
    checkedIn: !!a.codeUsedAt && !a.serviceEndedAt,
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
      antecedentes: decryptJson(record.antecedentes) ?? {},
      ginecoObst: decryptJson(record.ginecoObst) ?? {},
      quirurgicos: decryptJson(record.quirurgicos) ?? {},
      medicamentos: decryptJson(record.medicamentos) ?? {},
      fototipo: record.fototipo ?? '',
      tallaCm: record.tallaCm ?? null,
      pesoLb: record.pesoLb ?? null,
      alturaCm: record.alturaCm ?? null,
      cinturaCm: record.cinturaCm ?? null,
      abdomenCm: record.abdomenCm ?? null,
      piernaCm: record.piernaCm ?? null,
      brazoCm: record.brazoCm ?? null,
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
  alturaCm: z.number().int().optional(),
  cinturaCm: z.number().int().optional(),
  abdomenCm: z.number().int().optional(),
  piernaCm: z.number().int().optional(),
  brazoCm: z.number().int().optional(),
});

/** El paciente guarda/actualiza su parte clínica. La esteticista la validará y finalizará. */
portalRouter.patch('/ficha', async (req, res) => {
  const b = portalFichaSchema.parse(req.body);
  const record = await prisma.clinicalRecord.findUnique({ where: { patientId: req.patient!.patientId } });
  if (!record) return res.status(404).json({ error: 'Ficha no disponible' });
  if (record.status === 'COMPLETA') return res.status(409).json({ error: 'Tu ficha ya fue validada por la esteticista' });

  // Solo se re-cifra y actualiza lo que el paciente envía; lo no enviado queda
  // intacto (Prisma no toca los campos ausentes). Los campos de salud se cifran.
  const data: Record<string, unknown> = { patientFilledAt: new Date() };
  if (b.antecedentes !== undefined) data.antecedentes = encryptJson(b.antecedentes) ?? undefined;
  if (b.ginecoObst !== undefined) data.ginecoObst = encryptJson(b.ginecoObst) ?? undefined;
  if (b.quirurgicos !== undefined) data.quirurgicos = encryptJson(b.quirurgicos) ?? undefined;
  if (b.medicamentos !== undefined) data.medicamentos = encryptJson(b.medicamentos) ?? undefined;
  if (b.fototipo !== undefined) data.fototipo = b.fototipo;
  for (const k of ['tallaCm', 'pesoLb', 'alturaCm', 'cinturaCm', 'abdomenCm', 'piernaCm', 'brazoCm'] as const) {
    if (b[k] !== undefined) data[k] = b[k];
  }
  await prisma.clinicalRecord.update({ where: { patientId: req.patient!.patientId }, data });

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
    // La edad se calcula de la fecha de nacimiento (automática); si no hay, usa la guardada.
    age: ageFromBirth(patient.birthDate) ?? patient.age ?? null,
    baseline: {
      tallaCm: cr?.tallaCm ?? null,
      pesoLb: cr?.pesoLb ?? null,
      fototipo: cr?.fototipo ?? null,
      alturaCm: cr?.alturaCm ?? null,
      cinturaCm: cr?.cinturaCm ?? null,
      abdomenCm: cr?.abdomenCm ?? null,
      piernaCm: cr?.piernaCm ?? null,
      brazoCm: cr?.brazoCm ?? null,
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

/** Calificar una cita recibida. El comentario es opcional (obligatorio si es < 5 estrellas).
 * La calificación + comentario se envían por correo a la sucursal y se notifica al sistema. */
portalRouter.post('/appointments/:id/rate', async (req, res) => {
  const { stars, comment } = rateSchema.parse(req.body);
  if (stars < 5 && !comment?.trim()) return res.status(400).json({ error: 'Cuéntanos qué ocurrió (comentario requerido para menos de 5 estrellas)' });
  const appt = await prisma.appointment.findUnique({ where: { id: req.params.id }, include: { branch: true, patient: true } });
  if (!appt || appt.patientId !== req.patient!.patientId) return res.status(404).json({ error: 'Cita no encontrada' });

  const cleanComment = comment?.trim() || null;
  // El comentario se guarda siempre que exista (no solo con < 5 estrellas).
  await prisma.appointment.update({ where: { id: appt.id }, data: { rating: stars, ratingComment: cleanComment } });

  // Reseña 5★ → puntos automáticos a la esteticista que atendió (una sola vez).
  if (stars === 5 && appt.rating !== 5) await awardFiveStar(appt.therapistId);

  const fecha = appt.startsAt.toLocaleDateString('es-DO', { day: '2-digit', month: 'long', year: 'numeric' });
  // Correo de feedback a la sucursal + aviso al sistema.
  if (appt.branch.email) {
    await sendRatingFeedback(appt.branch.email, {
      name: appt.patient.name, service: appt.serviceName, date: fecha,
      stars, comment: cleanComment ?? undefined, branchName: appt.branch.name,
    });
  }
  await notifyRole('RECEPCIONISTA', {
    type: 'GENERAL', title: `Calificación ${stars}/5`,
    body: `${appt.patient.name} · ${appt.serviceName}${cleanComment ? ` · "${cleanComment}"` : ''}`,
    link: '/app/pacientes',
  }, appt.branchId);

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
  // Seguimiento automático: la solicitud del portal entra al tablero para que recepción la contacte.
  await upsertLead({ branchId: patient.branchId, patientId: patient.id, name: patient.name, stage: 'NUEVO_MENSAJE', summary: `Solicitó cita: ${b.serviceName}` });

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
      reason, by: 'patient', sex: appt.patient.sex, branchName: appt.branch.name,
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
    // Solo con precio: al paciente no se le puede ofrecer "RD$0". Los combos que la
    // directora arma al momento (sin precio fijo) se venden en recepción, no aquí.
    prisma.catalogItem.findMany({
      where: { active: true, showInPortal: true, price: { gt: 0 }, kind: { in: ['PAQUETE', 'COMBO'] } },
      orderBy: { price: 'asc' },
    }),
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

/** Solicitar compra de un paquete/servicio. Avisa a recepción (notificación + correo) para facturar. */
portalRouter.post('/purchase', async (req, res) => {
  const { catalogItemId } = purchaseSchema.parse(req.body);
  const account = await prisma.patientAccount.findUnique({ where: { id: req.patient!.sub } });
  const item = await prisma.catalogItem.findUnique({ where: { id: catalogItemId } });
  if (!account || !item) return res.status(404).json({ error: 'No encontrado' });

  await prisma.purchaseRequest.create({ data: { patientAccountId: account.id, catalogItemId: item.id, itemName: item.name } });

  // La estética debe recibir la alerta para facturar y contactar al cliente.
  const patient = await prisma.patient.findUnique({ where: { id: req.patient!.patientId }, include: { branch: true } });

  // Deja un cargo pendiente para que recepción lo facture directo (con abono disponible).
  if (patient) {
    await prisma.chargeItem.create({
      data: { branchId: patient.branchId, patientId: patient.id, catalogItemId: item.id, name: item.name, price: item.price },
    });
  }
  if (patient) {
    const precio = item.price ? ` · RD$${item.price.toLocaleString('en-US')}` : '';
    await notifyRole('RECEPCIONISTA', {
      type: 'GENERAL', title: 'Solicitud de compra (portal)',
      body: `${patient.name} quiere comprar: ${item.name}${precio}. Contáctalo para facturar.`,
      link: '/app/facturacion',
    }, patient.branchId);
    await notifyRole('ADMIN', {
      type: 'GENERAL', title: 'Solicitud de compra (portal)',
      body: `${patient.name} (${patient.branch.name}) · ${item.name}${precio}.`,
      link: '/app/facturacion',
    });
    if (patient.branch.email) {
      const tel = patient.phone ? ` · Tel: ${patient.phone}` : '';
      await sendGenericAlert(patient.branch.email, {
        subject: `Solicitud de compra · ${patient.name}`,
        heading: 'Nueva solicitud de compra desde el portal',
        lines: [`Paciente: ${patient.name}${tel}`, `Producto/paquete: ${item.name}${precio}`, `Sucursal: ${patient.branch.name}`, 'Contacta al cliente para completar la compra y facturar.'],
        replyTo: patient.branch.email,
      });
    }
  }

  res.status(201).json({ ok: true, message: `Solicitud enviada · recepción gestionará tu compra de ${item.name}` });
});
