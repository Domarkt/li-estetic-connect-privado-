import { useCallback, useEffect, useState } from 'react';
import { useBranch } from '../layout/BranchContext';
import { useAuth } from '../auth/AuthContext';
import { api } from '../lib/api';
import { fmtRD } from '../lib/types';

interface BranchKpi { id: string; name: string; ventasMes: number; recibosMes: number; ventasHoy: number; ticketPromedio: number; citasHoy: number; citasHoyConfirmadas: number; pacientesActivos: number; meta?: number; metaPct?: number }
interface StaffGoal { name: string; branch: string; ventas: number; meta: number; pct: number }
interface Dash { isAdmin: boolean; scope: Omit<BranchKpi, 'id' | 'name'> & { meta?: number; metaPct?: number }; branches: BranchKpi[]; staffGoals?: StaffGoal[] }

// Color/gradiente del avance de meta: verde si llegó, ámbar si va bien, magenta si va bajo.
const metaColor = (p: number) => (p >= 100 ? 'var(--ok)' : p >= 60 ? '#C9880E' : 'var(--magenta)');
const barGrad = (p: number) => (p >= 100 ? 'linear-gradient(90deg,#1F9D6B,#28c48a)' : p >= 60 ? 'linear-gradient(90deg,#C9880E,#e0a52e)' : 'linear-gradient(90deg,#B31C86,#D4419E)');

