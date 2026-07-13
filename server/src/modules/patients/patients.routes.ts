import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireStaff, requireRole, branchScope, assertBranchAccess } from '../../middleware/auth.js';
import { serializePatient, patientInclude, syncPatientType } from './patients.service.js';
import { hashPassword } from '../../utils/password.js';
import { sendPatientAccess, PORTAL_URL } from '../mail/mail.service.js';
import { notifyBranchTherapists, notifyRole } from '../notifications/notifications.service.js';

export const patientsRouter = Router();

/** Lista de pacientes (aislada por sucursal; búsqueda por nombre/teléfono). */
patientsRouter.get('/', requireStaff, branchScope, async (req, res) => {
  const q = (req.query.q as string | undefined)?.trim();
  const where = {
    ...(req.scopeBranchId ? { branchId: req.scopeBranchId } : {}),
    ...(q
      ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { phone: { contains: q } }] }
      : {}),
  };
  const patients = await prisma.patient.findMany({
    where,
    include: patientInclude,
    orderBy: { createdAt: 'desc' },
  });
  res.json(patients.map(serializePatient));
});

/** Detalle de un paciente (drawer). */
patientsRouter.get('/:id', requireStaff, branchScope, async (req, res) => {
  const patient = await prisma.patient.findUnique({
    where: { id: req.params.id },
    include: { ...patientInclude, clinicalRecord: { include: { therapist: true } } },
  });
  if (!patient) return res.status(404).json({ error: 'Paciente no encontrado' });
  if (!assertBranchAccess(req, patient.branchId)) {
    return res.status(403).json({ error: 'Paciente de otra sucursal' });
  }

  const treatment = patient.treatments.find((t) => t.active) ?? patient.treatments[0] ?? null;
  const cr = patient.clinicalRecord;
  const truthyKeys = (obj: unknown) =>
    obj && typeof obj === 'object' ? Object.entries(obj as Record<string, unknown>).filter(([, v]) => v === true).map(([k]) => k) : [];

  res.json({
    ...serializePatient(patient),
    since: patient.createdAt.toLocaleDateString('es-DO', { month: 'short', year: 'numeric' }),
    skin: cr?.fototipo ?? '—',
    motivo: cr?.motivos ?? [],
    therapistName: cr?.therapist?.name ?? null,
    // Historial clínico (antecedentes) para ver en el drawer
    clinical: {
      antecedentes: truthyKeys(cr?.antecedentes),
      medicamentos: truthyKeys(cr?.medicamentos),
      tallaCm: cr?.tallaCm ?? null,
      pesoLb: cr?.pesoLb ?? null,
      observaciones: (cr?.quirurgicos as { observaciones?: string } | null)?.observaciones ?? null,
    },
    treatment: treatment
      ? {
          id: treatment.id, name: treatment.name,
          total: treatment.totalSessions, done: treatment.doneSessions,
          balance: treatment.balance,
        }
      : null,
    // Cargos pendientes que la esteticista mandó a recepción
    pendingCharges: await prisma.chargeItem.findMany({
      where: { patientId: patient.id, status: 'PENDIENTE_FACTURAR' },
      orderBy: { createdAt: 'desc' },
    }),
  });
});

const createPatientSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  branchId: z.string().optional(),
  sex: z.enum(['M', 'F']).optional(),
  age: z.number().int().optional(),
  cedula: z.string().optional(),
  occupation: z.string().optional(),
  address: z.string().optional(),
});

/**
 * "Nuevo paciente": lo crea Recepción o Admin y abre directamente la ficha (Paso 1).
 * Nace como NUEVO con ficha PENDIENTE.
 */
patientsRouter.post('/', requireStaff, requireRole('ADMIN', 'RECEPCIONISTA'), async (req, res) => {
  const body = createPatientSchema.parse(req.body);
  // Sucursal destino: la del recepcionista, o la enviada por admin.
  const branchId = req.staff!.role === 'ADMIN' ? body.branchId : req.staff!.branchId;
  if (!branchId) return res.status(400).json({ error: 'Sucursal requerida' });
  if (!assertBranchAccess(req, branchId)) return res.status(403).json({ error: 'Sucursal no permitida' });

  const colors = ['#B31C86', '#8E1268', '#2C7FB8', '#1F9D6B', '#245E85', '#C9880E'];
  const patient = await prisma.patient.create({
    data: {
      branchId, name: body.name, phone: body.phone, age: body.age ?? null,
      sex: body.sex ?? null,
      cedula: body.cedula ?? null, occupation: body.occupation ?? null, address: body.address ?? null,
      type: 'NUEVO',
      avatarColor: colors[Math.floor(Math.random() * colors.length)],
      clinicalRecord: { create: { status: 'PENDIENTE' } },
    },
    include: patientInclude,
  });
  res.status(201).json(serializePatient(patient));
});

// ─────────────────────────────────────────────────────────────
// FICHA CLÍNICA (4 pasos divididos por rol)
// ─────────────────────────────────────────────────────────────

