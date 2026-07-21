import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireStaff, requireRole, branchScope, assertBranchAccess } from '../../middleware/auth.js';
import { serializePatient, patientInclude, syncPatientType, ageFromBirth } from './patients.service.js';
import { decryptClinical, encryptClinicalWrite, decryptPatientPII, encryptPatientWrite } from './patients.crypto.js';
import { decrypt } from '../../utils/crypto.js';
import { hashPassword } from '../../utils/password.js';
import { sendPatientAccess, PORTAL_URL } from '../mail/mail.service.js';
import { notifyBranchTherapists, notifyRole } from '../notifications/notifications.service.js';
import { upsertLead } from '../messaging/leads.service.js';
import { AREAS, AREA_LABEL, AREA_EXTRA_PRECIO, definirAreas, serializeAreas } from './areas.service.js';
import { normalizePhone } from '../messaging/whatsapp.service.js';

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
  const cr = decryptClinical(patient.clinicalRecord);
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
    // TODOS los paquetes/combos activos: el paciente puede tener varios comprados
    // y sin consumir (antes solo se veía uno y el control se llevaba en papel).
    packages: patient.treatments
      .filter((t) => t.active)
      .map((t) => ({
        id: t.id, name: t.name,
        total: t.totalSessions, done: t.doneSessions,
        remaining: Math.max(0, t.totalSessions - t.doneSessions),
        pct: t.totalSessions > 0 ? Math.round((t.doneSessions / t.totalSessions) * 100) : 0,
        price: t.price,
        balance: t.balance,
        areas: serializeAreas(t.areas ?? []),
        // Técnicas que cubre el combo/paquete: la esteticista marca cuáles aplicó.
        services: (t.catalogItem?.incluye ?? []).map((x) => ({ id: x.service.id, name: x.service.name })),
      })),
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
      ...encryptPatientWrite({ cedula: body.cedula ?? null, address: body.address ?? null }),
      occupation: body.occupation ?? null,
      type: 'NUEVO',
      avatarColor: colors[Math.floor(Math.random() * colors.length)],
      clinicalRecord: { create: { status: 'PENDIENTE' } },
    },
    include: patientInclude,
  });
  // Seguimiento automático: cliente nuevo con ficha pendiente entra al tablero.
  await upsertLead({ branchId, patientId: patient.id, name: patient.name, stage: 'EN_CONVERSACION', summary: 'Cliente nuevo · ficha pendiente' });
  res.status(201).json(serializePatient(patient));
});

// ── Áreas del cuerpo dentro de un combo ──
// Recepción y esteticista pueden definirlas: a veces la clienta las pide en recepción
// antes de pasar a cabina, y a veces se definen en la cabina misma.
const areasRoles = ['ADMIN', 'RECEPCIONISTA', 'ESTETICISTA'] as const;

const definirAreasSchema = z.object({
  areas: z.array(z.enum(AREAS)).min(1, 'Elige al menos un área').max(3),
});

/** Definir las áreas incluidas del combo y repartir sus sesiones (12 → 6 y 6). */
patientsRouter.patch('/treatments/:treatmentId/areas', requireStaff, requireRole(...areasRoles), async (req, res) => {
  const { areas } = definirAreasSchema.parse(req.body);
  const t = await prisma.treatment.findUnique({ where: { id: req.params.treatmentId }, include: { patient: true } });
  if (!t) return res.status(404).json({ error: 'Paquete no encontrado' });
  if (!assertBranchAccess(req, t.patient.branchId)) return res.status(403).json({ error: 'Paciente de otra sucursal' });

  const actualizado = await definirAreas(t.id, areas);
  res.json({
    ok: true,
    areas: serializeAreas(actualizado?.areas ?? []),
    message: `Áreas definidas · ${areas.map((a) => AREA_LABEL[a]).join(' y ')}`,
  });
});

const extraSchema = z.object({ area: z.enum(AREAS) });

/**
 * Agregar la 3ra área (adicional). Crea el cargo de RD$1,500 pendiente de cobrar
 * en recepción y le asigna sesiones equivalentes a las de un área incluida.
 */
