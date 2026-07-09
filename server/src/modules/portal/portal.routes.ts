import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requirePatient } from '../../middleware/auth.js';
import { genApptCode } from '../appointments/appointments.service.js';

export const portalRouter = Router();
portalRouter.use(requirePatient);

const CARE_TIPS = 'Toma abundante agua, evita alimentos con sodio y camina 20 min hoy para potenciar tus resultados.';

/** Mi Proceso: tratamiento activo, progreso, próxima cita y tips. */
portalRouter.get('/proceso', async (req, res) => {
  const patientId = req.patient!.patientId;
  const [treatment, nextAppt] = await Promise.all([
    prisma.treatment.findFirst({ where: { patientId, active: true }, orderBy: { createdAt: 'desc' } }),
    prisma.appointment.findFirst({
      where: { patientId, startsAt: { gte: new Date() }, status: { not: 'CANCELADA' } },
      include: { therapist: true, branch: true }, orderBy: { startsAt: 'asc' },
    }),
  ]);

  res.json({
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
    where: { patientId: req.patient!.patientId, status: { not: 'CANCELADA' }, startsAt: { gte: new Date() } },
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

/** Cancelar una cita (aplica política: aviso de 24h y límite de 5 cancelaciones). */
portalRouter.delete('/appointments/:id', async (req, res) => {
  const appt = await prisma.appointment.findUnique({ where: { id: req.params.id } });
  if (!appt || appt.patientId !== req.patient!.patientId) return res.status(404).json({ error: 'Cita no encontrada' });

  const hoursToAppt = (appt.startsAt.getTime() - Date.now()) / 36e5;
  await prisma.appointment.update({ where: { id: appt.id }, data: { status: 'CANCELADA' } });

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