/** Devuelve la ficha completa para el wizard. */
patientsRouter.get('/:id/ficha', requireStaff, branchScope, async (req, res) => {
  const patient = await prisma.patient.findUnique({
    where: { id: req.params.id },
    include: { clinicalRecord: true },
  });
  if (!patient) return res.status(404).json({ error: 'Paciente no encontrado' });
  if (!assertBranchAccess(req, patient.branchId)) return res.status(403).json({ error: 'Paciente de otra sucursal' });
  res.json({
    patient: {
      id: patient.id, name: patient.name, phone: patient.phone, age: patient.age, email: patient.email,
      sex: patient.sex,
      birthDate: patient.birthDate, occupation: patient.occupation, address: patient.address,
    },
    ficha: patient.clinicalRecord,
  });
});

const step1Schema = z.object({
  consultDate: z.string().optional(),
  name: z.string().optional(),
  sex: z.enum(['M', 'F']).optional(),
  age: z.number().int().optional(),
  birthDate: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  occupation: z.string().optional(),
  address: z.string().optional(),
  motivos: z.array(z.string()).default([]),
});

/**
 * Paso 1 — Datos & motivo (Recepción). Al guardar, la ficha pasa a PASO1_OK
 * ("enviar a esteticista"). Recepción NO puede tocar pasos 2-4.
 */
patientsRouter.patch('/:id/ficha/step1', requireStaff, requireRole('ADMIN', 'RECEPCIONISTA'), async (req, res) => {
  const body = step1Schema.parse(req.body);
  const patient = await prisma.patient.findUnique({ where: { id: req.params.id } });
  if (!patient) return res.status(404).json({ error: 'Paciente no encontrado' });
  if (!assertBranchAccess(req, patient.branchId)) return res.status(403).json({ error: 'Paciente de otra sucursal' });

  await prisma.patient.update({
    where: { id: patient.id },
    data: {
      name: body.name ?? patient.name,
      sex: body.sex ?? patient.sex,
      age: body.age ?? patient.age,
      phone: body.phone ?? patient.phone,
      email: body.email ? body.email : patient.email,
      birthDate: body.birthDate ? new Date(body.birthDate) : patient.birthDate,
      occupation: body.occupation ?? patient.occupation,
      address: body.address ?? patient.address,
    },
  });
  await prisma.clinicalRecord.update({
    where: { patientId: patient.id },
    data: {
      consultDate: body.consultDate ? new Date(body.consultDate) : new Date(),
      motivos: body.motivos,
      // Solo avanza a PASO1_OK si aún estaba pendiente (no retrocede una ficha completa).
      status: patient.type === 'RECURRENTE' ? undefined : 'PASO1_OK',
    },
  });
  res.json({ ok: true, message: 'Datos iniciales guardados' });
});

/**
 * Enviar la ficha al PACIENTE para que la complete: crea acceso al portal
 * (si no tiene) y envía el correo con credenciales. La esteticista la validará luego.
 */
patientsRouter.post('/:id/ficha/send-to-patient', requireStaff, requireRole('ADMIN', 'RECEPCIONISTA'), async (req, res) => {
  const patient = await prisma.patient.findUnique({ where: { id: req.params.id }, include: { patientAccount: true, branch: true } });
  if (!patient) return res.status(404).json({ error: 'Paciente no encontrado' });
  if (!assertBranchAccess(req, patient.branchId)) return res.status(403).json({ error: 'Paciente de otra sucursal' });
  if (!patient.email) return res.status(400).json({ error: 'Agrega el correo del paciente en el Paso 1 antes de enviar' });

  // Crea la cuenta del portal si no existe (login = celular; contraseña temporal).
  const login = (patient.phone || patient.cedula || '').trim();
  if (!login) return res.status(400).json({ error: 'El paciente necesita celular o cédula para el acceso' });

  let tempPassword: string | undefined;
  if (!patient.patientAccount) {
    tempPassword = 'li' + Math.random().toString(36).slice(2, 8);
    await prisma.patientAccount.create({ data: { patientId: patient.id, login, passwordHash: await hashPassword(tempPassword) } });
  }

  await prisma.clinicalRecord.update({
    where: { patientId: patient.id },
    data: { sentToPatientAt: new Date(), status: patient.type === 'RECURRENTE' ? undefined : 'PASO1_OK' },
  });

  const mail = await sendPatientAccess(patient.email, { name: patient.name, login, password: tempPassword, replyTo: patient.branch.email ?? undefined });

  // Aviso a las esteticistas de la sucursal: hay un nuevo paciente para atender.
  await notifyBranchTherapists(patient.branchId, {
    type: 'FICHA_SENT',
    title: 'Nuevo paciente en proceso',
    body: `${patient.name} recibió su acceso al portal para completar la ficha.`,
    link: '/app/pacientes',
  });

  const failNote = mail.mode === 'live'
    ? '(no se pudo enviar el correo, comparte los datos manualmente)'
    : '(correo en modo demo)';
  res.json({
    ok: true,
    emailSent: mail.sent,
    mailMode: mail.mode,
    mailError: mail.error,
    access: { portalUrl: PORTAL_URL, login, tempPassword: tempPassword ?? null },
    message: mail.sent
      ? `Ficha enviada al correo del paciente (${patient.email})`
      : `Acceso creado. Comparte con el paciente: usuario ${login}${tempPassword ? ` · contraseña ${tempPassword}` : ''} ${failNote}`,
  });
});

