import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireStaff } from '../../middleware/auth.js';

export const catalogRouter = Router();

/**
 * Puede gestionar el catálogo: el administrador y cualquier colaborador con el
 * permiso "canManageCatalog" activado desde Equipo.
 *
 * TEMPORAL (fase de carga de datos): también RECEPCIONISTA, para que las tres
 * estéticas avancen creando servicios, paquetes, combos e inventario. Cuando la
 * base esté cargada, basta con quitar 'RECEPCIONISTA' de esta lista y el permiso
 * vuelve a concederse solo por persona.
 */
const ROLES_CATALOGO = ['ADMIN', 'RECEPCIONISTA'];

async function requireCatalogManager(req: Request, res: Response, next: NextFunction) {
  if (ROLES_CATALOGO.includes(req.staff!.role)) return next();
  const u = await prisma.user.findUnique({ where: { id: req.staff!.sub }, select: { canManageCatalog: true } });
  if (u?.canManageCatalog) return next();
  return res.status(403).json({ error: 'No tienes permiso para gestionar el catálogo' });
}

/** Serializa un ítem incluyendo, si es combo/paquete, las técnicas que cubre (con su cantidad). */
const conServicios = { incluye: { include: { service: true } } } as const;
type ItemConServicios = { incluye?: { qty: number; service: { id: string; name: string } }[] };
const serialize = <T extends ItemConServicios>(i: T) => ({
  ...i,
  incluye: undefined,
  services: (i.incluye ?? []).map((x) => ({ id: x.service.id, name: x.service.name, qty: x.qty })),
});

/** Lista del catálogo, opcionalmente filtrada por tipo (?kind=SERVICIO...). */
catalogRouter.get('/', requireStaff, async (req, res) => {
  const kind = req.query.kind as string | undefined;
  const items = await prisma.catalogItem.findMany({
    where: { active: true, ...(kind ? { kind: kind as never } : {}) },
    orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    include: conServicios,
  });
  res.json(items.map(serialize));
});

const catalogSchema = z.object({
  kind: z.enum(['SERVICIO', 'PAQUETE', 'COMBO', 'PRODUCTO', 'INSUMO']),
  code: z.string().trim().optional(), // código/SKU
  showInPortal: z.boolean().optional(), // visible en el portal del paciente
  name: z.string().min(1),
  // Precio opcional: la directora crea combos a diario y define el monto al cobrar. 0 = sin precio.
  price: z.number().int().nonnegative().optional().default(0),
  sessions: z.number().int().positive().default(1),
  category: z.string().optional(),
  unit: z.string().optional(),
  tag: z.string().optional(),
  // Combos/paquetes: familia de áreas para el selector (o null si no aplica).
  areaGroup: z.enum(['CORPORAL', 'LASER']).nullish(),
  // Áreas que trae el combo por defecto (se cargan al venderlo al paciente).
  defaultAreas: z.array(z.string()).optional(),
  // Técnicas que incluye un combo/paquete, cada una con su cantidad (ej. 18 cavitaciones).
  services: z.array(z.object({ id: z.string(), qty: z.number().int().positive().default(1) })).optional(),
});

/** Alta de ítem al catálogo (Admin o quien tenga permiso de catálogo). */
catalogRouter.post('/', requireStaff, requireCatalogManager, async (req, res) => {
  const { services, ...data } = catalogSchema.parse(req.body);
  const item = await prisma.catalogItem.create({
    data: {
      ...data,
      ...(services?.length ? { incluye: { create: services.map((s) => ({ serviceId: s.id, qty: s.qty })) } } : {}),
    },
    include: conServicios,
  });
  res.status(201).json(serialize(item));
});

const updateSchema = catalogSchema.partial();

/** Editar un ítem del catálogo (Admin o quien tenga permiso de catálogo). */
catalogRouter.patch('/:id', requireStaff, requireCatalogManager, async (req, res) => {
  const { services, ...data } = updateSchema.parse(req.body);
  const exists = await prisma.catalogItem.findUnique({ where: { id: req.params.id } });
  if (!exists) return res.status(404).json({ error: 'Ítem no encontrado' });

  // Las técnicas se reemplazan por completo cuando se envían (con su cantidad).
  if (services) {
    await prisma.comboService.deleteMany({ where: { comboId: exists.id } });
    if (services.length) {
      await prisma.comboService.createMany({
        data: services.map((s) => ({ comboId: exists.id, serviceId: s.id, qty: s.qty })),
        skipDuplicates: true,
      });
    }
  }

  const item = await prisma.catalogItem.update({ where: { id: req.params.id }, data, include: conServicios });
  res.json(serialize(item));
});

// ── Áreas del cuerpo (administrable): las usan los combos/paquetes al asignarlas ──
/** Lista de áreas activas, agrupadas Corporal/Láser. */
catalogRouter.get('/body-areas', requireStaff, async (_req, res) => {
  const areas = await prisma.bodyArea.findMany({ where: { active: true }, orderBy: [{ grupo: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }] });
  res.json(areas.map((a) => ({ key: a.key, label: a.label, grupo: a.grupo })));
});

const areaSchema = z.object({
  label: z.string().trim().min(1),
  grupo: z.enum(['CORPORAL', 'LASER']),
});

/** Agregar una área nueva (Admin o quien gestiona catálogo). La clave se deriva del nombre. */
catalogRouter.post('/body-areas', requireStaff, requireCatalogManager, async (req, res) => {
  const b = areaSchema.parse(req.body);
  const key = b.label.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, '_').replace(/(^_|_$)/g, '');
  if (!key) return res.status(400).json({ error: 'Nombre de área inválido' });
  const exists = await prisma.bodyArea.findUnique({ where: { key } });
  if (exists) {
    if (!exists.active) await prisma.bodyArea.update({ where: { key }, data: { active: true, label: b.label, grupo: b.grupo } });
    else return res.status(409).json({ error: 'Ya existe un área con ese nombre' });
  } else {
    const max = await prisma.bodyArea.aggregate({ _max: { sortOrder: true } });
    await prisma.bodyArea.create({ data: { key, label: b.label, grupo: b.grupo, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
  }
  res.status(201).json({ ok: true, message: `Área "${b.label}" agregada` });
});

/** Quitar una área (baja lógica; no borra el historial que ya la usa). */
catalogRouter.delete('/body-areas/:key', requireStaff, requireCatalogManager, async (req, res) => {
  const a = await prisma.bodyArea.findUnique({ where: { key: req.params.key } });
  if (!a) return res.status(404).json({ error: 'Área no encontrada' });
  await prisma.bodyArea.update({ where: { key: a.key }, data: { active: false } });
  res.json({ ok: true, message: `Área "${a.label}" retirada` });
});

/** Eliminar un ítem del catálogo (baja lógica; Admin o quien tenga permiso de catálogo). */
catalogRouter.delete('/:id', requireStaff, requireCatalogManager, async (req, res) => {
  const exists = await prisma.catalogItem.findUnique({ where: { id: req.params.id } });
  if (!exists) return res.status(404).json({ error: 'Ítem no encontrado' });
  await prisma.catalogItem.update({ where: { id: req.params.id }, data: { active: false } });
  res.json({ ok: true, message: 'Elemento eliminado del catálogo' });
});
