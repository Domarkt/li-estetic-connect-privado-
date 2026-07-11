import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Portal a document.body: saca el contenido fuera de cualquier ancestro con
 * `transform`/`filter` (p.ej. las animaciones de página `animate-fade`), que de
 * lo contrario "atrapan" los elementos `position: fixed` y los encogen.
 */
export function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}

export function Overlay({ children, onClose, z = 110 }: { children: ReactNode; onClose: () => void; z?: number }) {
  // Dos capas: el scroll vertical va en la capa exterior (bloque); el centrado en la
  // interior (flex con min-h-full). Así el modal conserva su ancho fijo y nunca se
  // recorta ni colapsa, aunque el contenido sea más alto que la pantalla.
  return (
    <Portal>
      <div onClick={onClose} className="fixed inset-0 overflow-y-auto" style={{ background: 'rgba(28,37,64,.5)', zIndex: z }}>
        <div className="flex min-h-full items-start justify-center p-4 sm:p-7">
          {children}
        </div>
      </div>
    </Portal>
  );
}

export function stop(e: React.MouseEvent) {
  e.stopPropagation();
}