patientsRouter.post('/treatments/:treatmentId/extra-area', requireStaff, requireRole(...areasRoles), async (req, res) => {
  const { area } = extraSchema.parse(req.body);
  const t = await prisma.treatment.findUnique({ where: { id: req.params.treatmentId }, include: { patient: true, areas: true } });
  if (!t) return res.status(404).json({ error: 'Paquete no encontrado' });
  if (!assertBranchAccess(req, t.patient.branchId)) return res.status(403).json({ error: 'Paciente de otra sucursal' });
  if (t.areas.some((a) => a.area === area)) return res.status(409).json({ error: 'Esa área ya está en el paquete' });

  const incluidas = t.areas.filter((a) => !a.isExtra);
  const sesiones = incluidas[0]?.totalSessions ?? Math.max(1, Math.round(t.totalSessions / 2));

  await prisma.treatmentArea.create({
    data: { treatmentId: t.id, area, totalSessions: sesiones, isExtra: true },
  });

  // Queda como cargo pendiente para que recepción lo cobre.
  await prisma.chargeItem.create({
    data: {
      branchId: t.patient.branchId, patientId: t.patientId,
      name: `Área adicional: ${AREA_LABEL[area]} (${t.name})`,
      price: AREA_EXTRA_PRECIO, createdById: req.staff!.sub,
    },
  });

  res.status(201).json({
    ok: true,
    message: `${AREA_LABEL[area]} agregada · RD$${AREA_EXTRA_PRECIO.toLocaleString('en-US')} pendiente de cobrar en recepción`,
  });
});

// ── Importación masiva de pacientes (digitación de fichas de papel) ──
const importSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).max(500),
  branchId: z.string().optional(), // sucursal por defecto si la fila no trae una
  dryRun: z.boolean().optional(),
});

const digits = (s: string) => s.replace(/\D/g, '');

/** Acepta 1990-05-23 y 23/05/1990. Devuelve null si no es una fecha válida. */
function parseBirth(raw?: string): Date | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v);
  let d: Date | null = null;
  if (iso) d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  else if (dmy) d = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  if (!d || Number.isNaN(d.getTime())) return null;
  if (d.getFullYear() < 1900 || d > new Date()) return null;
  return d;
}

/**
 * Carga pacientes en lote desde una hoja de cálculo (solo Admin).
 * Escribe a través de Prisma para que la PII quede CIFRADA (nunca por SQL directo).
 * Con dryRun sólo valida y reporta: no escribe nada.
 */
