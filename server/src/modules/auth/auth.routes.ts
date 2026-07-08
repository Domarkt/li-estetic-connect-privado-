import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { verifyPassword } from '../../utils/password.js';
import { signStaff, signPatient } from '../../utils/jwt.js';
import { requireStaff, requirePatient } from '../../middleware/auth.js';

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
  });
});

const patientLoginSchema = z.object({
  login: z.string().min(1), // celular o cédula
  password: z.string().min(1),
});

/** Login externo del paciente (portal separado). */
authRouter.post('/patient/login', async (req, res) => {
  const { login, password } = patientLoginSchema.parse(req.body);
  const normalized = login.trim();

  const account = await prisma.patientAccount.findUnique({
    where: { login: normalized },
    include: { patient: { include: { branch: true } } },
  });
  if (!account || !account.active) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }
  const ok = await verifyPassword(password, account.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

  const token = signPatient({
    sub: account.id,
    patientId: account.patientId,
    name: account.patient.name,
  });

  res.json({
    token,
    patient: {
      id: account.patient.id,
      name: account.patient.name,
      phone: account.patient.phone,
      branch: account.patient.branch
        ? { name: account.patient.branch.name, place: account.patient.branch.place }
        : null,
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
