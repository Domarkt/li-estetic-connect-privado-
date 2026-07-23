import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import { requireStaff, requireRole } from '../../middleware/auth.js';

export const auditRouter = Router();

/** Etiquetas legibles para la pantalla de auditoría. */
const ACCION_LABEL: Record<string, string> = {
  FICHA_VIEW: 'Abrió ficha clínica',
  FICHA_UPDATE: 'Modificó ficha clínica',
  PATIENT_CREATE: 'Creó paciente',
  INVOICE_CREATE: 'Emitió recibo',
  INVOICE_VOID: 'Anuló recibo',
  APPOINTMENT_CANCEL: 'Canceló cita',
  APPOINTMENT_REASSIGN: 'Reasignó esteticista',
  PRICE_CHANGE: 'Cambió precio',
  CATALOG_DELETE: 'Eliminó del catálogo',
  TREATMENT_AREAS: 'Definió áreas',
  PORTAL_LOGIN: 'Paciente entró al portal',
  PORTAL_MESSAGE: 'Publicó en el portal',
  PORTAL_ACCESS: 'Cambió acceso al portal',
  TREATMENT_SESSION: 'Registró procedimiento aplicado',
};

/**
 * Registro de auditoría — solo administración. Es el rastro de quién hizo qué:
 * accesos a fichas clínicas, cobros, cancelaciones y cambios de precio.
 * Filtros: ?action=, ?q= (texto), ?days= (por defecto 30), ?take= (máx. 200).
 */
auditRouter.get('/', requireStaff, requireRole('ADMIN'), async (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const take = Math.min(200, Math.max(1, Number(req.query.take) || 100));
  const action = (req.query.action as string | undefined)?.trim();
  const q = (req.query.q as string | undefined)?.trim();
  const desde = new Date(Date.now() - days * 24 * 3_600_000);

  const rows = await prisma.auditLog.findMany({
    where: {
      at: { gte: desde },
      ...(action ? { action } : {}),
      ...(q ? { OR: [{ summary: { contains: q, mode: 'insensitive' } }, { userName: { contains: q, mode: 'insensitive' } }] } : {}),
    },
    orderBy: { at: 'desc' },
    take,
  });

  res.json({
    acciones: Object.entries(ACCION_LABEL).map(([key, label]) => ({ key, label })),
    total: rows.length,
    items: rows.map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      fecha: r.at.toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
      usuario: r.userName ?? 'Sistema',
      rol: r.role ?? '—',
      accion: ACCION_LABEL[r.action] ?? r.action,
      accionKey: r.action,
      detalle: r.summary ?? '',
      ip: r.ip,
    })),
  });
});
