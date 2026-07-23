/**
 * Estados de carga / error / vacío, iguales en todas las pantallas.
 *
 * Antes, si el internet iba lento, la recepcionista veía "no hay pacientes" y
 * asumía que se habían borrado. Ahora se distingue: cargando, falló (con
 * reintentar) o de verdad no hay nada.
 */

/** Esqueleto de filas mientras llegan los datos. */
export function Cargando({ filas = 5, texto = 'Cargando…' }: { filas?: number; texto?: string }) {
  return (
    <div className="rounded-base border border-line bg-card p-4" role="status" aria-live="polite">
      <div className="mb-3 flex items-center gap-2.5">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-line" style={{ borderTopColor: 'var(--magenta)' }} />
        <span className="text-[12.5px] font-semibold text-muted">{texto}</span>
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: filas }).map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-[9px] bg-bg" style={{ opacity: 1 - i * 0.13 }} />
        ))}
      </div>
    </div>
  );
}

/** Falló la carga: se dice qué pasó y se ofrece reintentar. */
export function ErrorCarga({ mensaje, onRetry }: { mensaje?: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-base border border-line bg-card px-4 py-10 text-center">
      <span className="text-[26px]">⚠️</span>
      <div>
        <div className="text-[13.5px] font-bold">No se pudieron cargar los datos</div>
        <div className="mt-0.5 text-[12px] text-muted">{mensaje || 'Revisa tu conexión e inténtalo de nuevo.'}</div>
      </div>
      <button onClick={onRetry} className="rounded-[9px] bg-magenta px-4 py-2 text-[12.5px] font-bold text-white">
        Reintentar
      </button>
    </div>
  );
}

/** No hubo error: sencillamente todavía no hay nada que mostrar. */
export function SinDatos({ mensaje, icono = '📭' }: { mensaje: string; icono?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-base border border-line bg-card px-4 py-10 text-center">
      <span className="text-[24px]">{icono}</span>
      <div className="text-[12.5px] text-muted">{mensaje}</div>
    </div>
  );
}
