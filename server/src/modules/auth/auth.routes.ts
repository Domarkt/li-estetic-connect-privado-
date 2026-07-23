import { Router } from 'express';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { verifyPassword, hashPassword } from '../../utils/password.js';
import { signStaff, signPatient } from '../../utils/jwt.js';
import { requireStaff, requirePatient } from '../../middleware/auth.js';
import { sendPatientOtp } from '../mail/mail.service.js';
import { whatsappConfigured, sendWhatsAppText } from '../messaging/whatsapp.service.js';
import { audit } from '../audit/audit.service.js';

export const authRouter = Router();

const staffLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  // rol y sucursal seleccionados en el login interno (validados contra el usuario)
  role: z.enum(['ADMIN', 'RECEPCIONISTA', 'ESTETICISTA']).optional(),
  branchId: z.string().optional(),
});

/** Login interno de personal: rol + sucursal. */
authRouter.post('/staff/login', async (req, res) => {
  const { email, password, role, branchId } = staffLoginSchema.parse(req.body);

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { branch: true },
  });
  if (!user || !user.active) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

  // El rol elegido en pantalla debe coincidir con el rol real del usuario.
  if (role && role !== user.role) {
    return res.status(403).json({ error: 'El rol seleccionado no coincide con tu cuenta' });
  }
  // Personal de sucursal: la sucursal elegida debe ser la suya.
  if (user.role !== 'ADMIN' && branchId && branchId !== user.branchId) {
    return res.status(403).json({ error: 'No perteneces a la sucursal seleccionada' });
  }

  const token = signStaff({
    sub: user.id,
    role: user.role,
    branchId: user.branchId,
    name: user.name,
  });

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      branchId: user.branchId,
      branch: user.branch
        ? { id: user.branch.id, code: user.branch.code, name: user.branch.name, place: user.branch.place, dotColor: user.branch.dotColor }
        : null,
      avatarColor: user.avatarColor,
      canManageCatalog: user.canManageCatalog,
    },
  });
});

/** Perfil del personal autenticado. */
authRouter.get('/staff/me', requireStaff, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.staff!.sub },
    include: { branch: true },
  });
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    branchId: user.branchId,
    branch: user.branch
      ? { id: user.branch.id, code: user.branch.code, name: user.branch.name, place: user.branch.place, dotColor: user.branch.dotColor }
      : null,
    avatarColor: user.avatarColor,
    canManageCatalog: user.canManageCatalog,
  });
});

const patientLoginSchema = z.object({
  email: z.string().email(),
  phone: z.string().min(1),
});
const patientVerifySchema = patientLoginSchema.extend({
  code: z.string().regex(/^\d{6}$/, 'El código son 6 dígitos'),
});

// Vida y tolerancia del código de acceso.
const OTP_MINUTOS = 10;
const OTP_MAX_INTENTOS = 5;
const OTP_REENVIO_SEG = 60; // evita spamear el correo del paciente

/** Mensaje único para no revelar si un correo/teléfono existe en el sistema. */
const OTP_AMBIGUO = 'Si esos datos corresponden a un paciente registrado, te enviamos un código.';

/** Busca al paciente por correo + teléfono (los dígitos, porque el formato varía). */
async function buscarPacientePortal(email: string, phone: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const phoneDigits = phone.replace(/\D/g, '');
  const candidates = await prisma.patient.findMany({
    where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
    include: { patientAccount: true, branch: true },
  });
  return candidates.find(
    (p) => (p.phone || '').replace(/\D/g, '') === phoneDigits && p.patientAccount?.active,
  ) ?? null;
}

/**
 * Paso 1 del acceso al portal: pedir el código.
 *
 * Antes se entraba solo con correo + teléfono, pero esos datos los puede conocer
 * un tercero y detrás está la ficha clínica. Ahora esos datos solo identifican;
 * lo que autentica es un código de 6 dígitos enviado al paciente, válido
 * 10 minutos y de un solo uso.
 *
 * La respuesta es siempre la misma exista o no el paciente, para no filtrar
 * quién es cliente de la estética.
 */
