import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireStaff, requireRole, branchScope, assertBranchAccess } from '../../middleware/auth.js';
import { serializeAppt, apptInclude, dayRange, genApptCode } from './appointments.service.js';
import { pushEvent } from '../calendar/calendar.service.js';
import { sendWhatsAppText, normalizePhone } from '../messaging/whatsapp.service.js';
import { notify, notifyBranchTherapists } from '../notifications/notifications.service.js';
import { sendAppointmentConfirmation, sendAppointmentCancelled } from '../mail/mail.service.js';
import { notifyRole } from '../notifications/notifications.service.js';
import { encryptPatientWrite } from '../patients/patients.crypto.js';
import { upsertLead } from '../messaging/leads.service.js';
import { getAreaLabelMap } from '../patients/areas.service.js';

export const appointmentsRouter = Router();

/** Agenda del día (aislada por sucursal) + contadores. */
appointmentsRouter.get('/', requireStaff, branchScope, async (req, res) => {
  const { start, end } = dayRange(req.query.date as string | undefined);
  const where = {
    startsAt: { gte: start, lt: end },
    ...(req.scopeBranchId ? { branchId: req.scopeBranchId } : {}),
    // La esteticista solo ve SUS citas asignadas
    ...(req.staff!.role === 'ESTETICISTA' ? { therapistId: req.staff!.sub } : {}),
  };
  const appts = await prisma.appointment.findMany({ where, include: apptInclude, orderBy: { startsAt: 'asc' } });
  // La duración del servicio solo la ve el administrador (no la esteticista).
  const includeDuration = req.staff!.role === 'ADMIN';
  const rows = appts.map((a) => serializeAppt(a, { includeDuration }));
  res.json({
    appointments: rows,
    counters: {
      total: rows.length,
      confirmed: rows.filter((a) => a.status === 'CONFIRMADA').length,
      pending: rows.filter((a) => a.status === 'SIN_CONFIRMAR').length,
    },
  });
});

/** Resumen mensual para la vista de calendario (citas por día). */
appointmentsRouter.get('/calendar', requireStaff, branchScope, async (req, res) => {
  const monthStr = (req.query.month as string | undefined) ?? new Date().toISOString().slice(0, 7); // YYYY-MM
  const [y, m] = monthStr.split('-').map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 1);

  const where = {
    startsAt: { gte: start, lt: end },
    ...(req.scopeBranchId ? { branchId: req.scopeBranchId } : {}),
    ...(req.staff!.role === 'ESTETICISTA' ? { therapistId: req.staff!.sub } : {}),
  };
  const appts = await prisma.appointment.findMany({
    where, include: apptInclude, orderBy: { startsAt: 'asc' },
  });

  const days: Record<string, { count: number; confirmed: number; pending: number; items: { time: string; patient: string; service: string; status: string }[] }> = {};
  for (const a of appts) {
    const key = a.startsAt.toISOString().slice(0, 10);
    if (!days[key]) days[key] = { count: 0, confirmed: 0, pending: 0, items: [] };
    days[key].count++;
    if (a.status === 'CONFIRMADA') days[key].confirmed++;
    if (a.status === 'SIN_CONFIRMAR') days[key].pending++;
    days[key].items.push({
      time: a.startsAt.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' }),
      patient: a.patient.name, service: a.serviceName, status: a.status,
    });
  }
  res.json({ month: monthStr, days });
});

const createSchema = z.object({
  // Puede venir un paciente existente O los datos de uno nuevo (cliente nuevo).
  patientId: z.string().nullish(),
  newPatient: z.object({
    name: z.string().min(1),
    phone: z.string().min(1),
    sex: z.enum(['M', 'F']).optional(),
    email: z.string().email().optional().or(z.literal('')),
    birthDate: z.string().optional(),
    address: z.string().optional(),
  }).nullish(),
  patientType: z.enum(['NUEVO', 'RECURRENTE']).default('RECURRENTE'),
  serviceName: z.string().min(1),
  catalogItemId: z.string().nullish(),
  isFollowUp: z.boolean().optional(), // "Seguimiento": continúa tratamiento, sin cargar servicio
  treatmentId: z.string().nullish(), // paquete/combo cuya sesión consume esta cita
  date: z.string(), // YYYY-MM-DD
  time: z.string(), // HH:MM
  therapistId: z.string().nullish(),
  durationMin: z.number().int().positive().default(60),
  branchId: z.string().nullish(), // solo admin, para elegir sucursal del paciente nuevo
});

