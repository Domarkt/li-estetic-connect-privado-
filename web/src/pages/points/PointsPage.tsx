import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/Toast';
import { fmtRD, type CommissionsView, type MyPoints, type PointsRules } from '../../lib/types';

export default function PointsPage() {
  const { staff } = useAuth();
  if (staff?.role === 'ESTETICISTA') return <MyPointsView />;
  return <AdminCommissionsView />;
}

// ───────────── Esteticista ─────────────
function MyPointsView() {
  const toast = useToast();
  const [d, setD] = useState<MyPoints | null>(null);

  const load = useCallback(() => { api.get<MyPoints>('/points/me').then(setD).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  async function redeem(id: string) {
    try { const r = await api.post<{ message: string }>('/points/redeem', { rewardId: id }); toast(r.message); load(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Error'); }
  }

  if (!d) return <div className="text-sm text-muted">Cargando…</div>;

  return (
    <div className="animate-fade">
      <div className="mb-4 grid gap-4" style={{ gridTemplateColumns: '1.1fr 1fr' }}>
        <div className="rounded-base p-6 text-white shadow-card" style={{ background: 'linear-gradient(135deg,#B31C86,#8E1268)' }}>
          <div className="text-[13px] font-semibold opacity-90">Mis Puntos Estrella · Programa Líderes LI</div>
          <div className="my-0.5 flex items-end gap-3.5"><div className="text-[46px] font-extrabold leading-none">{d.points}</div><div className="pb-2 text-sm opacity-90">pts</div></div>
          <div className="mt-3.5 flex gap-5 text-[13px]">
            <div><div className="opacity-80">Nivel</div><div className="text-base font-extrabold">{d.tier} ⭐</div></div>
            <div><div className="opacity-80">Ranking</div><div className="text-base font-extrabold">{d.rank}</div></div>
          </div>
        </div>
        <div className="rounded-base border border-line bg-card p-6 shadow-card">
          <div className="mb-3.5 text-[15px] font-bold">Mi comisión de este mes</div>
          <div className="text-[34px] font-extrabold text-magenta">{fmtRD(d.commission.total)}</div>
          <div className="mt-3.5 flex flex-col gap-1.5 text-[13px]">
            <Line k="Ventas del mes" v={fmtRD(d.commission.sales)} />
            <Line k="Comisión base (8%)" v={fmtRD(d.commission.base)} />
            <Line k={`Bono por puntos (${d.tier})`} v={`+ ${fmtRD(d.commission.bonus)}`} green />
          </div>
        </div>
      </div>
      <div className="grid gap-4" style={{ gridTemplateColumns: '1.2fr 1fr' }}>
        <div className="rounded-base border border-line bg-card p-[22px] shadow-card">
          <div className="mb-3 text-[15px] font-bold">Movimientos de puntos</div>
          {d.ledger.map((l) => (
            <div key={l.id} className="flex items-center gap-3 border-b border-line-2 px-1 py-2.5">
              <div className="flex-1"><div className="text-[13px] font-semibold">{l.label}</div><div className="text-[11.5px] text-faint">{l.time}</div></div>
              <div className="text-sm font-extrabold" style={{ color: l.pts >= 0 ? 'var(--ok)' : 'var(--danger)' }}>{l.pts >= 0 ? `+${l.pts}` : l.pts}</div>
            </div>
          ))}
          {d.ledger.length === 0 && <div className="py-6 text-center text-sm text-muted">Sin movimientos.</div>}
        </div>
        <div className="rounded-base border border-line bg-card p-[22px] shadow-card">
          <div className="mb-3 text-[15px] font-bold">Canjear premios</div>
          {d.rewards.map((r) => (
            <div key={r.id} className="flex items-center gap-3 border-b border-line-2 px-1 py-2.5">
              <span className="text-[15px] text-magenta">{r.icon}</span>
              <div className="flex-1"><div className="text-[13px] font-semibold">{r.label}</div><div className="text-[11.5px] text-faint">{r.cost} pts</div></div>
              <button onClick={() => redeem(r.id)} disabled={!r.affordable}
                className="rounded-lg px-3 py-1.5 text-[12px] font-bold"
                style={r.affordable ? { background: 'var(--magenta)', color: '#fff' } : { background: 'var(--bg)', color: 'var(--faint)', cursor: 'not-allowed' }}>Canjear</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Line({ k, v, green }: { k: string; v: string; green?: boolean }) {
  return <div className="flex justify-between"><span className="text-muted">{k}</span><span className="font-bold" style={green ? { color: 'var(--ok)' } : undefined}>{v}</span></div>;
}

// ───────────── Admin ─────────────
function AdminCommissionsView() {
  const [d, setD] = useState<CommissionsView | null>(null);
  const [rules, setRules] = useState<PointsRules | null>(null);

  useEffect(() => {
    api.get<CommissionsView>('/points/commissions').then(setD).catch(() => {});
    api.get<PointsRules>('/points/rules').then(setRules).catch(() => {});
  }, []);

  if (!d) return <div className="text-sm text-muted">Cargando…</div>;

  return (
    <div className="animate-fade">
      <div className="mb-[18px] flex gap-3.5">
        <Stat label="Comisiones del mes (total)" value={fmtRD(d.totalCommissions)} magenta />
        <Stat label='Trofeo "Estrella LI"' value={`🏆 ${d.trophy}`} />
        <Stat label="Base comisión" value={d.base} />
      </div>

      <div className="mb-[18px] overflow-hidden rounded-base border border-line bg-card shadow-card">
        <div className="grid grid-cols-[1.8fr_1.3fr_.9fr_.9fr_1.1fr_1.1fr] gap-3 border-b border-line px-5 py-3 text-[11.5px] font-bold uppercase tracking-wide text-muted">
          <div>Asesora</div><div>Sucursal</div><div>Puntos</div><div>Nivel</div><div>Ventas mes</div><div>Comisión</div>
        </div>
        {d.rows.map((c) => (
          <div key={c.id} className="grid grid-cols-[1.8fr_1.3fr_.9fr_.9fr_1.1fr_1.1fr] items-center gap-3 border-b border-line-2 px-5 py-3">
            <div className="flex items-center gap-3">
              <div className="w-5 text-[13px] font-extrabold text-faint">{c.rank}</div>
              <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full text-[12px] font-bold text-white" style={{ background: c.avatarColor }}>{c.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</div>
              <div className="text-[13px] font-bold">{c.name}</div>
            </div>
            <div className="text-[12.5px] text-muted">{c.branch}</div>
            <div className="text-[13.5px] font-extrabold text-magenta">{c.points}</div>
            <div><span className="text-[11.5px] font-bold" style={{ color: c.tierColor }}>● {c.tier}</span></div>
            <div className="text-[13px] font-semibold">{fmtRD(c.sales)}</div>
            <div className="text-[13.5px] font-extrabold">{fmtRD(c.commission)}</div>
          </div>
        ))}
      </div>

      {rules && (
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-base border border-line bg-card p-5 shadow-card">
            <div className="mb-3 text-[14.5px] font-bold text-ok">＋ Cómo ganar puntos</div>
            {rules.earn.map((r, i) => <div key={i} className="flex justify-between gap-3 border-b border-line-2 px-0.5 py-2 text-[13px]"><span>{r.label}</span><span className="flex-none font-extrabold text-ok">{r.pts}</span></div>)}
          </div>
          <div className="rounded-base border border-line bg-card p-5 shadow-card">
            <div className="mb-3 text-[14.5px] font-bold text-danger">－ Deducciones</div>
            {rules.deduct.map((r, i) => <div key={i} className="flex justify-between gap-3 border-b border-line-2 px-0.5 py-2 text-[13px]"><span>{r.label}</span><span className="flex-none font-extrabold text-danger">{r.pts}</span></div>)}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, magenta }: { label: string; value: string; magenta?: boolean }) {
  return (
    <div className="flex-1 rounded-xl border border-line bg-card px-[18px] py-4 shadow-card">
      <div className="text-xs font-semibold text-muted">{label}</div>
      <div className="mt-1 text-base font-extrabold" style={magenta ? { color: 'var(--magenta)', fontSize: 22 } : undefined}>{value}</div>
    </div>
  );
}
