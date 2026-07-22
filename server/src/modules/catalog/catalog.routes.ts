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

/** Serializa un ítem incluyendo, si es combo/paquete, las técnicas que cubre. */
const conServicios = { incluye: { include: { service: true } } } as const;
type ItemConServicios = { incluye?: { service: { id: string; name: string } }[] };
const serialize = <T extends ItemConServicios>(i: T) => ({
  ...i,
  incluye: undefined,
  services: (i.incluye ?? []).map((x) => ({ id: x.service.id, name: x.service.name })),
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
  // Técnicas que incluye un combo/paquete (ids de ítems SERVICIO del catálogo).
  serviceIds: z.array(z.string()).optional(),
});

/** Alta de ítem al catálogo (Admin o quien tenga permiso de catálogo). */
catalogRouter.post('/', requireStaff, requireCatalogManager, async (req, res) => {
  const { serviceIds, ...data } = catalogSchema.parse(req.body);
  const item = await prisma.catalogItem.create({
    data: {
      ...data,
      ...(serviceIds?.length ? { incluye: { create: serviceIds.map((serviceId) => ({ serviceId })) } } : {}),
    },
    include: conServicios,
  });
  res.status(201).json(serialize(item));
});

const updateSchema = catalogSchema.partial();

/** Editar un ítem del catálogo (Admin o quien tenga permiso de catálogo). */
catalogRouter.patch('/:id', requireStaff, requireCatalogManager, async (req, res) => {
  const { serviceIds, ...data } = updateSchema.parse(req.body);
  const exists = await prisma.catalogItem.findUnique({ where: { id: req.params.id } });
  if (!exists) return res.status(404).json({ error: 'Ítem no encontrado' });

  // Las técnicas se reemplazan por completo cuando se envían.
  if (serviceIds) {
    await prisma.comboService.deleteMany({ where: { comboId: exists.id } });
    if (serviceIds.length) {
      await prisma.comboService.createMany({
        data: serviceIds.map((serviceId) => ({ comboId: exists.id, serviceId })),
        skipDuplicates: true,
      });
    }
  }

  const item = await prisma.catalogItem.update({ where: { id: req.params.id }, data, include: conServicios });
  res.json(serialize(item));
});

/** Eliminar un ítem del catálogo (baja lógica; Admin o quien tenga permiso de catálogo). */
catalogRouter.delete('/:id', requireStaff, requireCatalogManager, async (req, res) => {
  const exists = await prisma.catalogItem.findUnique({ where: { id: req.params.id } });
  if (!exists) return res.status(404).json({ error: 'Ítem no encontrado' });
  await prisma.catalogItem.update({ where: { id: req.params.id }, data: { active: false } });
  res.json({ ok: true, message: 'Elemento eliminado del catálogo' });
});
