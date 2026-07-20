import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireStaff } from '../../middleware/auth.js';

export const catalogRouter = Router();

/**
 * Puede gestionar el catálogo: el administrador, o cualquier colaborador con el
 * permiso "canManageCatalog" activado desde Equipo. El catálogo es global (afecta
 * a las 3 sucursales), por eso el permiso se concede por persona, no por rol.
 */
async function requireCatalogManager(req: Request, res: Response, next: NextFunction) {
  if (req.staff!.role === 'ADMIN') return next();
  const u = await prisma.user.findUnique({ where: { id: req.staff!.sub }, select: { canManageCatalog: true } });
  if (u?.canManageCatalog) return next();
  return res.status(403).json({ error: 'No tienes permiso para gestionar el catálogo' });
}

/** Lista del catálogo, opcionalmente filtrada por tipo (?kind=SERVICIO...). */
catalogRouter.get('/', requireStaff, async (req, res) => {
  const kind = req.query.kind as string | undefined;
  const items = await prisma.catalogItem.findMany({
    where: { active: true, ...(kind ? { kind: kind as never } : {}) },
    orderBy: [{ kind: 'asc' }, { name: 'asc' }],
  });
  res.json(items);
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
});

/** Alta de ítem al catálogo (Admin o quien tenga permiso de catálogo). */
catalogRouter.post('/', requireStaff, requireCatalogManager, async (req, res) => {
  const data = catalogSchema.parse(req.body);
  const item = await prisma.catalogItem.create({ data });
  res.status(201).json(item);
});

const updateSchema = catalogSchema.partial();

/** Editar un ítem del catálogo (Admin o quien tenga permiso de catálogo). */
catalogRouter.patch('/:id', requireStaff, requireCatalogManager, async (req, res) => {
  const data = updateSchema.parse(req.body);
  const exists = await prisma.catalogItem.findUnique({ where: { id: req.params.id } });
  if (!exists) return res.status(404).json({ error: 'Ítem no encontrado' });
  const item = await prisma.catalogItem.update({ where: { id: req.params.id }, data });
  res.json(item);
});

/** Eliminar un ítem del catálogo (baja lógica; Admin o quien tenga permiso de catálogo). */
catalogRouter.delete('/:id', requireStaff, requireCatalogManager, async (req, res) => {
  const exists = await prisma.catalogItem.findUnique({ where: { id: req.params.id } });
  if (!exists) return res.status(404).json({ error: 'Ítem no encontrado' });
  await prisma.catalogItem.update({ where: { id: req.params.id }, data: { active: false } });
  res.json({ ok: true, message: 'Elemento eliminado del catálogo' });
});
