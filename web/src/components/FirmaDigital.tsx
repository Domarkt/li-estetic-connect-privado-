import { useEffect, useRef, useState } from 'react';

/**
 * Panel de firma con el dedo o el mouse. Sin librerías: se dibuja en un <canvas>
 * y se entrega como PNG en base64.
 *
 * Lo usa el paciente para validar el procedimiento que se le aplicó ese día.
 */
export default function FirmaDigital({
  onChange, alto = 150, etiqueta = 'Firma del paciente',
}: {
  onChange: (dataUrl: string | null) => void;
  alto?: number;
  etiqueta?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dibujando = useRef(false);
  const [tieneFirma, setTieneFirma] = useState(false);

  // El canvas se dimensiona al ancho real del contenedor y a 2x para que la
  // firma no salga pixelada en pantallas retina ni en el PDF/imagen.
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ancho = c.parentElement?.clientWidth ?? 320;
    c.width = ancho * 2;
    c.height = alto * 2;
    c.style.width = '100%';
    c.style.height = `${alto}px`;
    const ctx = c.getContext('2d')!;
    ctx.scale(2, 2);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1C2540';
  }, [alto]);

  /** Coordenadas del puntero relativas al canvas (funciona con dedo y mouse). */
  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function empezar(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const ctx = ref.current!.getContext('2d')!;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    dibujando.current = true;
  }

  function mover(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dibujando.current) return;
    e.preventDefault(); // evita que el gesto arrastre la página en el celular
    const ctx = ref.current!.getContext('2d')!;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!tieneFirma) setTieneFirma(true);
  }

  function terminar() {
    if (!dibujando.current) return;
    dibujando.current = false;
    onChange(ref.current!.toDataURL('image/png'));
  }

  function limpiar() {
    const c = ref.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setTieneFirma(false);
    onChange(null);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11.5px] font-bold text-muted">{etiqueta}</span>
        {tieneFirma && (
          <button type="button" onClick={limpiar} className="text-[11.5px] font-bold text-magenta">Borrar y repetir</button>
        )}
      </div>
      <div className="relative rounded-[10px] border-2 border-dashed bg-card"
        style={{ borderColor: tieneFirma ? 'var(--magenta)' : 'var(--line)' }}>
        <canvas
          ref={ref}
          onPointerDown={empezar}
          onPointerMove={mover}
          onPointerUp={terminar}
          onPointerLeave={terminar}
          className="block touch-none rounded-[10px]"
        />
        {!tieneFirma && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[12.5px] font-semibold text-faint">
            ✎ Firma aquí con el dedo
          </div>
        )}
      </div>
    </div>
  );
}
