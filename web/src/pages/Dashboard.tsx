import { useBranch } from '../layout/BranchContext';

// Vista General (admin) — shell con KPIs de ejemplo. Los datos reales llegan en fases posteriores.
const KPIS = [
  { label: 'Ventas del mes', value: 'RD$630k', sub: 'Consolidado 3 sucursales', delta: '+12%' },
  { label: 'Citas hoy', value: '28', sub: '19 confirmadas', delta: '+4' },
  { label: 'Pacientes activos', value: '142', sub: 'con tratamiento en curso', delta: '+8' },
  { label: 'Comisiones mes', value: 'RD$54k', sub: 'equipo completo', delta: '8% + bonos' },
];

export default function Dashboard() {
  const { active } = useBranch();
  const scope = active ? active.name : 'Todas las sucursales';

  return (
    <div className="flex animate-fade flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {KPIS.map((k) => (
          <div key={k.label} className="rounded-base border border-line bg-card p-[18px] shadow-card">
            <div className="flex items-start justify-between">
              <div className="text-[12.5px] font-semibold text-muted">{k.label}</div>
              <span className="rounded-full bg-ok-soft px-2 py-0.5 text-[11px] font-bold text-ok">{k.delta}</span>
            </div>
            <div className="mt-2.5 text-[28px] font-extrabold tracking-tight">{k.value}</div>
            <div className="mt-0.5 text-xs text-faint">{k.sub}</div>
          </div>
        ))}
      </div>
      <div className="rounded-base border border-line bg-card p-6 shadow-card">
        <h3 className="text-[15px] font-bold">Panel general — {scope}</h3>
        <p className="mt-1 text-sm text-muted">
          Los gráficos de ventas, ranking de sucursales, top de asesoras y actividad reciente se
          conectan a datos reales en las fases 4 y 6. La estructura, roles y el filtro por sucursal
          ya están operativos.
        </p>
      </div>
    </div>
  );
}