patientsRouter.post('/import', requireStaff, requireRole('ADMIN', 'RECEPCIONISTA'), async (req, res) => {
  const b = importSchema.parse(req.body);
  // Recepción solo puede cargar en SU sucursal: se ignora la columna "sucursal" del archivo.
  const isAdmin = req.staff!.role === 'ADMIN';
  const forcedBranchId = isAdmin ? null : req.staff!.branchId;
  if (!isAdmin && !forcedBranchId) return res.status(400).json({ error: 'Tu usuario no tiene sucursal asignada' });

  const branches = await prisma.branch.findMany({ select: { id: true, code: true, name: true } });
  const byCode = new Map(branches.map((x) => [x.code.toLowerCase(), x.id]));
  const byName = new Map(branches.map((x) => [x.name.toLowerCase(), x.id]));

  // Teléfonos ya existentes (normalizados) para no duplicar pacientes.
  const existing = await prisma.patient.findMany({ select: { phone: true } });
  const seen = new Set(existing.map((p) => digits(p.phone)).filter(Boolean));

  const colors = ['#B31C86', '#8E1268', '#2C7FB8', '#1F9D6B', '#245E85', '#C9880E'];
  const errors: { line: number; name: string; reason: string }[] = [];
  let created = 0;
  let duplicates = 0;

  for (let i = 0; i < b.rows.length; i++) {
    const r = b.rows[i];
    const line = Number(r.__line) || i + 1;
    const str = (k: string) => String(r[k] ?? '').trim();
    const name = str('name');
    const phone = str('phone');

    if (!name) { errors.push({ line, name: '(sin nombre)', reason: 'Falta el nombre' }); continue; }
    if (!phone) { errors.push({ line, name, reason: 'Falta el teléfono' }); continue; }

    const key = digits(phone);
    if (key.length < 7) { errors.push({ line, name, reason: `Teléfono inválido: ${phone}` }); continue; }
    if (seen.has(key)) { duplicates++; continue; } // ya existe (o repetido en el archivo)

    const rawBranch = str('branch').toLowerCase();
    const branchId = forcedBranchId ?? (rawBranch ? (byCode.get(rawBranch) ?? byName.get(rawBranch)) : b.branchId);
    if (!branchId) { errors.push({ line, name, reason: rawBranch ? `Sucursal no encontrada: ${rawBranch}` : 'Sin sucursal' }); continue; }

    const sexRaw = str('sex').toUpperCase().charAt(0);
    const sex = sexRaw === 'F' || sexRaw === 'M' ? sexRaw : null;
    const birthDate = parseBirth(str('birthDate'));
    const email = str('email') || null;
    const cedula = str('cedula') || null;

    seen.add(key); // evita duplicados dentro del mismo archivo
    if (b.dryRun) { created++; continue; }

    await prisma.patient.create({
      data: {
        branchId, name, phone, email, sex, birthDate,
        age: ageFromBirth(birthDate),
        ...encryptPatientWrite({ cedula, address: null }),
        type: 'NUEVO',
        avatarColor: colors[Math.floor(Math.random() * colors.length)],
        clinicalRecord: { create: { status: 'PENDIENTE' } },
      },
    });
    created++;
  }

  res.json({
    ok: true,
    dryRun: !!b.dryRun,
    created,
    duplicates,
    errors,
    message: b.dryRun
      ? `Simulación: ${created} se cargarían · ${duplicates} duplicados · ${errors.length} con error`
      : `${created} pacientes cargados · ${duplicates} duplicados omitidos · ${errors.length} con error`,
  });
});

const transferSchema = z.object({ branchId: z.string(), note: z.string().optional() });

/**
 * Transferir un paciente a otra sucursal (solo Admin). Mueve al paciente con toda
 * su ficha e historial; opcionalmente deja una nota en el chat de la sucursal destino.
 */
