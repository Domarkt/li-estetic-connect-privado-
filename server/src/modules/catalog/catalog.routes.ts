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
  kind: z.enum(['SERVICIO', 'PAQUETE', 'COMBO', 'PRODUCTO']),
  name: z.string().min(1),
  price: z.number().int().nonnegative(),
  sessions: z.number().int().positive().default(1),
  category: z.string().optional(),
  stock: z.number().int().optional(),
  tag: z.string().optional(),
});

/** Alta de ítem al catálogo (solo Admin). */
catalogRouter.post('/', requireStaff, requireRole('ADMIN'), async (req, res) => {
  const data = catalogSchema.parse(req.body);
  const item = await prisma.catalogItem.create({ data });
  res.status(201).json(item);
});