const clinicalSchema = z.object({
  antecedentes: z.record(z.any()).optional(),
  ginecoObst: z.record(z.any()).optional(),
  quirurgicos: z.record(z.any()).optional(),
  medicamentos: z.record(z.any()).optional(),
  fototipo: z.string().optional(),
  tallaCm: z.number().int().optional(),
  pesoLb: z.number().int().optional(),
  tratamiento: z.string().optional(),
  controlCitas: z.array(z.any()).optional(),
  cancelPolicyAck: z.boolean().optional(),
  signatureData: z.string().optional(),
  complete: z.boolean().optional(), // true en el último paso
});

/**
 * Pasos 2-4 — parte clínica (Esteticista). Puede completar la ficha.
 * Al completar (complete=true) => status COMPLETA y el paciente pasa a RECURRENTE.
 */
patientsRouter.patch('/:id/ficha/clinical', requireStaff, requireRole('ADMIN', 'ESTETICISTA'), async (req, res) => {
  const body = clinicalSchema.parse(req.body);
  const patient = await prisma.patient.findUnique({ where: { id: req.params.id }, include: { clinicalRecord: true } });
  if (!patient) return res.status(404).json({ error: 'Paciente no encontrado' });
  if (!assertBranchAccess(req, patient.branchId)) return res.status(403).json({ error: 'Paciente de otra sucursal' });

  const { complete, ...fields } = body;
  await prisma.clinicalRecord.update({
    where: { patientId: patient.id },
    data: {
      ...fields,
      therapistId: req.staff!.role === 'ESTETICISTA' ? req.staff!.sub : patient.clinicalRecord?.therapistId,
      ...(complete ? { status: 'COMPLETA', completedAt: new Date() } : {}),
    },
  });

  // Crea el tratamiento activo si se indicó y aún no existe
  if (complete && fields.tratamiento) {
    const exists = await prisma.treatment.findFirst({ where: { patientId: patient.id, active: true } });
    if (!exists) {
      const item = await prisma.catalogItem.findFirst({ where: { name: { contains: fields.tratamiento.split(' —')[0] } } });
      await prisma.treatment.create({
        data: {
          patientId: patient.id, name: fields.tratamiento, catalogItemId: item?.id ?? null,
          totalSessions: item?.sessions ?? 10, doneSessions: 0, balance: item?.price ?? 0,
        },
      });
    }
  }

  const type = complete ? await syncPatientType(patient.id) : patient.type;
  res.json({ ok: true, complete: !!complete, type, message: complete ? 'Ficha clínica guardada correctamente' : 'Progreso guardado' });
});

// ─────────────────────────────────────────────────────────────
// CARGOS (esteticista agrega paquetes/combos → recepción factura)
// ─────────────────────────────────────────────────────────────

const chargeSchema = z.object({ catalogItemIds: z.array(z.string()).min(1) });

/** Esteticista carga paquetes/combos a la ficha y los envía a recepción. */
patientsRouter.post('/:id/charges', requireStaff, requireRole('ADMIN', 'ESTETICISTA', 'RECEPCIONISTA'), async (req, res) => {
  const { catalogItemIds } = chargeSchema.parse(req.body);
  const patient = await prisma.patient.findUnique({ where: { id: req.params.id } });
  if (!patient) return res.status(404).json({ error: 'Paciente no encontrado' });
  if (!assertBranchAccess(req, patient.branchId)) return res.status(403).json({ error: 'Paciente de otra sucursal' });

  const items = await prisma.catalogItem.findMany({ where: { id: { in: catalogItemIds } } });
  await prisma.chargeItem.createMany({
    data: items.map((it) => ({
      branchId: patient.branchId, patientId: patient.id, catalogItemId: it.id,
      name: it.name, price: it.price, createdById: req.staff!.sub,
    })),
  });
  // Si la esteticista cargó servicios, avisa a recepción para que facture.
  if (req.staff!.role === 'ESTETICISTA' && items.length) {
    await notifyRole('RECEPCIONISTA', {
      type: 'GENERAL',
      title: 'Servicios para facturar',
      body: `${patient.name}: ${items.map((i) => i.name).join(', ')}`,
      link: '/app/pacientes',
    }, patient.branchId);
  }

  res.status(201).json({ ok: true, count: items.length, message: 'Servicios cargados y enviados a recepción para facturar ✓' });
});