patientsRouter.post('/:id/transfer', requireStaff, requireRole('ADMIN'), async (req, res) => {
  const { branchId, note } = transferSchema.parse(req.body);
  const patient = await prisma.patient.findUnique({ where: { id: req.params.id } });
  if (!patient) return res.status(404).json({ error: 'Paciente no encontrado' });
  const target = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!target) return res.status(404).json({ error: 'Sucursal destino no encontrada' });
  if (patient.branchId === branchId) return res.status(400).json({ error: 'El paciente ya está en esa sucursal' });

  await prisma.patient.update({ where: { id: patient.id }, data: { branchId } });

  // Nota + aviso en el chat de la sucursal destino (etiquetando al paciente).
  const body = note?.trim() || `Paciente transferido a esta sucursal. Revisa su ficha e historial.`;
  await prisma.teamMessage.create({
    data: {
      branchId, senderId: req.staff!.sub, senderName: req.staff!.name, senderRole: req.staff!.role,
      body, patientId: patient.id, patientName: patient.name,
    },
  });
  await notifyRole('RECEPCIONISTA', { type: 'GENERAL', title: 'Paciente transferido', body: `${patient.name} · ${body}`, link: '/app/pacientes' }, branchId);
  await notifyBranchTherapists(branchId, { type: 'GENERAL', title: 'Paciente transferido', body: `${patient.name} llegó por transferencia.`, link: '/app/pacientes' });

  res.json({ ok: true, message: `${patient.name} transferido a ${target.name}` });
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
      id: patient.id, name: patient.name, phone: patient.phone,
      age: ageFromBirth(patient.birthDate) ?? patient.age, email: patient.email,
      sex: patient.sex,
      birthDate: patient.birthDate, occupation: patient.occupation,
      address: patient.address != null ? decrypt(patient.address) : patient.address,
    },
    ficha: decryptClinical(patient.clinicalRecord),
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

  // La edad se calcula automáticamente de la fecha de nacimiento cuando se provee.
  const newBirth = body.birthDate ? new Date(body.birthDate) : patient.birthDate;
  const computedAge = ageFromBirth(newBirth) ?? body.age ?? patient.age;
  await prisma.patient.update({
    where: { id: patient.id },
    data: {
      name: body.name ?? patient.name,
      sex: body.sex ?? patient.sex,
      age: computedAge,
      phone: body.phone ?? patient.phone,
      email: body.email ? body.email : patient.email,
      birthDate: newBirth,
      occupation: body.occupation ?? patient.occupation,
      ...(body.address !== undefined ? encryptPatientWrite({ address: body.address }) : {}),
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
 * Dar ACCESO al portal al paciente (tras presentarse y pagar). Crea/activa su
 * cuenta y le comparte el acceso. NO expone credenciales: el paciente entra con
 * su CORREO + TELÉFONO. Se puede enviar por correo, por WhatsApp o con QR.
 */
patientsRouter.post('/:id/ficha/send-to-patient', requireStaff, requireRole('ADMIN', 'RECEPCIONISTA'), async (req, res) => {
  const patient = await prisma.patient.findUnique({ where: { id: req.params.id }, include: { patientAccount: true, branch: true } });
  if (!patient) return res.status(404).json({ error: 'Paciente no encontrado' });
  if (!assertBranchAccess(req, patient.branchId)) return res.status(403).json({ error: 'Paciente de otra sucursal' });

  // El acceso es por correo + teléfono: ambos son obligatorios.
  if (!patient.email) return res.status(400).json({ error: 'El paciente necesita un correo para acceder al portal (agrégalo en su ficha).' });
  if (!patient.phone) return res.status(400).json({ error: 'El paciente necesita un teléfono para acceder al portal.' });

  // Crea/activa la cuenta (login interno = teléfono; sin contraseña expuesta — el
  // acceso se valida por correo + teléfono). El passwordHash queda como valor no usado.
  if (!patient.patientAccount) {
    const unusedHash = await hashPassword('li' + Math.random().toString(36).slice(2, 12));
    await prisma.patientAccount.create({ data: { patientId: patient.id, login: patient.phone.trim(), passwordHash: unusedHash, active: true } });
  } else if (!patient.patientAccount.active) {
    await prisma.patientAccount.update({ where: { id: patient.patientAccount.id }, data: { active: true } });
  }

  await prisma.clinicalRecord.updateMany({
    where: { patientId: patient.id },
    data: { sentToPatientAt: new Date() },
  });

  const mail = await sendPatientAccess(patient.email, {
    name: patient.name, phone: patient.phone, replyTo: patient.branch.email ?? undefined,
  });

  // Enlace de WhatsApp (wa.me) con el instructivo listo para enviar desde el WhatsApp de recepción.
  const waMsg = `Hola ${patient.name} 👋 Ya tienes acceso a tu portal de Li Estetic Center 💜\n\n` +
    `Entra aquí: ${PORTAL_URL}\nEscribe tu correo (${patient.email}) y tu teléfono (${patient.phone}) y toca "Entrar a mi portal".\n\n¡Te esperamos!`;
  const whatsappUrl = `https://wa.me/${normalizePhone(patient.phone)}?text=${encodeURIComponent(waMsg)}`;

  await notifyBranchTherapists(patient.branchId, {
    type: 'FICHA_SENT',
    title: 'Acceso al portal entregado',
    body: `${patient.name} ya tiene acceso a su portal del paciente.`,
    link: '/app/pacientes',
  });

  res.json({
    ok: true,
    emailSent: mail.sent,
    mailError: mail.error,
    whatsappUrl,
    // El QR codifica solo la URL pública del portal (no credenciales).
    portalUrl: PORTAL_URL,
    message: mail.sent ? `Acceso enviado al correo (${patient.email})` : 'Acceso activado. Compártelo por WhatsApp o QR.',
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
  alturaCm: z.number().int().optional(),
  cinturaCm: z.number().int().optional(),
  abdomenCm: z.number().int().optional(),
  piernaCm: z.number().int().optional(),
  brazoCm: z.number().int().optional(),
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
      ...encryptClinicalWrite(fields),
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