const AVATAR_COLORS = ['#B31C86', '#8E1268', '#2C7FB8', '#1F9D6B', '#245E85', '#C9880E'];

/** Agendar cita (Recepción / Esteticista / Admin). Confirma y sincroniza a Google Calendar. */
appointmentsRouter.post('/', requireStaff, requireRole('ADMIN', 'RECEPCIONISTA', 'ESTETICISTA'), async (req, res) => {
  const b = createSchema.parse(req.body);

  let patient;
  if (b.newPatient) {
    // Cliente nuevo: se crea el paciente (NUEVO, ficha PENDIENTE) en la sucursal correspondiente.
    const branchId = req.staff!.role === 'ADMIN' ? b.branchId : req.staff!.branchId;
    if (!branchId) return res.status(400).json({ error: 'Sucursal requerida para el paciente nuevo' });
    if (!assertBranchAccess(req, branchId)) return res.status(403).json({ error: 'Sucursal no permitida' });
    const np = b.newPatient;
    const hasStep1 = !!(np.email || np.birthDate || np.address);
    patient = await prisma.patient.create({
      data: {
        branchId, name: np.name, phone: np.phone, type: 'NUEVO',
        sex: np.sex ?? null,
        email: np.email ? np.email : null,
        birthDate: np.birthDate ? new Date(np.birthDate) : null,
        ...encryptPatientWrite({ address: np.address ?? null }),
        avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
        // Si recepción ya capturó datos del Paso 1, la ficha queda lista para la parte clínica.
        clinicalRecord: { create: { status: hasStep1 ? 'PASO1_OK' : 'PENDIENTE', consultDate: new Date() } },
      },
    });
  } else {
    if (!b.patientId) return res.status(400).json({ error: 'Selecciona un paciente o crea uno nuevo' });
    patient = await prisma.patient.findUnique({ where: { id: b.patientId } });
    if (!patient) return res.status(404).json({ error: 'Paciente no encontrado' });
    if (!assertBranchAccess(req, patient.branchId)) return res.status(403).json({ error: 'Paciente de otra sucursal' });
  }

  // Seguimiento de tratamiento: sin catálogo/servicio cargado.
  const serviceName = b.isFollowUp ? 'Seguimiento de tratamiento' : b.serviceName;
  const catalogItemId = b.isFollowUp ? null : (b.catalogItemId ?? null);
  const startsAt = new Date(`${b.date}T${b.time}:00`);

  // Disponibilidad. Cada cita dura lo que recepción indique (un proceso puede pasar de
  // una hora), así que el choque se calcula con la duración REAL de cada cita, no con
  // una ventana fija. Entre pacientes se deja una separación mínima de 30 minutos.
  const SEPARACION_MIN = 30;
  const nuevoInicio = startsAt.getTime();
  const nuevoFin = nuevoInicio + b.durationMin * 60_000;
  const margenMs = SEPARACION_MIN * 60_000;

  // Se traen las citas del día cercanas y el solape se evalúa una por una.
  const cercanas = await prisma.appointment.findMany({
    where: {
      branchId: patient.branchId,
      status: { not: 'CANCELADA' },
      startsAt: { gt: new Date(nuevoInicio - 8 * 3_600_000), lt: new Date(nuevoFin + 8 * 3_600_000) },
    },
    include: { therapist: true },
  });

  /** ¿Choca con esta cita? Se respeta la separación mínima entre pacientes distintos. */
  const choca = (a: (typeof cercanas)[number]) => {
    const ini = a.startsAt.getTime();
    const fin = ini + a.durationMin * 60_000;
    const margen = a.patientId === patient.id ? 0 : margenMs; // el mismo paciente puede encadenar sesiones
    return nuevoInicio < fin + margen && ini < nuevoFin + margen;
  };

  if (b.therapistId) {
    // Con esteticista asignada: esa persona no puede atender dos pacientes a la vez.
    const conflict = cercanas.find((a) => a.therapistId === b.therapistId && choca(a));
    if (conflict) {
      const h = conflict.startsAt.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
      const quien = conflict.therapist?.name ?? 'la esteticista';
      return res.status(409).json({
        error: `${quien} tiene una cita a las ${h} (${conflict.durationMin} min). Deja al menos ${SEPARACION_MIN} min entre pacientes, o elige otra esteticista.`,
      });
    }
  } else {
    // Sin asignar: se llena solo si TODAS las esteticistas de la sucursal están ocupadas.
    const capacidad = await prisma.user.count({
      where: { role: 'ESTETICISTA', active: true, branchId: patient.branchId },
    });
    const ocupadas = cercanas.filter(choca).length;
    if (ocupadas >= Math.max(1, capacidad)) {
      return res.status(409).json({
        error: capacidad > 1
          ? `A esa hora las ${capacidad} esteticistas están ocupadas. Elige otro horario.`
          : 'Ya hay una cita a esa hora. Elige otro horario.',
      });
    }
  }

  const appt = await prisma.appointment.create({
    data: {
      branchId: patient.branchId, patientId: patient.id, therapistId: b.therapistId ?? null,
      serviceName, catalogItemId, treatmentId: b.treatmentId ?? null, code: genApptCode(),
      startsAt, durationMin: b.durationMin, patientType: patient.type, status: 'CONFIRMADA',
    },
    include: apptInclude,
  });

  // Seguimiento automático: la cita agendada crea/avanza la tarjeta del paciente.
  await upsertLead({ branchId: appt.branchId, patientId: patient.id, name: patient.name, stage: 'CITA_AGENDADA', summary: `Cita: ${serviceName}` });

  // Push al Google Calendar de la SUCURSAL (cada estética conecta su propio calendario
  // en Configuración → Integraciones). Si no está conectado / demo => no-op.
  try {
    const eventId = await pushEvent('branch', appt.branchId, {
      summary: `${patient.name} · ${serviceName}`,
      description: `Li Estetic Connect · ${appt.branch.name}`,
      start: startsAt, durationMin: b.durationMin,
    });
    if (eventId) await prisma.appointment.update({ where: { id: appt.id }, data: { googleEventId: eventId } });
  } catch { /* la cita se crea aunque falle la sync */ }

  // Alerta interna a la esteticista asignada para que atienda al paciente.
  if (appt.therapistId) {
    const hora = startsAt.toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    await notify({
      userId: appt.therapistId,
      type: 'NEW_APPOINTMENT',
      title: 'Nueva cita asignada',
      body: `${patient.name} · ${serviceName} · ${hora}`,
      link: '/app/agenda',
    });
  }

  // Correo de CONFIRMACIÓN (solo detalles + código). NO crea cuenta ni envía acceso:
  // el acceso al portal y la ficha se entregan cuando el paciente se presenta y paga.
  let emailSent = false;
  if (patient.email) {
    const fecha = startsAt.toLocaleDateString('es-DO', { day: '2-digit', month: 'long', year: 'numeric' });
    const hora = startsAt.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
    const mail = await sendAppointmentConfirmation(patient.email, {
      name: patient.name, service: serviceName, date: fecha, time: hora, code: appt.code ?? '',
      branchName: appt.branch.name, branchPlace: appt.branch.place,
      replyTo: appt.branch.email ?? undefined,
    });
    emailSent = mail.sent;
  }

  // Cliente nuevo: aviso a las esteticistas de la sucursal.
  if (b.newPatient) {
    await notifyBranchTherapists(patient.branchId, {
      type: 'FICHA_SENT',
      title: 'Nuevo paciente agendado',
      body: `${patient.name} · ${serviceName}. Llena la ficha cuando se presente y pague.`,
      link: '/app/pacientes',
    });
  }

  // Enlace de WhatsApp con la confirmación ya escrita: recepción la envía al paciente
  // con un solo clic al terminar de agendar (mensaje precargado, sin depender de Meta).
  let whatsappUrl: string | null = null;
  if (patient.phone) {
    const cuando = startsAt.toLocaleString('es-DO', { weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' });
    const codigo = appt.code ? ` Tu código de cita es ${appt.code}.` : '';
    const confirmText = `Hola ${patient.name.split(' ')[0]} 💜 Confirmamos tu cita en ${appt.branch.name}: ${serviceName} el ${cuando}.${codigo} Te esperamos 10 min antes. — Li Estetic Center`;
    whatsappUrl = `https://wa.me/${normalizePhone(patient.phone)}?text=${encodeURIComponent(confirmText)}`;
  }

  const message = patient.email
    ? (emailSent ? `Cita agendada · confirmación enviada a ${patient.email}` : `Cita agendada · no se pudo enviar el correo`)
    : 'Cita agendada y confirmada';
  res.status(201).json({ ...serializeAppt(appt), emailSent, message, whatsappUrl, patientName: patient.name });
});

const checkinSchema = z.object({ code: z.string().min(4) });

/**
 * Abrir turno en cabina: la esteticista valida el código único del paciente.
 * No reutilizable (una vez usado, marca codeUsedAt). Aislado por sucursal.
 */
appointmentsRouter.post('/checkin', requireStaff, requireRole('ADMIN', 'ESTETICISTA'), branchScope, async (req, res) => {
  const { code } = checkinSchema.parse(req.body);
  const appt = await prisma.appointment.findUnique({
    where: { code: code.trim().toUpperCase() }, include: apptInclude,
  });
  if (!appt) return res.status(404).json({ error: 'Código inválido · no corresponde a ninguna cita' });
  if (!assertBranchAccess(req, appt.branchId)) return res.status(403).json({ error: 'La cita es de otra sucursal' });
  if (appt.codeUsedAt) {
    return res.status(409).json({ error: `Este código ya fue usado (turno abierto ${appt.codeUsedAt.toLocaleString('es-DO', { hour: '2-digit', minute: '2-digit' })})` });
  }
  if (appt.status === 'CANCELADA') return res.status(409).json({ error: 'La cita está cancelada' });

  const updated = await prisma.appointment.update({
    where: { id: appt.id },
    // Inicia el contador de atención (oculto para la esteticista).
    data: { codeUsedAt: new Date(), serviceStartedAt: new Date(), status: 'CONFIRMADA' },
    include: apptInclude,
  });
  res.json({ ok: true, message: `Turno abierto: ${appt.patient.name} · ${appt.serviceName}`, appointment: serializeAppt(updated) });
});

/** Proceso terminado: cierra el contador de atención y marca la cita como completada. */
appointmentsRouter.post('/:id/finish', requireStaff, requireRole('ADMIN', 'ESTETICISTA', 'RECEPCIONISTA'), branchScope, async (req, res) => {
  // La esteticista indica qué áreas trabajó: se consume 1 sesión por área.
  const b = z.object({
    areas: z.array(z.string()).optional(),
    techniques: z.array(z.string()).optional(), // checklist de lo aplicado ese día
  }).parse(req.body ?? {});
  const appt = await prisma.appointment.findUnique({ where: { id: req.params.id }, include: apptInclude });
  if (!appt) return res.status(404).json({ error: 'Cita no encontrada' });
  if (!assertBranchAccess(req, appt.branchId)) return res.status(403).json({ error: 'Cita de otra sucursal' });
  if (!appt.serviceStartedAt) return res.status(409).json({ error: 'El turno no ha sido abierto todavía' });
  if (appt.serviceEndedAt) return res.status(409).json({ error: 'El proceso ya fue cerrado' });

  const endedAt = new Date();
  const durationSec = Math.max(0, Math.round((endedAt.getTime() - appt.serviceStartedAt.getTime()) / 1000));

  // Consumir sesiones del paquete: el de la cita, o el único activo si solo hay uno.
  const activos = appt.patient.treatments.filter((t) => t.active && t.doneSessions < t.totalSessions);
  const target = appt.treatmentId
    ? activos.find((t) => t.id === appt.treatmentId) ?? null
    : (activos.length === 1 ? activos[0] : null);

  let sessionMsg = '';
  if (target) {
    // Las áreas trabajadas se indican al cerrar; si no se indican, se usan las de la cita.
    const trabajadas = (b.areas?.length ? b.areas : appt.areas) ?? [];
    const conAreas = target.areas.filter((a) => trabajadas.includes(a.area) && a.doneSessions < a.totalSessions);

    // Se consume 1 sesión POR ÁREA trabajada (un combo de 12 con 2 áreas son 6 y 6).
    const consumidas = conAreas.length || 1;
    const detalle: string[] = [];
    const areaLabels = await getAreaLabelMap();

    for (const a of conAreas) {
      const done = Math.min(a.totalSessions, a.doneSessions + 1);
      await prisma.treatmentArea.update({ where: { id: a.id }, data: { doneSessions: done } });
      detalle.push(`${areaLabels[a.area] ?? a.area} ${done}/${a.totalSessions}`);
    }

    const done = Math.min(target.totalSessions, target.doneSessions + consumidas);
    const restantes = target.totalSessions - done;
    await prisma.treatment.update({
      where: { id: target.id },
      // Al agotar las sesiones el paquete se cierra y deja de aparecer como activo.
      data: { doneSessions: done, ...(restantes === 0 ? { active: false } : {}) },
    });
    await prisma.appointment.update({
      where: { id: appt.id },
      data: { sessionNo: done, treatmentId: target.id, ...(b.areas?.length ? { areas: b.areas } : {}) },
    });

    sessionMsg = restantes === 0
      ? ` · ${target.name}: completado (${done}/${target.totalSessions}) 🎉`
      : ` · ${target.name}: ${done}/${target.totalSessions} (quedan ${restantes})`;
    if (detalle.length) sessionMsg += ` · ${detalle.join(' · ')}`;
  } else if (activos.length > 1) {
    sessionMsg = ' · Ojo: el paciente tiene varios paquetes, no se descontó sesión (elige el paquete al agendar)';
  }

  await prisma.appointment.update({
    where: { id: appt.id },
    data: {
      serviceEndedAt: endedAt, serviceDurationSec: durationSec, status: 'COMPLETADA',
      ...(b.techniques?.length ? { techniques: b.techniques } : {}),
    },
  });

  // Descontar del conteo por técnica del combo cada técnica aplicada hoy.
  if (target && b.techniques?.length) {
    const techs = await prisma.treatmentTechnique.findMany({ where: { treatmentId: target.id } });
    for (const nombre of b.techniques) {
      const tech = techs.find((x) => x.name === nombre);
      if (tech && tech.done < tech.total) {
        await prisma.treatmentTechnique.update({ where: { id: tech.id }, data: { done: tech.done + 1 } });
      }
    }
  }

  const tecnicasMsg = b.techniques?.length ? ` · Aplicado: ${b.techniques.join(', ')}` : '';
  res.json({ ok: true, message: `Proceso terminado.${sessionMsg}${tecnicasMsg}` });
});

const cancelSchema = z.object({ reason: z.string().trim().min(3, 'Escribe el motivo de la cancelación') });

/**
 * Cancelar una cita desde el sistema (recepción/admin). Motivo obligatorio.
 * Avisa al paciente por correo y le deja el aviso en su portal; notifica a la
 * esteticista asignada. La esteticista NO cancela (solo recepción/admin).
 */
appointmentsRouter.post('/:id/cancel', requireStaff, requireRole('ADMIN', 'RECEPCIONISTA'), branchScope, async (req, res) => {
  const { reason } = cancelSchema.parse(req.body);
  const appt = await prisma.appointment.findUnique({ where: { id: req.params.id }, include: apptInclude });
  if (!appt) return res.status(404).json({ error: 'Cita no encontrada' });
  if (!assertBranchAccess(req, appt.branchId)) return res.status(403).json({ error: 'Cita de otra sucursal' });
  if (appt.status === 'CANCELADA') return res.status(409).json({ error: 'La cita ya está cancelada' });

  await prisma.appointment.update({
    where: { id: appt.id },
    data: { status: 'CANCELADA', cancelReason: reason, cancelledBy: 'STAFF', cancelledAt: new Date() },
  });

  const fecha = appt.startsAt.toLocaleDateString('es-DO', { day: '2-digit', month: 'long', year: 'numeric' });
  const hora = appt.startsAt.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });

  // Correo al paciente con el motivo (el aviso en el portal se muestra desde la cita cancelada).
  let emailSent = false;
  if (appt.patient.email) {
    const mail = await sendAppointmentCancelled(appt.patient.email, {
      name: appt.patient.name, service: appt.serviceName, date: fecha, time: hora,
      reason, by: 'clinic', branchName: appt.branch.name, replyTo: appt.branch.email ?? undefined,
    });
    emailSent = mail.sent;
  }

  // Aviso interno a la esteticista asignada (si la hay).
  if (appt.therapistId) {
    await notify({
      userId: appt.therapistId, type: 'APPOINTMENT_CANCELLED',
      title: 'Cita cancelada', body: `${appt.patient.name} · ${appt.serviceName} · ${fecha} ${hora}. Motivo: ${reason}`,
      link: '/app/agenda',
    });
  }

  res.json({ ok: true, emailSent, message: appt.patient.email ? (emailSent ? 'Cita cancelada · aviso enviado al paciente' : 'Cita cancelada · no se pudo enviar el correo') : 'Cita cancelada' });
});

