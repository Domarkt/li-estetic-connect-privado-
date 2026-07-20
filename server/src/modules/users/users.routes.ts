import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireStaff, requireRole, branchScope } from '../../middleware/auth.js';
import { hashPassword } from '../../utils/password.js';
import { commissionFor } from '../points/points.service.js';
import { isBaseAdmin } from '../../config/baseAccounts.js';

export const usersRouter = Router();

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Administradora', RECEPCIONISTA: 'Recepcionista', ESTETICISTA: 'Esteticista',
};
const AVATAR_COLORS = ['#B31C86', '#8E1268', '#2C7FB8', '#1F9D6B', '#245E85', '#C9880E', '#17805A'];

/** Esteticistas disponibles (aisladas por sucursal) para asignar en la agenda. */
usersRouter.get('/therapists', requireStaff, branchScope, async (req, res) => {
  const therapists = await prisma.user.findMany({
    where: { role: 'ESTETICISTA', active: true, ...(req.scopeBranchId ? { branchId: req.scopeBranchId } : {}) },
    select: { id: true, name: true, branchId: true, avatarColor: true },
    orderBy: { name: 'asc' },
  });
  res.json(therapists);
});

/** Equipo (Admin): colaboradoras con desempeño + usuarios del sistema. */
usersRouter.get('/team', requireStaff, requireRole('ADMIN'), branchScope, async (req, res) => {
  const where = req.scopeBranchId ? { branchId: req.scopeBranchId } : {};
  const users = await prisma.user.findMany({
    where, include: { branch: true, therapistProfile: true }, orderBy: { createdAt: 'asc' },
  });

  const collaborators = users
    .filter((u) => u.role === 'ESTETICISTA')
    .map((u) => {
      const points = u.therapistProfile?.points ?? 0;
      const sales = u.therapistProfile?.monthSales ?? 0;
      const comm = commissionFor(sales, points);
      return {
        id: u.id, name: u.name, role: ROLE_LABEL[u.role], branch: u.branch?.name ?? '—',
        avatarColor: u.avatarColor, points, sales, commission: comm.total,
        attendance: '98%', // placeholder de asistencia (se integra con control real luego)
      };
    })
    .sort((a, b) => b.points - a.points);

  const systemUsers = users.map((u) => ({
    id: u.id, name: u.name, email: u.email, role: ROLE_LABEL[u.role], roleKey: u.role,
    branch: u.branch?.name ?? 'Todas', branchId: u.branchId, avatarColor: u.avatarColor, active: u.active,
    canManageCatalog: u.canManageCatalog,
    // Correo base de Domarkt: no se puede eliminar ni desactivar desde aquí.
    protected: isBaseAdmin(u.email),
  }));

  res.json({ collaborators, systemUsers });
});

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
  role: z.enum(['ADMIN', 'RECEPCIONISTA', 'ESTETICISTA']),
  branchId: z.string().nullish(),
  canManageCatalog: z.boolean().optional(),
});

/** Crear colaborador (Admin): asigna correo + contraseña de acceso al sistema. */
usersRouter.post('/', requireStaff, requireRole('ADMIN'), async (req, res) => {
  const b = createSchema.parse(req.body);
  const email = b.email.toLowerCase();

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return res.status(409).json({ error: 'Ya existe un usuario con ese correo' });

  // Recepción/Esteticista requieren sucursal; Admin ve todas (branchId null).
  const branchId = b.role === 'ADMIN' ? null : b.branchId ?? null;
  if (b.role !== 'ADMIN' && !branchId) return res.status(400).json({ error: 'Selecciona una sucursal' });

  const user = await prisma.user.create({
    data: {
      name: b.name, email, passwordHash: await hashPassword(b.password), role: b.role, branchId,
      canManageCatalog: b.canManageCatalog ?? false,
      avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
      ...(b.role === 'ESTETICISTA' ? { therapistProfile: { create: {} } } : {}),
    },
    include: { branch: true },
  });

  res.status(201).json({
    ok: true,
    message: `Colaborador creado · credenciales de acceso asignadas (${email})`,
    user: { id: user.id, name: user.name, email: user.email, role: ROLE_LABEL[user.role], branch: user.branch?.name ?? 'Todas' },
  });
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  role: z.enum(['ADMIN', 'RECEPCIONISTA', 'ESTETICISTA']).optional(),
  branchId: z.string().nullish(),
  active: z.boolean().optional(),
  canManageCatalog: z.boolean().optional(),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').optional(),
});

