import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireStaff, requireRole, branchScope, assertBranchAccess } from '../../middleware/auth.js';
import { STAGE_META, STAGE_ORDER, CHANNEL_META } from './messaging.service.js';

export const pipelineRouter = Router();

const roles = ['ADMIN', 'RECEPCIONISTA'] as const;

/** Tablero kanban por columnas (aislado por sucursal). */
pipelineRouter.get('/', requireStaff, requireRole(...roles), branchScope, async (req, res) => {
  const leads = await prisma.lead.findMany({
    where: req.scopeBranchId ? { branchId: req.scopeBranchId } : {},
    orderBy: { updatedAt: 'desc' },
  });
  const columns = STAGE_ORDER.map((stage) => ({
    stage,
    label: STAGE_META[stage].label,
    color: STAGE_META[stage].color,
    leads: leads
      .filter((l) => l.stage === stage)
      .map((l) => ({
        id: l.id,
        name: l.name,
        summary: l.summary ?? '',
        channel: l.channel,
        channelColor: l.channel ? CHANNEL_META[l.channel].color : null,
        channelBadge: l.channel ? CHANNEL_META[l.channel].badge : null,
      })),
  }));
  res.json({ columns });
});

const moveSchema = z.object({
  stage: z.enum(['NUEVO_MENSAJE', 'EN_CONVERSACION', 'COTIZADO', 'CITA_AGENDADA', 'VENDIDO']),
});

/** Mover un lead de etapa (menú "Mover a" o drag & drop). */
pipelineRouter.patch('/:id', requireStaff, requireRole(...roles), branchScope, async (req, res) => {
  const { stage } = moveSchema.parse(req.body);
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (!assertBranchAccess(req, lead.branchId)) return res.status(403).json({ error: 'Lead de otra sucursal' });

  const updated = await prisma.lead.update({ where: { id: lead.id }, data: { stage } });
  res.json({ ok: true, id: updated.id, stage: updated.stage });
});
