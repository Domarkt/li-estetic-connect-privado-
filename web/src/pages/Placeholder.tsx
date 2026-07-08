import { useBranch } from '../layout/BranchContext';
import { useAuth } from '../auth/AuthContext';

export default function Placeholder({ title, phase }: { title: string; phase: string }) {
  const { active } = useBranch();
  const { staff } = useAuth();

  const scope = staff?.role === 'ADMIN'
    ? active ? `Sucursal: ${active.name}` : 'Todas las sucursales'
    : `Sucursal: ${staff?.branch?.name ?? ''}`;

  return (
    <div className="animate-fade">
      <div className="rounded-base border border-line bg-card p-8 shadow-card">
        <div className="mb-2 inline-block rounded-full bg-magenta-soft px-3 py-1 text-[11.5px] font-bold text-magenta">
          {phase}
        </div>
        <h2 className="mb-1 text-xl font-extrabold">{title}</h2>
        <p className="text-sm text-muted">
          Este módulo se implementará en su fase correspondiente. La navegación, el rol y el
          aislamiento por sucursal ya están activos.
        </p>
        <div className="mt-4 inline-flex items-center gap-2 rounded-[10px] bg-bg px-3.5 py-2.5 text-[13px] font-semibold text-ink">
          <span className="h-2 w-2 rounded-full bg-ok" /> {scope}
        </div>
      </div>
    </div>
  );
}