/** Actualizar colaborador: nombre, correo, rol, sucursal, estado o contraseña (Admin). */
usersRouter.patch('/:id', requireStaff, requireRole('ADMIN'), async (req, res) => {
  const b = updateSchema.parse(req.body);
  const current = await prisma.user.findUnique({ where: { id: req.params.id }, include: { therapistProfile: true } });
  if (!current) return res.status(404).json({ error: 'Usuario no encontrado' });

  // Los correos base de Domarkt no se pueden desactivar ni cambiar de correo/rol de admin.
  if (isBaseAdmin(current.email)) {
    if (b.active === false) return res.status(400).json({ error: 'Este es un correo base del sistema y no se puede desactivar' });
    if (b.email !== undefined && b.email.toLowerCase() !== current.email) return res.status(400).json({ error: 'No se puede cambiar el correo de una cuenta base del sistema' });
    if (b.role !== undefined && b.role !== 'ADMIN') return res.status(400).json({ error: 'Una cuenta base del sistema debe seguir siendo administrador' });
  }

  const data: Record<string, unknown> = {};
  if (b.name !== undefined) data.name = b.name.trim();
  if (b.email !== undefined) {
    const email = b.email.toLowerCase();
    if (email !== current.email) {
      const clash = await prisma.user.findUnique({ where: { email } });
      if (clash) return res.status(409).json({ error: 'Ya existe un usuario con ese correo' });
    }
    data.email = email;
  }
  if (b.active !== undefined) data.active = b.active;
  if (b.canManageCatalog !== undefined) data.canManageCatalog = b.canManageCatalog;
  if (b.password) data.passwordHash = await hashPassword(b.password);

  const role = b.role ?? current.role;
  if (b.role !== undefined) data.role = b.role;
  if (b.role !== undefined || b.branchId !== undefined) {
    // ADMIN ve todas (branchId null); Recepción/Esteticista requieren sucursal.
    const branchId = role === 'ADMIN' ? null : (b.branchId ?? current.branchId);
    if (role !== 'ADMIN' && !branchId) return res.status(400).json({ error: 'Selecciona una sucursal' });
    data.branchId = branchId;
  }
  // Al volverse esteticista se crea su perfil de desempeño si aún no existe.
  if (role === 'ESTETICISTA' && !current.therapistProfile) {
    data.therapistProfile = { create: {} };
  }

  const user = await prisma.user.update({ where: { id: req.params.id }, data });
  res.json({ ok: true, id: user.id, active: user.active, message: b.password ? 'Contraseña actualizada' : 'Usuario actualizado' });
});

/** Eliminar colaborador (Admin). Historial (citas/facturas) se conserva sin vínculo. */
usersRouter.delete('/:id', requireStaff, requireRole('ADMIN'), async (req, res) => {
  if (req.params.id === req.staff!.sub) return res.status(400).json({ error: 'No puedes eliminar tu propio usuario' });
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (isBaseAdmin(target.email)) return res.status(400).json({ error: 'Este es un correo base del sistema y no se puede eliminar' });
  if (target.role === 'ADMIN') {
    const admins = await prisma.user.count({ where: { role: 'ADMIN', active: true } });
    if (admins <= 1) return res.status(400).json({ error: 'Debe quedar al menos un administrador activo' });
  }
  await prisma.user.delete({ where: { id: req.params.id } });
  res.json({ ok: true, message: 'Usuario eliminado' });
});
