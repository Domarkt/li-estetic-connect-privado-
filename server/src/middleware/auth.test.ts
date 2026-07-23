import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireRole } from './auth.js';

/** Petición mínima con (o sin) personal autenticado. */
function reqCon(role?: 'ADMIN' | 'RECEPCIONISTA' | 'ESTETICISTA'): Request {
  return (role ? { staff: { sub: 'u1', role, branchId: 'b1' } } : {}) as unknown as Request;
}

/** Respuesta espía: registra el status y el cuerpo devueltos. */
function resEspia() {
  const res = {
    statusCode: 0 as number,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res as unknown as Response & { statusCode: number; body: { error?: string } };
}

/**
 * El aislamiento por rol es lo que impide que, por ejemplo, una esteticista
 * anule un cobro o que cualquiera entre al registro de auditoría.
 */
describe('requireRole · permisos por rol', () => {
  it('deja pasar al rol permitido', () => {
    const res = resEspia();
    const next = vi.fn() as unknown as NextFunction;
    requireRole('ADMIN', 'RECEPCIONISTA')(reqCon('RECEPCIONISTA'), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0); // no respondió: siguió la cadena
  });

  it('bloquea con 403 al rol no permitido', () => {
    const res = resEspia();
    const next = vi.fn() as unknown as NextFunction;
    requireRole('ADMIN')(reqCon('ESTETICISTA'), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/No autorizado/i);
  });

  it('exige autenticación: sin sesión responde 401', () => {
    const res = resEspia();
    const next = vi.fn() as unknown as NextFunction;
    requireRole('ADMIN')(reqCon(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('la auditoría es solo de administración', () => {
    const soloAdmin = requireRole('ADMIN');
    for (const rol of ['RECEPCIONISTA', 'ESTETICISTA'] as const) {
      const res = resEspia();
      const next = vi.fn() as unknown as NextFunction;
      soloAdmin(reqCon(rol), res, next);
      expect(res.statusCode, `${rol} no debe ver la auditoría`).toBe(403);
    }
    const res = resEspia();
    const next = vi.fn() as unknown as NextFunction;
    soloAdmin(reqCon('ADMIN'), res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('solo recepción y admin facturan (la esteticista no)', () => {
    const facturan = requireRole('ADMIN', 'RECEPCIONISTA');
    const res = resEspia();
    const next = vi.fn() as unknown as NextFunction;
    facturan(reqCon('ESTETICISTA'), res, next);
    expect(res.statusCode).toBe(403);
  });
});
