import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireStaff, requireRole, branchScope, assertBranchAccess } from '../../middleware/auth.js';
import { notifyRole } from '../notifications/notifications.service.js';

export const assetsRouter = Router();

/**
 * Quién registra equipos y suministros: los mismos que gestionan el catálogo.
 * Antes solo ADMIN, así que recepción veía las pestañas pero no podía agregar
 * nada. Borrar sigue siendo exclusivo del administrador.
 */
const GESTORES = ['ADMIN', 'RECEPCIONISTA'] as const;

// Tipos de evento que puede registrar cada rol.
const STAFF_EVENTS = ['AVERIA', 'INCIDENTE', 'NOTA'] as const;
const ADMIN_EVENTS = ['ENTRADA', 'SALIDA', 'MANTENIMIENTO', 'AVERIA', 'INCIDENTE', 'NOTA', 'BAJA'] as const;

const STATUS_LABEL: Record<string, string> = {
  OPERATIVO: 'Operativo', MANTENIMIENTO: 'En mantenimiento', AVERIADO: 'Averiado', BAJA: 'Dado de baja',
};

/** Código legible del activo: EQ-0001 / SU-0001. */
/**
 * Siguiente código libre del tipo (EQ-0001 equipos, SU-0001 suministros).
 * Se calcula sobre el máximo ya usado, no sobre el total: contando filas se
 * repetía el código si alguna se borraba por el medio.
 */
