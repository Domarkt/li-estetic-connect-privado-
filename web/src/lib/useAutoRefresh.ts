import { useEffect } from 'react';

/**
 * Refresca datos sin que el usuario tenga que recargar la página:
 *  · al volver a la pestaña (focus / visibilitychange), y
 *  · cada `everyMs` mientras la pestaña esté visible (por defecto 30s).
 *
 * Evita el "hay que actualizar para ver los cambios" entre recepción, cabina y
 * portal, que trabajan sobre los mismos datos a la vez.
 */
export function useAutoRefresh(refetch: () => void, everyMs = 30000) {
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') refetch(); };
    const t = setInterval(tick, everyMs);
    window.addEventListener('focus', refetch);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', refetch);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refetch, everyMs]);
}
