import type { ReactNode } from 'react';

export function Overlay({ children, onClose, z = 110 }: { children: ReactNode; onClose: () => void; z?: number }) {
  return (
    <div onClick={onClose}
      className="fixed inset-0 flex items-center justify-center p-7"
      style={{ background: 'rgba(28,37,64,.5)', zIndex: z }}>
      {children}
    </div>
  );
}

export function stop(e: React.MouseEvent) {
  e.stopPropagation();
}
