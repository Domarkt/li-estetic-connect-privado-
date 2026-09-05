import type { Request } from 'express';

/**
 * Cache en memoria de MUY corta duración para los GET que el frontend sondea
 * (agenda, cobros, pacientes, seguimiento…). Objetivo: reducir el egress del pooler
 * de Supabase. Con N pestañas pidiendo lo mismo cada minuto:
 *   · TTL: colapsa las lecturas de una misma clave a 1 por ventana.
 *   · Coalescing: si llegan varias peticiones a la vez con la caché fría, se ejecuta
 *     UNA sola consulta a Postgres y todas comparten el resultado (evita estampida).
 *   · Invalidación por módulo al escribir: quien acaba de crear/editar ve datos frescos.
 *
 * Una sola instancia (Render Starter), así que un Map en memoria basta.
 */

interface Entry { value: unknown; expires: number }
const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

/** Limpia entradas vencidas (barrido ligero, oportunista). */
function sweep(now: number): void {
  if (store.size < 200) return;
  for (const [k, e] of store) if (e.expires <= now) store.delete(k);
}

/**
 * Devuelve el valor cacheado si sigue vigente; si no, ejecuta `producer` una sola vez
 * (aunque lleguen peticiones concurrentes) y cachea el resultado por `ttlMs`.
 */
export async function cached<T>(key: string, ttlMs: number, producer: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value as T;

  const flying = inflight.get(key);
  if (flying) return flying as Promise<T>;

  const promise = (async () => {
    const value = await producer();
    store.set(key, { value, expires: Date.now() + ttlMs });
    sweep(Date.now());
    return value;
  })().finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise as Promise<T>;
}

/** Invalida todas las claves cuyo nombre empiece por alguno de estos prefijos. */
export function invalidate(...prefixes: string[]): void {
  if (!store.size) return;
  for (const k of store.keys()) {
    if (prefixes.some((p) => k.startsWith(p))) store.delete(k);
  }
}

/**
 * Clave de cache que aísla por lo que CAMBIA el resultado:
 *  - rol (el admin ve duración; la esteticista solo sus citas),
 *  - sucursal en foco (scopeBranchId; para personal de sucursal es la suya),
 *  - usuario SOLO para esteticista (ve únicamente lo suyo); el resto comparten por sucursal,
 *  - parámetros de consulta relevantes (fecha, mes, filtros…).
 * Así dos recepcionistas de la misma sucursal comparten lectura, pero nunca se cruzan datos.
 */
export function cacheKey(ns: string, req: Request, extra: Record<string, unknown> = {}): string {
  const s = req.staff!;
  const scope = req.scopeBranchId ?? s.branchId ?? 'all';
  const user = s.role === 'ESTETICISTA' ? s.sub : '-';
  const q = Object.keys(extra).sort().map((k) => `${k}=${extra[k] ?? ''}`).join('&');
  return `${ns}|r=${s.role}|b=${scope}|u=${user}|${q}`;
}

/**
 * Middleware por router: al terminar una escritura (no-GET) con éxito (2xx/3xx),
 * invalida los prefijos indicados para que el siguiente sondeo lea fresco.
 */
export function invalidateOnWrite(...prefixes: string[]) {
  return (req: Request, _res: unknown, next: () => void): void => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const res = _res as { on: (ev: string, cb: () => void) => void; statusCode: number };
    res.on('finish', () => { if (res.statusCode < 400) invalidate(...prefixes); });
    next();
  };
}
