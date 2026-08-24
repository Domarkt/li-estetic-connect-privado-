import { useState } from 'react';
import AssetsPanel from './AssetsPanel';
import { useAuth } from '../../auth/AuthContext';
import { useBranch } from '../../layout/BranchContext';

/** Vista de la esteticista: equipos de su sucursal + suministros asignados a ella.
 *  Solo puede consultar y reportar averías/incidentes (no editar). */
export default function EquiposPage() {
  const [tab, setTab] = useState<'EQUIPO' | 'SUMINISTRO'>('EQUIPO');
  const { staff } = useAuth();
  const { activeBranch } = useBranch();
  const coordinator = staff?.role === 'COORDINADOR';
  const branchQ = coordinator && activeBranch !== 'all' ? `branch=${activeBranch}` : '';

  return (
    <div className="animate-fade">
      <div className="mb-4 flex gap-2">
        {(['EQUIPO', 'SUMINISTRO'] as const).map((k) => {
          const on = tab === k;
          return (
            <button key={k} onClick={() => setTab(k)}
              className="rounded-[10px] px-4 py-2 text-[13px] font-bold transition"
              style={{ background: on ? 'var(--magenta)' : 'var(--card)', color: on ? '#fff' : 'var(--muted)', border: `1px solid ${on ? 'var(--magenta)' : 'var(--line)'}` }}>
              {k === 'EQUIPO' ? 'Equipos' : 'Mis suministros'}
            </button>
          );
        })}
      </div>
      <div className="mb-3 rounded-xl border border-line bg-card px-4 py-3 text-[12.5px] text-muted">
        Puedes consultar y <b>reportar averías o incidentes</b>. El administrador recibe el aviso.
      </div>
      <AssetsPanel kind={tab} canManage={false} branchQ={branchQ} mine={!coordinator && tab === 'SUMINISTRO'} />
    </div>
  );
}
