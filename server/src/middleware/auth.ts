import type { Request, Response, NextFunction } from 'express';
import type { Role } from '@prisma/client';
import { verifyStaff, verifyPatient } from '../utils/jwt.js';
import type { StaffTokenPayload, PatientTokenPayload } from '../utils/jwt.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      staff?: StaffTokenPayload;
      patient?: PatientTokenPayload;
      /**
       * Sucursal efectiva para la petición.
       * - ADMIN: la que elija por ?branch= (o null = todas).
       * - RECEPCIONISTA / ESTETICISTA: SIEMPRE su branchId (no negociable).
       */
      scopeBranchId?: string | null;
    }
  }
}

function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7);
  return null;
}

/** Requiere token de personal válido. */
export function requireStaff(req: Request, res: Response, next: NextFunction) {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    req.staff = verifyStaff(token);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

/** Requiere que el personal tenga uno de los roles indicados. */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.staff) return res.status(401).json({ error: 'No autenticado' });
    if (!roles.includes(req.staff.role)) {
      return res.status(403).json({ error: 'No autorizado para esta acción' });
    }
    next();
  };
}

/**
 * Aislamiento por sucursal (REGLA DURA).
 * Debe usarse después de requireStaff. Calcula req.scopeBranchId:
 *  - Personal de sucursal: fuerza su propia sucursal, ignora cualquier ?branch=.
 *  - Admin: respeta ?branch=<id> o null (todas). "all" => null.
 */
export function branchScope(req: Request, res: Response, next: NextFunction) {
  if (!req.staff) return res.status(401).json({ error: 'No autenticado' });

  if (req.staff.role === 'ADMIN') {
    const q = (req.query.branch as string | undefined) ?? null;
    req.scopeBranchId = !q || q === 'all' ? null : q;
  } else {
    if (!req.staff.branchId) {
      return res.status(403).json({ error: 'Usuario sin sucursal asignada' });
    }
    req.scopeBranchId = req.staff.branchId;
  }
  next();
}

/**
 * Verifica que una sucursal objetivo sea accesible por el usuario.
 * Útil al crear/mutar recursos con un branchId explícito en el body.
 */
export function assertBranchAccess(req: Request, targetBranchId: string): boolean {
  if (!req.staff) return false;
  if (req.staff.role === 'ADMIN') return true;
  return req.staff.branchId === targetBranchId;
}

/** Requiere token de paciente válido (portal externo). */
export function requirePatient(req: Request, res: Response, next: NextFunction) {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    req.patient = verifyPatient(token);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}
