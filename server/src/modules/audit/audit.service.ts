import type { Request } from 'express';
import { prisma } from '../../db/prisma.js';

/**
 * Acciones auditadas. Se nombran en pasado y en términos del negocio, para que la
 * pantalla de auditoría se lea sola.
 */
export type AuditAction =
  | 'FICHA_VIEW'          // alguien abrió la ficha clínica de un paciente
  | 'FICHA_UPDATE'        // se modificó la parte clínica
  | 'PATIENT_CREATE'
  | 'INVOICE_CREATE'      // se emitió un recibo
  | 'INVOICE_VOID'        // se anuló un recibo
  | 'APPOINTMENT_CANCEL'
  | 'APPOINTMENT_REASSIGN'
  | 'PRICE_CHANGE'        // cambió el precio de un ítem del catálogo
  | 'CATALOG_DELETE'
  | 'TREATMENT_AREAS'     // se (re)definieron las áreas de un plan
  | 'PORTAL_LOGIN';       // el paciente entró a su portal

interface AuditInput {
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  summary?: string;
  /** Sucursal del hecho (si no se pasa, se toma la del usuario). */
  branchId?: string | null;
}

/** IP real detrás del proxy de Render (trust proxy ya está activo). */
function clientIp(req: Request): string | undefined {
  const fwd = req.headers['x-forwarded-for'];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd?.split(',')[0];
  return (raw ?? req.ip ?? undefined)?.trim() || undefined;
}

/**
 * Registra un hecho auditable. NUNCA lanza: la auditoría no puede tumbar una
 * operación del negocio (si falla, se pierde el rastro, no el cobro).
 *
 * Se guarda el nombre y rol del momento, para que el registro siga siendo
 * legible aunque después se desactive o renombre al usuario.
 */
export async function audit(req: Request, input: AuditInput): Promise<void> {
  try {
    const staff = req.staff;
    let userName: string | undefined;
    if (staff?.sub) {
      const u = await prisma.user.findUnique({ where: { id: staff.sub }, select: { name: true } });
      userName = u?.name;
    }
    await prisma.auditLog.create({
      data: {
        userId: staff?.sub ?? null,
        userName: userName ?? (req.patient ? req.patient.name : null),
        role: staff?.role ?? (req.patient ? 'PACIENTE' : null),
        branchId: input.branchId ?? staff?.branchId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        summary: input.summary ?? null,
        ip: clientIp(req) ?? null,
      },
    });
  } catch {
    /* la auditoría nunca interrumpe la operación */
  }
}
