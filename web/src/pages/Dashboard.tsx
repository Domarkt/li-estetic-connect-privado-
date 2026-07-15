import { useCallback, useEffect, useState } from 'react';
import { useBranch } from '../layout/BranchContext';
import { useAuth } from '../auth/AuthContext';
import { api } from '../lib/api';
import { fmtRD } from '../lib/types';

interface BranchKpi { id: string; name: string; ventasMes: number; recibosMes: number; ventasHoy: number; ticketPromedio: number; citasHoy: number; citasHoyConfirmadas: number; pacientesActivos: number }
interface Dash { isAdmin: boolean; scope: Omit<BranchKpi, 'id' | 'name'>; branches: BranchKpi[] }

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
                    <span className="font-semibold">{b.name} <span className="text-faint">· {b.citasHoy} citas hoy · {b.pacientesActivos} activos</span></span>
                    <span className="font-extrabold">{fmtRD(b.ventasMes)}</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-md" style={{ background: 'var(--navy-soft)' }}>
                    <div className="h-full rounded-md" style={{ width: `${Math.round((b.ventasMes / maxVenta) * 100)}%`, background: 'linear-gradient(90deg,#B31C86,#D4419E)' }} />
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