export default function Dashboard() {
  const { active, activeBranch } = useBranch();
  const { staff } = useAuth();
  const isAdmin = staff?.role === 'ADMIN';
  const scope = active ? active.name : 'Todas las sucursales';
  const [d, setD] = useState<Dash | null>(null);

  const branchQ = activeBranch !== 'all' ? `?branch=${activeBranch}` : '';
  const load = useCallback(() => {
    api.get<Dash>(`/reports/dashboard${branchQ}`).then(setD).catch(() => setD(null));
  }, [branchQ]);
  useEffect(() => { load(); }, [load]);

  const s = d?.scope;
  const kpis = [
    ...(isAdmin ? [{ label: 'Ventas del mes', value: s ? fmtRD(s.ventasMes) : '—', sub: s ? `${s.recibosMes} recibos` : '' }] : []),
    { label: 'Citas hoy', value: s ? String(s.citasHoy) : '—', sub: s ? `${s.citasHoyConfirmadas} confirmadas` : '' },
    { label: 'Pacientes activos', value: s ? String(s.pacientesActivos) : '—', sub: 'con tratamiento en curso' },
    ...(isAdmin ? [
      { label: 'Ventas de hoy', value: s ? fmtRD(s.ventasHoy) : '—', sub: 'cobrado hoy' },
      { label: 'Ticket promedio', value: s ? fmtRD(s.ticketPromedio) : '—', sub: 'por recibo (mes)' },
    ] : []),
  ];

  const maxVenta = Math.max(1, ...(d?.branches ?? []).map((b) => b.ventasMes));

  return (
    <div className="flex animate-fade flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-base border border-line bg-card p-[18px] shadow-card">
            <div className="text-[12.5px] font-semibold text-muted">{k.label}</div>
            <div className="mt-2.5 text-[28px] font-extrabold tracking-tight">{k.value}</div>
            <div className="mt-0.5 text-xs text-faint">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Meta del mes de la sucursal en foco: lo que lleva vs. la meta, con % y barra */}
      {isAdmin && s && (s.meta ?? 0) > 0 && (
        <div className="rounded-base border border-line bg-card p-5 shadow-card">
          <div className="mb-2 flex items-end justify-between">
            <h3 className="text-[15px] font-extrabold">Meta del mes — {scope}</h3>
            <span className="text-[18px] font-extrabold" style={{ color: metaColor(s.metaPct ?? 0) }}>{s.metaPct ?? 0}%</span>
          </div>
          <div className="mb-1.5 flex justify-between text-[12.5px]">
            <span className="text-muted">Llevas <b className="text-ink">{fmtRD(s.ventasMes)}</b></span>
            <span className="text-muted">Meta <b className="text-ink">{fmtRD(s.meta ?? 0)}</b></span>
          </div>
          <div className="h-3.5 overflow-hidden rounded-md" style={{ background: 'var(--navy-soft)' }}>
            <div className="h-full rounded-md transition-all" style={{ width: `${Math.min(100, s.metaPct ?? 0)}%`, background: barGrad(s.metaPct ?? 0) }} />
          </div>
          <div className="mt-1.5 text-[11.5px] font-semibold text-faint">
            {s.ventasMes >= (s.meta ?? 0) ? '🎉 Meta alcanzada' : `Faltan ${fmtRD(Math.max(0, (s.meta ?? 0) - s.ventasMes))} para la meta`}
          </div>
        </div>
      )}

      {/* Meta por esteticista: ventas atribuidas del mes vs. su meta por asesor */}
      {isAdmin && d && (d.staffGoals?.length ?? 0) > 0 && (
        <div className="rounded-base border border-line bg-card p-5 shadow-card">
          <h3 className="mb-3 text-[15px] font-extrabold">Meta por esteticista — {scope}</h3>
          <div className="flex flex-col gap-3">
            {(d.staffGoals ?? []).map((t) => (
              <div key={`${t.branch}-${t.name}`}>
                <div className="mb-1 flex justify-between text-[13px]">
                  <span className="font-semibold">{t.name} <span className="text-faint">· {t.branch}</span></span>
                  <span className="font-bold">
                    {fmtRD(t.ventas)}{t.meta ? ` / ${fmtRD(t.meta)}` : ''} {t.meta ? <span style={{ color: metaColor(t.pct) }}>· {t.pct}%</span> : <span className="text-faint">· sin meta</span>}
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-md" style={{ background: 'var(--navy-soft)' }}>
                  <div className="h-full rounded-md transition-all" style={{ width: `${t.meta ? Math.min(100, t.pct) : 0}%`, background: barGrad(t.pct) }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 border-t border-line pt-2.5 text-[11.5px] text-faint">Meta por asesor configurable en <b>Configuración</b>. Ventas = cobros atribuidos a la esteticista este mes.</div>
        </div>
      )}

      {/* Ranking / desempeño por sucursal (admin) */}
      {isAdmin && d && (
        <div className="rounded-base border border-line bg-card p-5 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[15px] font-extrabold">Desempeño por sucursal — {scope}</h3>
            <span className="text-[11.5px] text-faint">Ventas del mes</span>
          </div>
          {d.branches.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted">Sin datos.</div>
          ) : (
            <div className="flex flex-col gap-3">
              {[...d.branches].sort((a, b) => b.ventasMes - a.ventasMes).map((b) => (
                <div key={b.id}>
                  <div className="mb-1 flex justify-between text-[13px]">
                    <span className="font-semibold">{b.name} <span className="text-faint">· {b.citasHoy} citas hoy</span></span>
                    <span className="font-extrabold">{fmtRD(b.ventasMes)}{(b.meta ?? 0) > 0 ? <span className="font-bold text-muted"> / {fmtRD(b.meta ?? 0)}</span> : null}{(b.meta ?? 0) > 0 ? <span style={{ color: metaColor(b.metaPct ?? 0) }}> · {b.metaPct}%</span> : null}</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-md" style={{ background: 'var(--navy-soft)' }}>
                    <div className="h-full rounded-md" style={{ width: `${(b.meta ?? 0) > 0 ? Math.min(100, b.metaPct ?? 0) : Math.round((b.ventasMes / maxVenta) * 100)}%`, background: (b.meta ?? 0) > 0 ? barGrad(b.metaPct ?? 0) : 'linear-gradient(90deg,#B31C86,#D4419E)' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 border-t border-line pt-3 text-[12px] text-muted">
            Para análisis detallado (ventas por método, top de servicios, campañas y equipo) usa <b>Reportes</b>.
          </div>
        </div>
      )}

      {!isAdmin && (
        <div className="rounded-base border border-line bg-card p-6 shadow-card">
          <h3 className="text-[15px] font-bold">Panel — {scope}</h3>
          <p className="mt-1 text-sm text-muted">Aquí ves las citas de hoy y los pacientes activos de tu sucursal.</p>
        </div>
      )}
    </div>
  );
}