const patchSchema = z.object({
  status: z.enum(['SIN_CONFIRMAR', 'CONFIRMADA', 'COMPLETADA', 'CANCELADA', 'REAGENDADA']).optional(),
  date: z.string().optional(),
  time: z.string().optional(),
  // Asignar/cambiar/quitar esteticista tras agendar. '' o null => sin asignar.
  therapistId: z.string().nullish(),
});

/** Confirmar / cancelar / reagendar / (re)asignar esteticista. */
appointmentsRouter.patch('/:id', requireStaff, branchScope, async (req, res) => {
  const body = patchSchema.parse(req.body);
  const appt = await prisma.appointment.findUnique({ where: { id: req.params.id } });
  if (!appt) return res.status(404).json({ error: 'Cita no encontrada' });
  if (!assertBranchAccess(req, appt.branchId)) return res.status(403).json({ error: 'Cita de otra sucursal' });

  const startsAt = body.date && body.time ? new Date(`${body.date}T${body.time}:00`) : undefined;

  // (Re)asignación de esteticista: solo recepción y admin, con validación de conflicto.
  const cambiaTerapeuta = body.therapistId !== undefined;
  const nuevoTherapistId = body.therapistId === '' ? null : body.therapistId ?? null;
  if (cambiaTerapeuta) {
    if (!['ADMIN', 'RECEPCIONISTA'].includes(req.staff!.role)) {
      return res.status(403).json({ error: 'Solo recepción o administración puede asignar la esteticista' });
    }
    if (nuevoTherapistId) {
      // Debe ser una esteticista activa de la misma sucursal.
      const t = await prisma.user.findFirst({ where: { id: nuevoTherapistId, role: 'ESTETICISTA', active: true, branchId: appt.branchId } });
      if (!t) return res.status(400).json({ error: 'Esa esteticista no está disponible en esta sucursal' });
      // No puede tener otra cita que solape (respetando la separación mínima).
      const ini = (startsAt ?? appt.startsAt).getTime();
      const fin = ini + appt.durationMin * 60_000;
      const margen = 30 * 60_000; // separación mínima entre pacientes distintos
      const otras = await prisma.appointment.findMany({
        where: { id: { not: appt.id }, therapistId: nuevoTherapistId, status: { not: 'CANCELADA' },
          startsAt: { gt: new Date(ini - 8 * 3_600_000), lt: new Date(fin + 8 * 3_600_000) } },
      });
      const conflict = otras.find((a) => {
        const aIni = a.startsAt.getTime(); const aFin = aIni + a.durationMin * 60_000;
        const m = a.patientId === appt.patientId ? 0 : margen;
        return ini < aFin + m && aIni < fin + m;
      });
      if (conflict) {
        const h = conflict.startsAt.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
        return res.status(409).json({ error: `${t.name} ya tiene una cita a las ${h}. Elige otra esteticista u otro horario.` });
      }
    }
  }

  const updated = await prisma.appointment.update({
    where: { id: appt.id },
    data: {
      status: body.status, ...(startsAt ? { startsAt } : {}),
      ...(cambiaTerapeuta ? { therapistId: nuevoTherapistId } : {}),
    },
    include: apptInclude,
  });

  // Avisa a la esteticista recién asignada (si cambió y hay alguien).
  if (cambiaTerapeuta && nuevoTherapistId && nuevoTherapistId !== appt.therapistId) {
    const hora = updated.startsAt.toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    await notify({
      userId: nuevoTherapistId,
      type: 'NEW_APPOINTMENT',
      title: 'Cita asignada',
      body: `${updated.patient.name} · ${updated.serviceName} · ${hora}`,
      link: '/app/agenda',
    }).catch(() => {});
  }

  res.json(serializeAppt(updated));
});