authRouter.post('/patient/request-code', async (req, res) => {
  const { email, phone } = patientLoginSchema.parse(req.body);
  const patient = await buscarPacientePortal(email, phone);
  if (!patient?.patientAccount) return res.json({ ok: true, message: OTP_AMBIGUO });

  // No reenviar en ráfaga (protege el buzón del paciente y nuestra cuota de correo).
  const cuenta = patient.patientAccount;
  if (cuenta.otpSentAt && Date.now() - cuenta.otpSentAt.getTime() < OTP_REENVIO_SEG * 1000) {
    return res.json({ ok: true, message: OTP_AMBIGUO });
  }

  // 6 dígitos aleatorios; se guarda solo el hash (nunca el código en claro).
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await prisma.patientAccount.update({
    where: { id: cuenta.id },
    data: {
      otpHash: await hashPassword(code),
      otpExpiresAt: new Date(Date.now() + OTP_MINUTOS * 60_000),
      otpAttempts: 0,
      otpSentAt: new Date(),
    },
  });

  // Se envía por correo y, si el WhatsApp Cloud está configurado, también por ahí.
  const destino = (patient.email ?? '').trim();
  if (destino) {
    await sendPatientOtp(destino, {
      name: patient.name, code, minutes: OTP_MINUTOS,
      replyTo: patient.branch?.email ?? undefined,
    }).catch(() => undefined);
  }
  try {
    if (await whatsappConfigured()) {
      await sendWhatsAppText(patient.phone, `Tu código para entrar a tu portal de Li Estetic Center es ${code}. Vence en ${OTP_MINUTOS} minutos. No lo compartas con nadie.`);
    }
  } catch { /* el correo ya cubre el envío */ }

  res.json({ ok: true, message: OTP_AMBIGUO });
});

/**
 * Paso 2: verificar el código y entregar el token.
 * El código se invalida siempre que se use (bien o mal, tras agotar intentos).
 */
authRouter.post('/patient/verify-code', async (req, res) => {
  const { email, phone, code } = patientVerifySchema.parse(req.body);
  const patient = await buscarPacientePortal(email, phone);
  const cuenta = patient?.patientAccount;
  const invalido = () => res.status(401).json({ error: 'Código incorrecto o vencido. Pide uno nuevo.' });

  if (!patient || !cuenta?.otpHash || !cuenta.otpExpiresAt) return invalido();
  if (cuenta.otpExpiresAt.getTime() < Date.now()) return invalido();
  if (cuenta.otpAttempts >= OTP_MAX_INTENTOS) {
    // Quema el código: hay que pedir uno nuevo.
    await prisma.patientAccount.update({ where: { id: cuenta.id }, data: { otpHash: null, otpExpiresAt: null } });
    return invalido();
  }

  const ok = await verifyPassword(code, cuenta.otpHash);
  if (!ok) {
    await prisma.patientAccount.update({ where: { id: cuenta.id }, data: { otpAttempts: { increment: 1 } } });
    return invalido();
  }

  // Correcto: el código se consume (un solo uso).
  await prisma.patientAccount.update({
    where: { id: cuenta.id },
    data: { otpHash: null, otpExpiresAt: null, otpAttempts: 0 },
  });

  const token = signPatient({ sub: cuenta.id, patientId: patient.id, name: patient.name });
  await audit(req, {
    action: 'PORTAL_LOGIN', entity: 'Patient', entityId: patient.id,
    summary: `${patient.name} entró a su portal`, branchId: patient.branchId,
  });

  res.json({
    token,
    patient: {
      id: patient.id,
      name: patient.name,
      phone: patient.phone,
      branch: patient.branch ? { name: patient.branch.name, place: patient.branch.place } : null,
    },
  });
});

/** Perfil del paciente autenticado. */
authRouter.get('/patient/me', requirePatient, async (req, res) => {
  const patient = await prisma.patient.findUnique({
    where: { id: req.patient!.patientId },
    include: { branch: true },
  });
  if (!patient) return res.status(404).json({ error: 'Paciente no encontrado' });
  res.json({
    id: patient.id,
    name: patient.name,
    phone: patient.phone,
    branch: patient.branch ? { name: patient.branch.name, place: patient.branch.place } : null,
  });
});
