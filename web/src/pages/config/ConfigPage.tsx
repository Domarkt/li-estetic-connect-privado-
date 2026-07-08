import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/Toast';
import type { BranchGoal, IntegrationsView, PointsRule, RewardItem } from '../../lib/types';

type Tab = 'negocio' | 'metas' | 'reglas' | 'premios' | 'integraciones';
const TABS: { key: Tab; label: string }[] = [
  { key: 'negocio', label: 'Negocio y sucursales' },
  { key: 'metas', label: 'Metas por sucursal' },
  { key: 'reglas', label: 'Reglas de puntos' },
  { key: 'premios', label: 'Premios' },
  { key: 'integraciones', label: 'Integraciones' },
];

export default function ConfigPage() {
  const [tab, setTab] = useState<Tab>('negocio');
  return (
    <div className="animate-fade">
      <div className="mb-4 flex gap-2">
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} className="rounded-[10px] px-4 py-2 text-[13px] font-bold transition"
              style={{ background: on ? 'var(--magenta)' : 'var(--card)', color: on ? '#fff' : 'var(--muted)', border: `1px solid ${on ? 'var(--magenta)' : 'var(--line)'}` }}>{t.label}</button>
          );
        })}
      </div>
      {tab === 'negocio' && <BusinessTab />}
      {tab === 'metas' && <GoalsTab />}
      {tab === 'reglas' && <RulesTab />}
      {tab === 'premios' && <RewardsTab />}
      {tab === 'integraciones' && <IntegrationsTab />}
    </div>
  );
}

