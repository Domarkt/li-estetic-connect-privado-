import { useEffect } from 'react';

/**
 * Refresca datos sin que el usuario tenga que recargar la página:
 *  · al volver a la pestaña (focus / visibilitychange).
 *
 * Evita el "hay que actualizar para ver los cambios" entre recepción, cabina y
 * portal, que trabajan sobre los mismos datos a la vez.
 *
 * No usa intervalos: cada pantalla ya carga al entrar y vuelve a consultar después
 * de sus mutaciones. Esto evita lecturas constantes de Supabase cuando nadie ha
 * cambiado nada y conserva datos frescos al regresar a la aplicación.
 */
export function useAutoRefresh(refetch: () => void, _everyMs?: number) {
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') refetch(); };
    window.addEventListener('focus', refetch);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.removeEventListener('focus', refetch);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refetch]);
}
