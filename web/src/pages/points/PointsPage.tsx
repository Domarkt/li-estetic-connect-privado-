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
  const [adjustFor, setAdjustFor] = useState<{ id: string; name: string; points: number } | null>(null);

  const load = useCallback(() => {
    api.get<CommissionsView>('/points/commissions').then(setD).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    api.get<PointsRules>('/points/rules').then(setRules).catch(() => {});
  }, [load]);

  if (!d) return <div className="text-sm text-muted">Cargando…</div>;

  return (
    <div className="animate-fade">
      <div className="mb-[18px] flex gap-3.5">
        <Stat label="Comisiones del mes (total)" value={fmtRD(d.totalCommissions)} magenta />
        <Stat label='Trofeo "Estrella LI"' value={`🏆 ${d.trophy}`} />
        <Stat label="Base comisión" value={d.base} />
      </div>

      <div className="mb-[18px] overflow-hidden rounded-base border border-line bg-card shadow-card">
        <div className="grid grid-cols-[1.5fr_1fr_.7fr_.8fr_1fr_1fr_.9fr] gap-3 border-b border-line px-5 py-3 text-[11.5px] font-bold uppercase tracking-wide text-muted">
          <div>Asesora</div><div>Sucursal</div><div>Puntos</div><div>Nivel</div><div>Ventas mes</div><div>Comisión</div><div className="text-center">Ajustar</div>
        </div>
        {d.rows.map((c) => (
          <div key={c.id} className="grid grid-cols-[1.5fr_1fr_.7fr_.8fr_1fr_1fr_.9fr] items-center gap-3 border-b border-line-2 px-5 py-3">
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
            <div className="flex justify-center">
              <button onClick={() => setAdjustFor({ id: c.id, name: c.name, points: c.points })} title="Sumar o restar puntos"
                className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-[12px] font-bold text-magenta hover:border-magenta">± pts</button>
            </div>
          </div>
        ))}
      </div>

      {adjustFor && <AdjustPointsModal collab={adjustFor} onClose={() => setAdjustFor(null)} onSaved={() => { setAdjustFor(null); load(); }} />}

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

function AdjustPointsModal({ collab, onClose, onSaved }: { collab: { id: string; name: string; points: number }; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const n = Number(amount);
  const valid = amount !== '' && !isNaN(n) && n !== 0;

  async function submit() {
    if (!valid) { toast('Indica cuántos puntos sumar o restar'); return; }
    setBusy(true);
    try {
      const r = await api.post<{ message: string }>('/points/adjust', { userId: collab.id, points: n, label: label.trim() || 'Ajuste manual' });
      toast(r.message);
      onSaved();
    } catch (e) { toast(e instanceof Error ? e.message : 'Error'); }
    finally { setBusy(false); }
  }

  const presets = [5, 10, 20, -5, -10];
  return (
    <div onClick={onClose} className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto p-4 sm:p-7" style={{ background: 'rgba(28,37,64,.5)' }}>
      <div onClick={(e) => e.stopPropagation()} className="my-auto w-[420px] max-w-full overflow-hidden rounded-2xl bg-card animate-pop" style={{ boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
        <div className="flex items-center border-b border-line px-6 py-5"><div className="flex-1"><div className="text-base font-extrabold">Ajustar puntos</div><div className="text-[12.5px] text-muted">{collab.name} · actual: <b>{collab.points} pts</b></div></div><button onClick={onClose} className="h-8 w-8 rounded-lg bg-bg text-muted">×</button></div>
        <div className="flex flex-col gap-3 px-6 py-5">
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button key={p} onClick={() => setAmount(String(p))} className="rounded-lg border px-3 py-1.5 text-[13px] font-bold"
                style={{ borderColor: Number(amount) === p ? 'var(--magenta)' : 'var(--line)', color: p >= 0 ? 'var(--ok)' : 'var(--danger)', background: Number(amount) === p ? 'var(--magenta-soft)' : 'var(--card)' }}>
                {p >= 0 ? `+${p}` : p}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1"><span className="text-xs font-bold text-muted">Cantidad (usa negativo para restar)</span>
            <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9-]/g, ''))} placeholder="Ej: 10 o -5" className="rounded-[10px] border border-line px-4 py-3 text-[15px] font-extrabold outline-none focus:border-magenta" />
          </label>
          <label className="flex flex-col gap-1"><span className="text-xs font-bold text-muted">Motivo</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ej: Puntos del día, puntualidad…" className="rounded-[10px] border border-line px-4 py-2.5 text-[13.5px] outline-none focus:border-magenta" />
          </label>
          {valid && <div className="text-[12px] text-muted">Quedará en <b>{Math.max(0, collab.points + n)} pts</b></div>}
        </div>
        <div className="flex gap-2.5 border-t border-line px-6 py-4">
          <button onClick={onClose} className="flex-1 rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">Cancelar</button>
          <button onClick={submit} disabled={busy || !valid} className="flex-[2] rounded-[10px] bg-magenta py-3 text-[13.5px] font-bold text-white disabled:opacity-60">{busy ? 'Guardando…' : 'Aplicar'}</button>
        </div>
      </div>
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
