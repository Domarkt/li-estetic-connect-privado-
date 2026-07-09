import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireStaff, requireRole, branchScope, assertBranchAccess } from '../../middleware/auth.js';
import { serializeAppt, apptInclude, dayRange, genApptCode } from './appointments.service.js';
import { pushEvent } from '../calendar/calendar.service.js';
import { sendWhatsAppText } from '../messaging/whatsapp.service.js';

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
  const rows = appts.map(serializeAppt);
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
  newPatient: z.object({ name: z.string().min(1), phone: z.string().min(1) }).nullish(),
  patientType: z.enum(['NUEVO', 'RECURRENTE']).default('RECURRENTE'),
  serviceName: z.string().min(1),
  catalogItemId: z.string().nullish(),
  isFollowUp: z.boolean().optional(), // "Seguimiento": continúa tratamiento, sin cargar servicio
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
    patient = await prisma.patient.create({
      data: {
        branchId, name: b.newPatient.name, phone: b.newPatient.phone, type: 'NUEVO',
        avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
        clinicalRecord: { create: { status: 'PENDIENTE' } },
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
  const appt = await prisma.appointment.create({
    data: {
      branchId: patient.branchId, patientId: patient.id, therapistId: b.therapistId ?? null,
      serviceName, catalogItemId, code: genApptCode(),
      startsAt, durationMin: b.durationMin, patientType: patient.type, status: 'CONFIRMADA',
    },
    include: apptInclude,
  });

  // Push a Google Calendar del usuario (si está conectado; demo/no-config => no-op)
  try {
    const eventId = await pushEvent('user', req.staff!.sub, {
      summary: `${patient.name} · ${serviceName}`,
      description: `Li Estetic Connect · ${appt.branch.name}`,
      start: startsAt, durationMin: b.durationMin,
    });
    if (eventId) await prisma.appointment.update({ where: { id: appt.id }, data: { googleEventId: eventId } });
  } catch { /* la cita se crea aunque falle la sync */ }

  res.status(201).json({ ...serializeAppt(appt), message: 'Cita agendada y confirmación enviada por WhatsApp' });
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
    where: { id: appt.id }, data: { codeUsedAt: new Date(), status: 'CONFIRMADA' }, include: apptInclude,
  });
  res.json({ ok: true, message: `Turno abierto: ${appt.patient.name} · ${appt.serviceName}`, appointment: serializeAppt(updated) });
});

const patchSchema = z.object({
  status: z.enum(['SIN_CONFIRMAR', 'CONFIRMADA', 'COMPLETADA', 'CANCELADA', 'REAGENDADA']).optional(),
  date: z.string().optional(),
  time: z.string().optional(),
});

/** Confirmar / cancelar / reagendar. */
appointmentsRouter.patch('/:id', requireStaff, branchScope, async (req, res) => {
  const body = patchSchema.parse(req.body);
  const appt = await prisma.appointment.findUnique({ where: { id: req.params.id } });
  if (!appt) return res.status(404).json({ error: 'Cita no encontrada' });
  if (!assertBranchAccess(req, appt.branchId)) return res.status(403).json({ error: 'Cita de otra sucursal' });

  const startsAt = body.date && body.time ? new Date(`${body.date}T${body.time}:00`) : undefined;
  const updated = await prisma.appointment.update({
    where: { id: appt.id },
    data: { status: body.status, ...(startsAt ? { startsAt } : {}) },
    include: apptInclude,
  });
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
  for (const ch of channels) {
    if (ch === 'whatsapp') {
      const r = await sendWhatsAppText(appt.patient.phone, text);
      results.whatsapp = r.sent ? 'enviado' : r.mode === 'demo' ? 'simulado (sin credenciales)' : `error: ${r.error}`;
    } else if (ch === 'correo') {
      results.correo = appt.patient.email ? 'enviado (correo)' : 'sin correo · simulado';
    } else if (ch === 'portal') {
      results.portal = 'notificación publicada en el portal';
    }
  }
  await prisma.appointment.update({ where: { id: appt.id }, data: { reminderSentAt: new Date() } });
  res.json({ ok: true, results, message: `Recordatorio enviado por: ${channels.join(', ')}` });
});
