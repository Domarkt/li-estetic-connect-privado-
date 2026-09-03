import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useBranch } from '../../layout/BranchContext';
import { useAutoRefresh } from '../../lib/useAutoRefresh';

interface Resumen { total: number; sinTecnicas: number; sinAreas: number; sinFirma: number; sinNotas: number }
interface FilaTera { branch: string; therapist: string; total: number; sinTecnicas: number; sinAreas: number; sinNotas: number }
interface Detalle { branch: string; therapist: string; combo: string; fecha: string; faltaTecnica: boolean; faltaArea: boolean }
interface Atencion { branch: string; abiertos: number; cerrados: number; cancelados: number }
interface AuditData {
  resumen: Resumen;
  porEsteticista: FilaTera[];
  detalle: Detalle[];
  combos: { avanceSinTecnicas: number; avanceSinBitacora: number };
  atencion: Atencion[];
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

export default function AuditoriaPage() {
  const { activeBranch } = useBranch();
  const [data, setData] = useState<AuditData | null>(null);
  const [err, setErr] = useState(false);

  const load = useCallback(() => {
    const qp = activeBranch !== 'all' ? `?branch=${activeBranch}` : '';
    api.get<AuditData>(`/reports/audit${qp}`).then((d) => { setData(d); setErr(false); }).catch(() => setErr(true));
  }, [activeBranch]);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load); // en vivo: refresca al volver a la pestaña y cada 60s

  if (err) return <div className="rounded-base border border-line bg-card p-6 text-sm text-muted">No se pudo cargar la auditoría. <button onClick={load} className="font-bold text-magenta">Reintentar</button></div>;
  if (!data) return <div className="rounded-base border border-line bg-card p-6 text-sm text-muted">Cargando auditoría…</div>;

  const r = data.resumen;
  const conTecnicas = r.total - r.sinTecnicas;
  const cards = [
    { label: 'Bitácoras registradas', value: String(r.total), hint: 'sesiones con respaldo' },
    { label: 'Con técnicas marcadas', value: `${pct(conTecnicas, r.total)}%`, hint: `${conTecnicas} de ${r.total}`, ok: pct(conTecnicas, r.total) >= 95 },
    { label: 'Firmadas por el paciente', value: `${pct(r.total - r.sinFirma, r.total)}%`, hint: `${r.sinFirma} sin firma`, ok: r.sinFirma === 0 },
    { label: 'Sin área marcada', value: String(r.sinAreas), hint: `${pct(r.sinAreas, r.total)}% de las bitácoras`, warn: r.sinAreas > 0 },
    { label: 'Sin comentario', value: String(r.sinNotas), hint: `${pct(r.sinNotas, r.total)}% (nota opcional)` },
  ];

