import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useBranch } from '../layout/BranchContext';
import { fmtRD } from '../lib/types';

interface Kpi { ventasMes: number; recibosMes: number; ventasHoy: number; ticketPromedio: number; citasHoy: number; citasHoyConfirmadas: number; pacientesActivos: number }
interface BranchKpi extends Kpi { id: string; name: string }
interface Dash { isAdmin: boolean; scope: Kpi; branches: BranchKpi[] }

export default function SucursalesPage() {
  const { activeBranch, active } = useBranch();
  const [d, setD] = useState<Dash | null>(null);

  // Trae el resumen de la sucursal seleccionada (o consolidado si "Todas").
  const branchQ = activeBranch !== 'all' ? `?branch=${activeBranch}` : '';
  const load = useCallback(() => { api.get<Dash>(`/reports/dashboard${branchQ}`).then(setD).catch(() => setD(null)); }, [branchQ]);
  useEffect(() => { load(); }, [load]);

  if (!d) return <div className="py-10 text-center text-sm text-muted animate-fade">Cargando…</div>;

  // Una sucursal seleccionada → vista de detalle de esa sucursal.
  if (activeBranch !== 'all') {
    const s = d.scope;
    return (
      <div className="animate-fade flex flex-col gap-4">
        <div className="rounded-base border border-line bg-card p-5 shadow-card">
          <div className="mb-1 flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--magenta)' }} />
            <div className="text-[16px] font-extrabold">{active?.name ?? 'Sucursal'}</div>
          </div>
          {active?.place && <div className="text-[12.5px] text-muted">{active.place}</div>}
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          {d.isAdmin && <Big label="Ventas del mes" value={fmtRD(s.ventasMes)} sub={`${s.recibosMes} recibos`} />}
          {d.isAdmin && <Big label="Ventas de hoy" value={fmtRD(s.ventasHoy)} />}
          {d.isAdmin && <Big label="Ticket promedio" value={fmtRD(s.ticketPromedio)} />}
          <Big label="Citas hoy" value={String(s.citasHoy)} sub={`${s.citasHoyConfirmadas} confirmadas`} />
          <Big label="Pacientes activos" value={String(s.pacientesActivos)} />
        </div>
        <div className="rounded-base border border-line bg-card p-4 text-[12.5px] text-muted shadow-card">
          Cambia el selector de arriba a <b>Todas</b> para comparar las 3 sucursales, o a <b>E1/E2/E3</b> para ver cada una por separado. Análisis a fondo en <b>Reportes</b>.
        </div>
      </div>
    );
  }

  // "Todas" → comparación: una tarjeta por sucursal.
  const totalVentas = d.branches.reduce((s, b) => s + b.ventasMes, 0);
  return (
    <div className="animate-fade">
      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        {[...d.branches].sort((a, b) => b.ventasMes - a.ventasMes).map((b) => (
          <div key={b.id} className="rounded-base border border-line bg-card p-5 shadow-card">
            <div className="mb-3 flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--magenta)' }} />
              <div className="text-[15px] font-extrabold">{b.name}</div>
            </div>
            {d.isAdmin && (
              <>
                <div className="text-[26px] font-extrabold tracking-tight">{fmtRD(b.ventasMes)}</div>
                <div className="text-[11.5px] text-faint">Ventas del mes · {b.recibosMes} recibos</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[12.5px]">
                  <Cell label="Ventas hoy" value={fmtRD(b.ventasHoy)} />
                  <Cell label="Ticket prom." value={fmtRD(b.ticketPromedio)} />
                </div>
              </>
            )}
            <div className="mt-2 grid grid-cols-2 gap-2 text-[12.5px]">
              <Cell label="Citas hoy" value={`${b.citasHoy} (${b.citasHoyConfirmadas} conf.)`} />
              <Cell label="Pacientes activos" value={String(b.pacientesActivos)} />
            </div>
            {d.isAdmin && totalVentas > 0 && (
              <div className="mt-3">
                <div className="mb-1 text-[11px] text-muted">{Math.round((b.ventasMes / totalVentas) * 100)}% del total</div>
                <div className="h-2 overflow-hidden rounded-md" style={{ background: 'var(--navy-soft)' }}>
                  <div className="h-full rounded-md" style={{ width: `${Math.round((b.ventasMes / totalVentas) * 100)}%`, background: 'linear-gradient(90deg,#B31C86,#D4419E)' }} />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {d.isAdmin && (
        <div className="rounded-base border border-line bg-card p-4 text-[13px] shadow-card">
          <b>Total consolidado del mes:</b> {fmtRD(totalVentas)} · {d.branches.reduce((s, b) => s + b.recibosMes, 0)} recibos
          <span className="ml-2 text-muted">— selecciona E1/E2/E3 arriba para ver cada una por separado.</span>
        </div>
      )}
    </div>
  );
}

function Big({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-card px-4 py-3.5 shadow-card">
      <div className="text-[11px] font-semibold text-muted">{label}</div>
      <div className="mt-0.5 text-[20px] font-extrabold tracking-tight">{value}</div>
      {sub && <div className="text-[10.5px] text-faint">{sub}</div>}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-bg px-3 py-2">
      <div className="text-[10.5px] font-semibold text-muted">{label}</div>
      <div className="text-[13.5px] font-extrabold">{value}</div>
    </div>
  );
}