const remindSchema = z.object({
  channels: z.array(z.enum(['correo', 'whatsapp', 'portal'])).min(1).default(['whatsapp']),
});

/** Enviar recordatorio por los canales elegidos (correo / WhatsApp / portal / todas). */
appointmentsRouter.post('/:id/remind', requireStaff, branchScope, async (req, res) => {
  const { channels } = remindSchema.parse(req.body ?? {});
  const appt = await prisma.appointment.findUnique({ where: { id: req.params.id }, include: apptInclude });
  if (!appt) return res.status(404).json({ error: 'Cita no encontrada' });
  if (!assertBranchAccess(req, appt.branchId)) return res.status(403).json({ error: 'Cita de otra sucursal' });

  const when = appt.startsAt.toLocaleString('es-DO', { weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' });
  const text = `Hola ${appt.patient.name.split(' ')[0]} 💜 Te recordamos tu cita en ${appt.branch.name}: ${appt.serviceName} el ${when}. — Li Estetic Center`;

  const results: Record<string, string> = {};
  let whatsappUrl: string | null = null;
  for (const ch of channels) {
    if (ch === 'whatsapp') {
      const r = await sendWhatsAppText(appt.patient.phone, text);
      results.whatsapp = r.sent ? 'enviado' : r.mode === 'demo' ? 'listo para enviar por WhatsApp' : `error: ${r.error}`;
      // Enlace wa.me con el mensaje precargado: recepción lo envía desde su WhatsApp.
      if (appt.patient.phone) whatsappUrl = `https://wa.me/${normalizePhone(appt.patient.phone)}?text=${encodeURIComponent(text)}`;
    } else if (ch === 'correo') {
      results.correo = appt.patient.email ? 'enviado (correo)' : 'sin correo · simulado';
    } else if (ch === 'portal') {
      results.portal = 'notificación publicada en el portal';
    }
  }
  await prisma.appointment.update({ where: { id: appt.id }, data: { reminderSentAt: new Date() } });
  res.json({ ok: true, results, whatsappUrl, message: `Recordatorio enviado por: ${channels.join(', ')}` });
});