  return (
    <div className="animate-fade flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="text-[12.5px] text-muted">Seguimiento en vivo de cómo se diligencian las sesiones y los combos. Se actualiza solo cada minuto.</div>
        <button onClick={load} className="rounded-[9px] border border-line bg-card px-3 py-1.5 text-[12px] font-bold text-magenta">↻ Actualizar</button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="rounded-base border border-line bg-card p-4 shadow-card">
            <div className="text-[11px] font-bold uppercase tracking-wide text-muted">{c.label}</div>
            <div className="mt-1 text-[24px] font-extrabold" style={{ color: c.ok ? 'var(--ok)' : c.warn ? '#C9880E' : 'var(--navy)' }}>{c.value}</div>
            <div className="mt-0.5 text-[11px] text-faint">{c.hint}</div>
          </div>
        ))}
      </div>

      {/* Combos mal diligenciados */}
      {(data.combos.avanceSinTecnicas > 0 || data.combos.avanceSinBitacora > 0) ? (
        <div className="flex flex-col gap-2 rounded-base border p-4" style={{ background: '#FBF0DC', borderColor: '#EAD8A8' }}>
          <div className="text-[13px] font-extrabold" style={{ color: '#8A5D08' }}>⚠ Combos mal diligenciados</div>
          {data.combos.avanceSinTecnicas > 0 && <div className="text-[12.5px]" style={{ color: '#8A5D08' }}>{data.combos.avanceSinTecnicas} combo(s) con sesiones consumidas pero sin ninguna técnica marcada (contadores en 0).</div>}
          {data.combos.avanceSinBitacora > 0 && <div className="text-[12.5px]" style={{ color: '#8A5D08' }}>{data.combos.avanceSinBitacora} combo(s) con sesiones consumidas pero sin ninguna bitácora registrada.</div>}
        </div>
      ) : (
        <div className="rounded-base border border-line bg-card p-3 text-[12.5px] font-semibold text-ok">✓ Todos los combos con avance tienen sus técnicas y bitácoras registradas.</div>
      )}

      {/* Por esteticista */}
      <div className="overflow-x-auto rounded-base border border-line bg-card shadow-card">
        <div className="min-w-[560px]">
          <div className="border-b border-line px-5 py-3 text-[13px] font-extrabold">Diligenciamiento por esteticista</div>
          <div className="grid grid-cols-[1.4fr_1fr_.8fr_.8fr_.8fr] gap-2 border-b border-line px-5 py-2.5 text-[11px] font-bold uppercase tracking-wide text-muted">
            <div>Esteticista</div><div>Estética</div><div className="text-right">Bitácoras</div><div className="text-right">Sin técnica</div><div className="text-right">Sin área</div>
          </div>
          {data.porEsteticista.map((f, i) => (
            <div key={i} className="grid grid-cols-[1.4fr_1fr_.8fr_.8fr_.8fr] items-center gap-2 border-b border-line-2 px-5 py-3 text-[13px]">
              <div className="font-semibold">{f.therapist}</div>
              <div className="text-muted">{f.branch}</div>
              <div className="text-right font-bold">{f.total}</div>
              <div className="text-right font-extrabold" style={{ color: f.sinTecnicas > 0 ? 'var(--danger)' : 'var(--ok)' }}>{f.sinTecnicas}</div>
              <div className="text-right font-extrabold" style={{ color: f.sinAreas > 0 ? '#C9880E' : 'var(--ok)' }}>{f.sinAreas}</div>
            </div>
          ))}
          {data.porEsteticista.length === 0 && <div className="px-5 py-8 text-center text-sm text-muted">Sin bitácoras en el rango.</div>}
        </div>
      </div>

      {/* Detalle de casos a corregir */}
      <div className="overflow-x-auto rounded-base border border-line bg-card shadow-card">
        <div className="min-w-[560px]">
          <div className="border-b border-line px-5 py-3 text-[13px] font-extrabold">Sesiones a corregir <span className="font-semibold text-muted">({data.detalle.length})</span></div>
          <div className="grid grid-cols-[1fr_1.2fr_1.4fr_.8fr_.9fr] gap-2 border-b border-line px-5 py-2.5 text-[11px] font-bold uppercase tracking-wide text-muted">
            <div>Estética</div><div>Esteticista</div><div>Combo / servicio</div><div>Fecha</div><div className="text-right">Falta</div>
          </div>
          {data.detalle.map((d, i) => (
            <div key={i} className="grid grid-cols-[1fr_1.2fr_1.4fr_.8fr_.9fr] items-center gap-2 border-b border-line-2 px-5 py-2.5 text-[12.5px]">
              <div className="text-muted">{d.branch}</div>
              <div className="font-semibold">{d.therapist}</div>
              <div className="truncate" title={d.combo}>{d.combo}</div>
              <div className="text-faint">{d.fecha}</div>
              <div className="flex justify-end gap-1">
                {d.faltaTecnica && <span className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ background: 'var(--danger)' }}>técnica</span>}
                {d.faltaArea && <span className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ background: '#C9880E' }}>área</span>}
              </div>
            </div>
          ))}
          {data.detalle.length === 0 && <div className="px-5 py-8 text-center text-sm font-semibold text-ok">✓ No hay sesiones con técnica o área faltante.</div>}
        </div>
      </div>

      {/* Atención por estética */}
      <div className="overflow-x-auto rounded-base border border-line bg-card shadow-card">
        <div className="min-w-[480px]">
          <div className="border-b border-line px-5 py-3 text-[13px] font-extrabold">Atención por estética</div>
          <div className="grid grid-cols-4 gap-2 border-b border-line px-5 py-2.5 text-[11px] font-bold uppercase tracking-wide text-muted">
            <div>Estética</div><div className="text-right">Turnos abiertos</div><div className="text-right">Atendidos</div><div className="text-right">Cancelados</div>
          </div>
          {data.atencion.map((a, i) => (
            <div key={i} className="grid grid-cols-4 items-center gap-2 border-b border-line-2 px-5 py-3 text-[13px]">
              <div className="font-semibold">{a.branch}</div>
              <div className="text-right font-bold">{a.abiertos}</div>
              <div className="text-right font-bold text-ok">{a.cerrados}</div>
              <div className="text-right font-bold" style={{ color: a.cancelados > 0 ? 'var(--danger)' : 'var(--muted)' }}>{a.cancelados}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
