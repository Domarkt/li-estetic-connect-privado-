import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { fmtRD } from '../lib/types';

interface BranchKpi { id: string; name: string; ventasMes: number; recibosMes: number; ventasHoy: number; ticketPromedio: number; citasHoy: number; citasHoyConfirmadas: number; pacientesActivos: number }
interface Dash { isAdmin: boolean; branches: BranchKpi[] }

export default function SucursalesPage() {
  const [d, setD] = useState<Dash | null>(null);
  // Siempre consolidado (todas las sucursales) para comparar.
  useEffect(() => { api.get<Dash>('/reports/dashboard').then(setD).catch(() => setD(null)); }, []);

  if (!d) return <div className="py-10 text-center text-sm text-muted animate-fade">Cargando…</div>;

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
          <span className="ml-2 text-muted">— análisis detallado en <b>Reportes</b>.</span>
        </div>
      )}
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