async function nextCode(kind: string) {
  const prefix = kind === 'EQUIPO' ? 'EQ' : 'SU';
  const usados = await prisma.asset.findMany({
    where: { code: { startsWith: `${prefix}-` } }, select: { code: true },
  });
  const max = usados.reduce((m, x) => {
    const n = parseInt((x.code ?? '').slice(prefix.length + 1), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

/**
 * Lista de activos. ?kind=EQUIPO|SUMINISTRO. ?mine=1 = solo los asignados a mí.
 * Admin: por sucursal (?branch) o todas. Personal: su sucursal.
 */
assetsRouter.get('/', requireStaff, branchScope, async (req, res) => {
  const kind = req.query.kind as string | undefined;
  const mine = req.query.mine === '1';
  const where: Record<string, unknown> = { active: true };
  if (kind) where.kind = kind;
  if (req.scopeBranchId) where.branchId = req.scopeBranchId;
  if (mine) where.assignedToId = req.staff!.sub;

  const [assets, users, branches] = await Promise.all([
    prisma.asset.findMany({
      where, include: { assignedTo: { select: { id: true, name: true } }, branch: { select: { name: true } } },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    }),
    req.staff!.role === 'ADMIN' ? prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, role: true, branchId: true } }) : Promise.resolve([]),
    req.staff!.role === 'ADMIN' ? prisma.branch.findMany({ orderBy: { code: 'asc' }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);

  res.json({
    assets: assets.map((a) => ({
      id: a.id, code: a.code, kind: a.kind, name: a.name, category: a.category,
      status: a.status, statusLabel: STATUS_LABEL[a.status] ?? a.status,
      serial: a.serial, notes: a.notes,
      branch: a.branch.name, branchId: a.branchId,
      assignedTo: a.assignedTo ? { id: a.assignedTo.id, name: a.assignedTo.name } : null,
    })),
    users, branches,
  });
});

const createSchema = z.object({
  kind: z.enum(['EQUIPO', 'SUMINISTRO']),
  name: z.string().min(1),
  category: z.string().optional(),
  branchId: z.string().optional(),
  assignedToId: z.string().optional(),
  serial: z.string().optional(),
  notes: z.string().optional(),
});

/** Alta de activo (solo Admin). Registra una ENTRADA en el historial. */
assetsRouter.post('/', requireStaff, requireRole(...GESTORES), branchScope, async (req, res) => {
  const b = createSchema.parse(req.body);
  const branchId = b.branchId ?? req.scopeBranchId;
  if (!branchId) return res.status(400).json({ error: 'Selecciona una sucursal' });

  const asset = await prisma.asset.create({
    data: {
      code: await nextCode(b.kind), kind: b.kind, name: b.name, category: b.category ?? null,
      branchId, assignedToId: b.assignedToId ?? null, serial: b.serial ?? null, notes: b.notes ?? null,
      events: { create: { type: 'ENTRADA', note: 'Alta en inventario', reportedById: req.staff!.sub } },
    },
  });
  res.status(201).json({ ok: true, id: asset.id, code: asset.code, message: `Activo creado · ${asset.code}` });
});

const updateSchema = createSchema.partial().extend({
  status: z.enum(['OPERATIVO', 'MANTENIMIENTO', 'AVERIADO', 'BAJA']).optional(),
});

/** Editar / reasignar / cambiar estado de un activo (solo Admin). */
assetsRouter.patch('/:id', requireStaff, requireRole(...GESTORES), async (req, res) => {
  const b = updateSchema.parse(req.body);
  const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
  if (!asset) return res.status(404).json({ error: 'Activo no encontrado' });

  const data: Record<string, unknown> = {};
  for (const k of ['name', 'category', 'branchId', 'serial', 'notes', 'status'] as const) {
    if (b[k] !== undefined) data[k] = b[k];
  }
  if ('assignedToId' in b) data.assignedToId = b.assignedToId ?? null;
  await prisma.asset.update({ where: { id: asset.id }, data });
  res.json({ ok: true, message: 'Activo actualizado' });
});

/** Baja de un activo (Admin). */
assetsRouter.delete('/:id', requireStaff, requireRole('ADMIN'), async (req, res) => {
  const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
  if (!asset) return res.status(404).json({ error: 'Activo no encontrado' });
  await prisma.asset.update({
    where: { id: asset.id },
    data: { active: false, status: 'BAJA', events: { create: { type: 'BAJA', note: 'Dado de baja', reportedById: req.staff!.sub } } },
  });
  res.json({ ok: true, message: 'Activo dado de baja' });
});

const eventSchema = z.object({
  type: z.enum(ADMIN_EVENTS),
  note: z.string().optional(),
  cost: z.number().int().nonnegative().optional(),
  newStatus: z.enum(['OPERATIVO', 'MANTENIMIENTO', 'AVERIADO', 'BAJA']).optional(),
});

/**
 * Registra un evento en el historial del activo.
 * - Personal: solo AVERIA / INCIDENTE / NOTA (en activos de su sucursal). Avisa al admin.
 * - Admin: cualquier evento, con costo y cambio de estado.
 */
assetsRouter.post('/:id/event', requireStaff, async (req, res) => {
  const b = eventSchema.parse(req.body);
  const isAdmin = req.staff!.role === 'ADMIN';
  const asset = await prisma.asset.findUnique({ where: { id: req.params.id }, include: { branch: { select: { name: true } } } });
  if (!asset) return res.status(404).json({ error: 'Activo no encontrado' });

  if (!isAdmin) {
    if (!assertBranchAccess(req, asset.branchId)) return res.status(403).json({ error: 'Activo de otra sucursal' });
    if (!STAFF_EVENTS.includes(b.type as never)) return res.status(403).json({ error: 'Solo puedes reportar averías, incidentes o notas' });
  }

  // Estado resultante: admin puede fijarlo; una avería marca AVERIADO automáticamente.
  const newStatus = isAdmin ? b.newStatus : b.type === 'AVERIA' ? 'AVERIADO' : undefined;

  await prisma.asset.update({
    where: { id: asset.id },
    data: {
      ...(newStatus ? { status: newStatus } : {}),
      events: { create: { type: b.type, note: b.note ?? null, cost: b.cost ?? null, reportedById: req.staff!.sub } },
    },
  });

  // Reporte del personal → aviso al admin.
  if (!isAdmin && (b.type === 'AVERIA' || b.type === 'INCIDENTE')) {
    await notifyRole('ADMIN', {
      type: 'GENERAL',
      title: `${b.type === 'AVERIA' ? 'Avería' : 'Incidente'} reportado · ${asset.name}`,
      body: `${req.staff!.name} (${asset.branch.name}) reportó ${b.type === 'AVERIA' ? 'una avería' : 'un incidente'} en ${asset.code} · ${asset.name}${b.note ? `: ${b.note}` : ''}.`,
      link: '/app/inventario',
    });
  }

  res.status(201).json({ ok: true, message: 'Registrado en el historial' });
});

/** Historial de un activo. */
assetsRouter.get('/:id/events', requireStaff, branchScope, async (req, res) => {
  const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
  if (!asset) return res.status(404).json({ error: 'Activo no encontrado' });
  if (req.staff!.role !== 'ADMIN' && !assertBranchAccess(req, asset.branchId)) {
    return res.status(403).json({ error: 'Activo de otra sucursal' });
  }
  const events = await prisma.assetEvent.findMany({
    where: { assetId: asset.id }, include: { reportedBy: { select: { name: true } } },
    orderBy: { createdAt: 'desc' }, take: 50,
  });
  res.json(events.map((e) => ({
    id: e.id, type: e.type, note: e.note, cost: e.cost,
    by: e.reportedBy?.name ?? '—',
    date: e.createdAt.toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
  })));
});
