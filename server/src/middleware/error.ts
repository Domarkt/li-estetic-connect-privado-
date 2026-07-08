import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: 'Recurso no encontrado' });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Datos inválidos', issues: err.issues });
  }
  const message = err instanceof Error ? err.message : 'Error interno';
  console.error('[error]', message);
  // En producción no exponemos detalles internos al cliente.
  const clientMessage = process.env.NODE_ENV === 'production' ? 'Error interno del servidor' : message;
  res.status(500).json({ error: clientMessage });
}
