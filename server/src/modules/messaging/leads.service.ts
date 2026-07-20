import { prisma } from '../../db/prisma.js';

// Seguimiento automático: crea o avanza la tarjeta del tablero (pipeline) de una sucursal.
type Stage = 'NUEVO_MENSAJE' | 'EN_CONVERSACION' | 'COTIZADO' | 'CITA_AGENDADA' | 'VENDIDO';
const RANK: Record<Stage, number> = { NUEVO_MENSAJE: 0, EN_CONVERSACION: 1, COTIZADO: 2, CITA_AGENDADA: 3, VENDIDO: 4 };

/**
 * Crea la tarjeta de seguimiento de un paciente o la avanza a una etapa posterior.
 * Nunca retrocede de etapa y nunca lanza: el seguimiento no debe romper el flujo principal
 * (agendar, cobrar, registrar paciente, solicitar cita).
 */
export async function upsertLead(opts: { branchId: string; patientId?: string | null; name: string; stage: Stage; summary?: string }): Promise<void> {
  try {
    const { branchId, patientId, name, stage, summary } = opts;
    if (patientId) {
      const existing = await prisma.lead.findFirst({ where: { patientId } });
      if (existing) {
        const cur = RANK[existing.stage as Stage] ?? 0;
        const next: Stage = RANK[stage] > cur ? stage : (existing.stage as Stage);
        await prisma.lead.update({ where: { id: existing.id }, data: { stage: next, name, ...(summary ? { summary } : {}) } });
        return;
      }
    }
    await prisma.lead.create({ data: { branchId, patientId: patientId ?? null, name, stage, summary: summary ?? null } });
  } catch {
    /* el seguimiento es best-effort */
  }
}
