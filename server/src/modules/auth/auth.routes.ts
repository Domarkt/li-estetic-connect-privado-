import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { verifyPassword } from '../../utils/password.js';
import { signStaff, signPatient } from '../../utils/jwt.js';
import { requireStaff, requirePatient } from '../../middleware/auth.js';
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
  password: z.string().min(1, 'Escribe tu contraseña'),
});

/**
 * Login del paciente en su portal: correo + contraseña.
 *
 * La contraseña inicial es su número de teléfono (el que registró la estética) y
 * puede cambiarla desde su perfil por una propia. Se guarda con bcrypt, nunca en
 * claro. Se probó el acceso por código de un solo uso, pero le complicaba la
 * entrada a las pacientes.
 */
authRouter.post('/patient/login', async (req, res) => {
  const { email, password } = patientLoginSchema.parse(req.body);
  const normalizedEmail = email.trim().toLowerCase();

  const candidatos = await prisma.patient.findMany({
    where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
    include: { patientAccount: true, branch: true },
  });

  // Mensaje único: no se revela si el correo existe ni si la cuenta está activa.
  const invalido = () => res.status(401).json({
    error: 'Correo o contraseña incorrectos. Si es tu primera vez, tu contraseña es tu número de teléfono.',
  });

  for (const patient of candidatos) {
    const cuenta = patient.patientAccount;
    if (!cuenta?.active) continue;
    if (!(await verifyPassword(password, cuenta.passwordHash))) continue;

    const token = signPatient({ sub: cuenta.id, patientId: patient.id, name: patient.name });
    await audit(req, {
      action: 'PORTAL_LOGIN', entity: 'Patient', entityId: patient.id,
      summary: `${patient.name} entró a su portal`, branchId: patient.branchId,
    });
    // Se le avisa si aún usa su teléfono como contraseña, para que la cambie.
    const usandoTelefono = await verifyPassword((patient.phone || '').replace(/\D/g, ''), cuenta.passwordHash);
    return res.json({
      token,
      debeCambiarClave: usandoTelefono,
      patient: {
        id: patient.id,
        name: patient.name,
        phone: patient.phone,
        branch: patient.branch ? { name: patient.branch.name, place: patient.branch.place } : null,
      },
    });
  }

  return invalido();
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
