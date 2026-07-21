import { useEffect, useState } from 'react';

/**
 * Selector de vista para listados que crecen con el tiempo.
 *  - tarjetas: cómodo de leer, pocos elementos por pantalla
 *  - lista: filas compactas, para catálogos e inventarios grandes
 * La preferencia se recuerda por pantalla (queda guardada en el navegador).
 */
export type ViewMode = 'tarjetas' | 'lista';

export function useViewMode(clave: string, inicial: ViewMode = 'tarjetas') {
  const almacen = `li-vista-${clave}`;
  const [mode, setMode] = useState<ViewMode>(() => {
    const guardado = localStorage.getItem(almacen);
    return guardado === 'lista' || guardado === 'tarjetas' ? guardado : inicial;
  });
  useEffect(() => { localStorage.setItem(almacen, mode); }, [almacen, mode]);
  return [mode, setMode] as const;
}

const OPCIONES: { k: ViewMode; icono: string; label: string }[] = [
  { k: 'tarjetas', icono: '▦', label: 'Tarjetas' },
  { k: 'lista', icono: '☰', label: 'Lista' },
];

export default function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div className="flex flex-none gap-1 rounded-[10px] border border-line bg-card p-1">
      {OPCIONES.map((o) => {
        const on = mode === o.k;
        return (
          <button key={o.k} onClick={() => onChange(o.k)} title={`Ver como ${o.label.toLowerCase()}`}
            aria-pressed={on}
            className="flex items-center gap-1.5 rounded-[7px] px-2.5 py-1.5 text-[12px] font-bold transition"
            style={{ background: on ? 'var(--magenta)' : 'transparent', color: on ? '#fff' : 'var(--muted)' }}>
            <span className="text-[13px]">{o.icono}</span>
            <span className="hidden sm:inline">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