// ── Negocio y sucursales ──
function BusinessTab() {
  const toast = useToast();
  const [branches, setBranches] = useState<BranchGoal[]>([]);
  useEffect(() => { api.get<BranchGoal[]>('/config/branch-goals').then(setBranches).catch(() => {}); }, []);

  function set(id: string, k: keyof BranchGoal, v: string) { setBranches((g) => g.map((b) => b.id === id ? { ...b, [k]: v } : b)); }
  async function save(b: BranchGoal) {
    await api.patch(`/config/branches/${b.id}`, { name: b.name, place: b.place, address: b.address, phone: b.phone });
    toast(`Datos de ${b.name} guardados`);
  }

  return (
    <div>
      <div className="mb-3.5 rounded-base border border-line bg-card p-4 text-[12.5px] text-muted shadow-card">
        <b className="text-navy">RNC del negocio:</b> 1-31-46233-2 (único para las 3 sucursales) · La <b className="text-navy">dirección y teléfono</b> de cada sucursal se imprimen en el recibo.
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {branches.map((b) => (
          <div key={b.id} className="rounded-base border border-line bg-card p-5 shadow-card">
            <div className="mb-3 flex items-center gap-2.5"><span className="h-3 w-3 rounded-full" style={{ background: b.dotColor }} /><span className="text-[11px] font-bold uppercase text-faint">{b.code}</span></div>
            <label className="mb-2.5 block"><span className="mb-1 block text-[11.5px] font-bold text-muted">Nombre</span><input className={inp} value={b.name} onChange={(e) => set(b.id, 'name', e.target.value)} /></label>
            <label className="mb-2.5 block"><span className="mb-1 block text-[11.5px] font-bold text-muted">Ubicación (plaza/nivel)</span><input className={inp} value={b.place} onChange={(e) => set(b.id, 'place', e.target.value)} /></label>
            <label className="mb-2.5 block"><span className="mb-1 block text-[11.5px] font-bold text-muted">Dirección (recibo)</span><input className={inp} value={b.address} onChange={(e) => set(b.id, 'address', e.target.value)} /></label>
            <label className="mb-3.5 block"><span className="mb-1 block text-[11.5px] font-bold text-muted">Teléfono</span><input className={inp} value={b.phone} onChange={(e) => set(b.id, 'phone', e.target.value)} /></label>
            <button onClick={() => save(b)} className="w-full rounded-[10px] bg-magenta py-2.5 text-[13px] font-bold text-white">Guardar datos</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Integraciones ──
function IntegrationsTab() {
  const toast = useToast();
  const [d, setD] = useState<IntegrationsView | null>(null);
  const [openGuide, setOpenGuide] = useState<string | null>(null);

  const load = () => api.get<IntegrationsView>('/config/integrations').then(setD).catch(() => {});
  useEffect(() => { load(); }, []);

  const [waPhone, setWaPhone] = useState('');
  const [waToken, setWaToken] = useState('');
  const [waTest, setWaTest] = useState('');
  const [waOpen, setWaOpen] = useState(false);

  async function toggleChannel(key: string, connected: boolean) {
    if (connected) await api.post(`/config/integrations/${key}/disconnect`);
    else { const r = await api.post<{ message: string }>(`/config/integrations/${key}/connect`); toast(r.message); }
    load();
  }
  async function saveWhatsApp() {
    if (!waPhone.trim() || !waToken.trim()) { toast('Phone Number ID y token requeridos'); return; }
    const r = await api.post<{ message: string }>('/config/integrations/whatsapp/connect', { phoneId: waPhone.trim(), token: waToken.trim() });
    toast(r.message); load();
  }
  async function sendWaTest() {
    if (!waTest.trim()) { toast('Escribe el número de prueba'); return; }
    try { const r = await api.post<{ message: string }>('/config/whatsapp/test', { to: waTest.trim() }); toast(r.message); }
    catch (e) { toast(e instanceof Error ? e.message : 'Error'); }
  }
  async function toggleCalendar(branchId: string, connected: boolean, name: string) {
    if (connected) { await api.post(`/config/calendar/${branchId}/disconnect`); toast(`Calendario de ${name} desconectado`); }
    else {
      const r = await api.post<{ redirect?: string; message?: string }>(`/config/calendar/${branchId}/connect`);
      if (r.redirect) { window.location.href = r.redirect; return; }
      toast(r.message ?? 'Conectado');
    }
    load();
  }

  if (!d) return <div className="text-sm text-muted">Cargando…</div>;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="mb-1 text-[15px] font-extrabold">Canales de mensajería</div>
        <div className="mb-3 text-[12.5px] text-muted">Conecta las plataformas para recibir mensajes en la bandeja omnicanal. Cada tarjeta incluye la guía del proceso.</div>
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
          {d.channels.map((c) => (
            <div key={c.key} className="rounded-base border border-line bg-card p-4 shadow-card">
              <div className="mb-2 flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg text-[12px] font-extrabold text-white" style={{ background: c.color }}>{c.label.slice(0, 2).toUpperCase()}</span>
                <div className="flex-1"><div className="text-[13.5px] font-bold leading-tight">{c.label}</div>
                  <div className="text-[11px] font-bold" style={{ color: c.connected ? 'var(--ok)' : 'var(--faint)' }}>{c.connected ? `● Conectado${c.mode === 'demo' ? ' (demo)' : ''}` : '○ Sin conectar'}</div>
                </div>
              </div>
              {!c.credentialsConfigured && <div className="mb-2 rounded-md bg-warn-soft px-2 py-1 text-[10.5px] font-semibold text-warn">Credenciales no configuradas en .env</div>}
              <div className="flex gap-2">
                <button onClick={() => toggleChannel(c.key, c.connected)} className="flex-1 rounded-[9px] py-2 text-[12px] font-bold" style={c.connected ? { background: 'var(--danger-soft)', color: 'var(--danger)' } : { background: 'var(--magenta)', color: '#fff' }}>{c.connected ? 'Desconectar' : 'Conectar'}</button>
                <button onClick={() => setOpenGuide(openGuide === c.key ? null : c.key)} className="rounded-[9px] border border-line bg-bg px-3 py-2 text-[12px] font-bold text-muted">Guía</button>
              </div>
              {openGuide === c.key && (
                <ol className="mt-3 list-decimal space-y-1 pl-4 text-[11.5px] leading-snug text-muted">
                  {c.steps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* WhatsApp de prueba: credenciales + envío de prueba */}
      <div className="rounded-base border border-line bg-card p-4 shadow-card">
        <button onClick={() => setWaOpen(!waOpen)} className="flex w-full items-center gap-2 text-left">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg text-[11px] font-extrabold text-white" style={{ background: '#25D366' }}>WA</span>
          <span className="flex-1 text-[14px] font-extrabold">Conectar WhatsApp de prueba (WhatsApp Cloud API)</span>
          <span className="text-muted">{waOpen ? '▲' : '▼'}</span>
        </button>
        {waOpen && (
          <div className="mt-3 flex flex-col gap-2.5">
            <div className="rounded-md bg-navy-soft px-3 py-2 text-[11.5px] leading-snug text-navy">
              En <b>Meta for Developers</b> → tu app → WhatsApp → API Setup: copia el <b>Phone number ID</b> y el <b>token temporal</b>, y agrega tu número como destinatario de prueba. Pégalos aquí para validar el envío.
            </div>
            <label className="flex flex-col gap-1"><span className="text-[11.5px] font-bold text-muted">Phone Number ID</span><input value={waPhone} onChange={(e) => setWaPhone(e.target.value)} placeholder="123456789012345" className={inp} /></label>
            <label className="flex flex-col gap-1"><span className="text-[11.5px] font-bold text-muted">Token de acceso</span><input value={waToken} onChange={(e) => setWaToken(e.target.value)} placeholder="EAAG..." className={inp} /></label>
            <button onClick={saveWhatsApp} className="rounded-[9px] bg-magenta py-2.5 text-[13px] font-bold text-white">Guardar credenciales</button>
            <div className="mt-1 flex items-end gap-2">
              <label className="flex flex-1 flex-col gap-1"><span className="text-[11.5px] font-bold text-muted">Número de prueba (con país)</span><input value={waTest} onChange={(e) => setWaTest(e.target.value)} placeholder="1 809 000 0000" className={inp} /></label>
              <button onClick={sendWaTest} className="rounded-[9px] border border-line bg-bg px-4 py-2.5 text-[12.5px] font-bold text-navy hover:border-magenta">Enviar prueba</button>
            </div>
          </div>
        )}
      </div>

      <div>
        <div className="mb-1 text-[15px] font-extrabold">Calendario / correo por sucursal</div>
        <div className="mb-3 text-[12.5px] text-muted">Cada estética conecta el correo de su agenda con Google Calendar para sincronizar sus citas.</div>
        {!d.googleConfigured && (
          <details className="mb-3 rounded-base border border-line bg-card p-3.5 text-[12.5px] shadow-card">
            <summary className="cursor-pointer font-bold text-navy">¿Cómo conectar Google Calendar? (guía)</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-4 leading-snug text-muted">{d.calendarGuide.map((s, i) => <li key={i}>{s}</li>)}</ol>
          </details>
        )}
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
          {d.calendars.map((c) => (
            <div key={c.branchId} className="rounded-base border border-line bg-card p-4 shadow-card">
              <div className="mb-2.5 flex items-center gap-2.5"><span className="h-3 w-3 rounded-full" style={{ background: c.dotColor }} /><div><div className="text-[13.5px] font-extrabold">{c.name}</div><div className="text-[11px] font-bold" style={{ color: c.connected ? 'var(--ok)' : 'var(--faint)' }}>{c.connected ? `● Conectado${c.mode === 'demo' ? ' (demo)' : ''}` : '○ Sin conectar'}</div></div></div>
              <button onClick={() => toggleCalendar(c.branchId, c.connected, c.name)} className="flex w-full items-center justify-center gap-2 rounded-[9px] py-2 text-[12px] font-bold" style={c.connected ? { background: 'var(--danger-soft)', color: 'var(--danger)' } : { background: 'var(--card)', color: 'var(--navy)', border: '1px solid var(--line)' }}>
                {!c.connected && <span className="flex h-4 w-4 items-center justify-center rounded bg-navy-soft text-[9px] font-extrabold" style={{ color: '#4285F4' }}>G</span>}
                {c.connected ? 'Desconectar' : 'Conectar Calendar'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const inp = 'w-full rounded-lg border border-line px-3 py-2 text-[13px] outline-none focus:border-magenta';

// ── Metas ──
function GoalsTab() {
  const toast = useToast();
  const [goals, setGoals] = useState<BranchGoal[]>([]);
  useEffect(() => { api.get<BranchGoal[]>('/config/branch-goals').then(setGoals).catch(() => {}); }, []);

  function set(id: string, k: keyof BranchGoal, v: number) { setGoals((g) => g.map((b) => b.id === id ? { ...b, [k]: v } : b)); }
  async function save(b: BranchGoal) {
    await api.patch(`/config/branch-goals/${b.id}`, { monthlyGoal: b.monthlyGoal, dailyGoal: b.dailyGoal, perAsesorGoal: b.perAsesorGoal });
    toast(`Metas de ${b.name} guardadas`);
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {goals.map((b) => (
        <div key={b.id} className="rounded-base border border-line bg-card p-5 shadow-card">
          <div className="mb-4 flex items-center gap-2.5"><span className="h-3 w-3 rounded-full" style={{ background: b.dotColor }} /><div><div className="text-base font-extrabold">{b.name}</div><div className="text-xs text-muted">{b.place}</div></div></div>
          <label className="mb-2.5 block"><span className="mb-1 block text-[11.5px] font-bold text-muted">Meta mensual (RD$)</span><input type="number" className={inp} value={b.monthlyGoal} onChange={(e) => set(b.id, 'monthlyGoal', +e.target.value)} /></label>
          <label className="mb-2.5 block"><span className="mb-1 block text-[11.5px] font-bold text-muted">Meta diaria (RD$)</span><input type="number" className={inp} value={b.dailyGoal} onChange={(e) => set(b.id, 'dailyGoal', +e.target.value)} /></label>
          <label className="mb-3.5 block"><span className="mb-1 block text-[11.5px] font-bold text-muted">Meta por asesora (RD$)</span><input type="number" className={inp} value={b.perAsesorGoal} onChange={(e) => set(b.id, 'perAsesorGoal', +e.target.value)} /></label>
          <button onClick={() => save(b)} className="w-full rounded-[10px] bg-magenta py-2.5 text-[13px] font-bold text-white">Guardar metas</button>
        </div>
      ))}
    </div>
  );
}

// ── Reglas de puntos ──
function RulesTab() {
  const toast = useToast();
  const [rules, setRules] = useState<PointsRule[]>([]);
  const [nl, setNl] = useState(''); const [np, setNp] = useState(''); const [earn, setEarn] = useState(true);

  const load = () => api.get<PointsRule[]>('/config/points-rules').then(setRules).catch(() => {});
  useEffect(() => { load(); }, []);

  async function add() {
    if (!nl.trim() || !np) { toast('Etiqueta y puntos requeridos'); return; }
    await api.post('/config/points-rules', { label: nl.trim(), points: Math.abs(+np), isEarn: earn });
    setNl(''); setNp(''); toast('Regla agregada'); load();
  }
  async function del(id: string) { await api.del(`/config/points-rules/${id}`); toast('Regla eliminada'); load(); }

  const list = (isEarn: boolean) => rules.filter((r) => r.isEarn === isEarn);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-2.5 rounded-base border border-line bg-card p-4 shadow-card">
        <label className="flex-1"><span className="mb-1 block text-[11.5px] font-bold text-muted">Nueva regla</span><input className={inp} value={nl} onChange={(e) => setNl(e.target.value)} placeholder="Ej. Venta antes de 11 AM" /></label>
        <label><span className="mb-1 block text-[11.5px] font-bold text-muted">Puntos</span><input type="number" className="w-24 rounded-lg border border-line px-3 py-2 text-[13px]" value={np} onChange={(e) => setNp(e.target.value)} placeholder="50" /></label>
        <div className="flex gap-1.5">
          <button onClick={() => setEarn(true)} className="rounded-lg px-3 py-2 text-[12px] font-bold" style={{ background: earn ? 'var(--ok-soft)' : 'var(--bg)', color: earn ? 'var(--ok)' : 'var(--muted)' }}>Ganar</button>
          <button onClick={() => setEarn(false)} className="rounded-lg px-3 py-2 text-[12px] font-bold" style={{ background: !earn ? 'var(--danger-soft)' : 'var(--bg)', color: !earn ? 'var(--danger)' : 'var(--muted)' }}>Deducir</button>
        </div>
        <button onClick={add} className="rounded-[10px] bg-magenta px-4 py-2 text-[13px] font-bold text-white">+ Agregar</button>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <RuleCol title="＋ Cómo ganar puntos" color="var(--ok)" rules={list(true)} onDel={del} />
        <RuleCol title="－ Deducciones" color="var(--danger)" rules={list(false)} onDel={del} />
      </div>
    </div>
  );
}

function RuleCol({ title, color, rules, onDel }: { title: string; color: string; rules: PointsRule[]; onDel: (id: string) => void }) {
  return (
    <div className="rounded-base border border-line bg-card p-5 shadow-card">
      <div className="mb-3 text-[14.5px] font-bold" style={{ color }}>{title}</div>
      {rules.map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-3 border-b border-line-2 px-0.5 py-2 text-[13px]">
          <span>{r.label}</span>
          <div className="flex items-center gap-3">
            <span className="font-extrabold" style={{ color }}>{r.points > 0 ? `+${r.points}` : r.points}</span>
            <button onClick={() => onDel(r.id)} className="text-faint hover:text-danger" title="Eliminar">✕</button>
          </div>
        </div>
      ))}
      {rules.length === 0 && <div className="py-4 text-center text-[12.5px] text-faint">Sin reglas.</div>}
    </div>
  );
}

// ── Premios ──
function RewardsTab() {
  const toast = useToast();
  const [rewards, setRewards] = useState<RewardItem[]>([]);
  const [nl, setNl] = useState(''); const [nc, setNc] = useState('');

  const load = () => api.get<RewardItem[]>('/config/rewards').then(setRewards).catch(() => {});
  useEffect(() => { load(); }, []);

  async function add() {
    if (!nl.trim() || !nc) { toast('Nombre y costo requeridos'); return; }
    await api.post('/config/rewards', { label: nl.trim(), cost: +nc });
    setNl(''); setNc(''); toast('Premio agregado'); load();
  }
  async function del(id: string) { await api.del(`/config/rewards/${id}`); toast('Premio eliminado'); load(); }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-2.5 rounded-base border border-line bg-card p-4 shadow-card">
        <label className="flex-1"><span className="mb-1 block text-[11.5px] font-bold text-muted">Nuevo premio</span><input className={inp} value={nl} onChange={(e) => setNl(e.target.value)} placeholder="Ej. Día de spa" /></label>
        <label><span className="mb-1 block text-[11.5px] font-bold text-muted">Costo (pts)</span><input type="number" className="w-28 rounded-lg border border-line px-3 py-2 text-[13px]" value={nc} onChange={(e) => setNc(e.target.value)} placeholder="3000" /></label>
        <button onClick={add} className="rounded-[10px] bg-magenta px-4 py-2 text-[13px] font-bold text-white">+ Agregar</button>
      </div>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
        {rewards.map((r) => (
          <div key={r.id} className="flex items-center gap-3 rounded-base border border-line bg-card p-4 shadow-card">
            <div className="flex h-[42px] w-[42px] items-center justify-center rounded-[11px] bg-magenta-soft text-lg text-magenta">{r.icon}</div>
            <div className="flex-1"><div className="text-[13.5px] font-bold">{r.label}</div><div className="text-xs text-muted">{r.cost} pts · canjeable</div></div>
            <button onClick={() => del(r.id)} className="text-faint hover:text-danger" title="Eliminar">✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}
