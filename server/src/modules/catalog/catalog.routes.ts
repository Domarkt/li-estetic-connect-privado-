import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireStaff, requireRole } from '../../middleware/auth.js';

export const catalogRouter = Router();

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
  price: z.number().int().nonnegative(),
  sessions: z.number().int().positive().default(1),
  category: z.string().optional(),
  unit: z.string().optional(),
  tag: z.string().optional(),
});

/** Alta de ítem al catálogo (solo Admin). */
catalogRouter.post('/', requireStaff, requireRole('ADMIN'), async (req, res) => {
  const data = catalogSchema.parse(req.body);
  const item = await prisma.catalogItem.create({ data });
  res.status(201).json(item);
});

const updateSchema = catalogSchema.partial();

/** Editar un ítem del catálogo (solo Admin). */
catalogRouter.patch('/:id', requireStaff, requireRole('ADMIN'), async (req, res) => {
  const data = updateSchema.parse(req.body);
  const exists = await prisma.catalogItem.findUnique({ where: { id: req.params.id } });
  if (!exists) return res.status(404).json({ error: 'Ítem no encontrado' });
  const item = await prisma.catalogItem.update({ where: { id: req.params.id }, data });
  res.json(item);
});

/** Eliminar un ítem del catálogo (baja lógica: deja de mostrarse; solo Admin). */
catalogRouter.delete('/:id', requireStaff, requireRole('ADMIN'), async (req, res) => {
  const exists = await prisma.catalogItem.findUnique({ where: { id: req.params.id } });
  if (!exists) return res.status(404).json({ error: 'Ítem no encontrado' });
  await prisma.catalogItem.update({ where: { id: req.params.id }, data: { active: false } });
  res.json({ ok: true, message: 'Elemento eliminado del catálogo' });
});
