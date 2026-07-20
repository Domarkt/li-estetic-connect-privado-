import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { Overlay, stop } from '../../components/Modal';
import type { BranchGoal, IntegrationsView, PointsRule, RewardItem } from '../../lib/types';

type Tab = 'negocio' | 'metas' | 'reglas' | 'premios' | 'integraciones' | 'mantenimiento';
const TABS: { key: Tab; label: string }[] = [
  { key: 'negocio', label: 'Negocio y sucursales' },
  { key: 'metas', label: 'Metas por sucursal' },
  { key: 'reglas', label: 'Reglas de puntos' },
  { key: 'premios', label: 'Premios' },
  { key: 'integraciones', label: 'Integraciones' },
  { key: 'mantenimiento', label: 'Mantenimiento de datos' },
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
      {tab === 'mantenimiento' && <MaintenanceTab />}
    </div>
  );
}

// ── Mantenimiento de datos (solo admin): borrado por categoría, sin tocar la base de datos ──
type SummaryItem = { label: string; count: number };
type Summary = Record<string, SummaryItem>;
const PURGE_ORDER: { key: string; title: string }[] = [
  { key: 'patients', title: 'Pacientes e historial' },
  { key: 'appointments', title: 'Citas (agenda)' },
  { key: 'billing', title: 'Cobros y facturas' },
  { key: 'messages', title: 'Mensajes' },
  { key: 'cashclose', title: 'Cuadres de caja' },
  { key: 'assets', title: 'Equipos' },
  { key: 'inventory', title: 'Inventario (productos e insumos)' },
];

function MaintenanceTab() {
  const toast = useToast();
  const [summary, setSummary] = useState<Summary>({});
  const [confirming, setConfirming] = useState<{ key: string; title: string; label: string; count: number } | null>(null);

  const load = () => api.get<Summary>('/maintenance/summary').then(setSummary).catch(() => {});
  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="mb-3.5 rounded-base border px-4 py-3 text-[12.5px] font-semibold" style={{ background: 'var(--danger-soft)', borderColor: '#F0C9C9', color: 'var(--danger)' }}>
        ⚠ Zona delicada. Cada botón elimina <b>definitivamente</b> esa categoría en <b>todas las sucursales</b>. No se puede deshacer. Se conservan sucursales, colaboradores y el catálogo de servicios/paquetes/combos.
      </div>
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
        {PURGE_ORDER.map((p) => {
          const s = summary[p.key];
          return (
            <div key={p.key} className="flex items-center gap-3 rounded-base border border-line bg-card p-4 shadow-card">
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-bold">{p.title}</div>
                <div className="text-[12px] text-muted">{s ? s.label : '—'}</div>
                <div className="mt-1 text-[11.5px] font-bold text-navy">{s ? `${s.count} registro(s)` : 'Cargando…'}</div>
              </div>
              <button
                onClick={() => s && setConfirming({ key: p.key, title: p.title, label: s.label, count: s.count })}
                disabled={!s || s.count === 0}
                className="flex-none rounded-[9px] border px-3 py-2 text-[12.5px] font-bold disabled:opacity-40"
                style={{ borderColor: 'var(--danger)', color: 'var(--danger)', background: 'var(--danger-soft)' }}>
                Borrar
              </button>
            </div>
          );
        })}
      </div>
      {confirming && (
        <PurgeConfirm item={confirming} onClose={() => setConfirming(null)}
          onDone={(msg) => { toast(msg); setConfirming(null); load(); }} />
      )}
    </div>
  );
}

function PurgeConfirm({ item, onClose, onDone }: { item: { key: string; title: string; label: string; count: number }; onClose: () => void; onDone: (msg: string) => void }) {
  const toast = useToast();
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = word.trim().toUpperCase() === 'BORRAR';

  async function run() {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const r = await api.post<{ message: string }>('/maintenance/purge', { target: item.key, confirm: 'BORRAR' });
      onDone(r.message);
    } catch (e) { toast(e instanceof Error ? e.message : 'Error al borrar'); }
    finally { setBusy(false); }
  }

  return (
    <Overlay onClose={onClose} z={130}>
      <div onClick={stop} className="w-[440px] max-w-full overflow-hidden rounded-2xl bg-card animate-pop" style={{ boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
        <div className="border-b border-line px-6 py-5 text-base font-extrabold" style={{ color: 'var(--danger)' }}>Eliminar: {item.title}</div>
        <div className="flex flex-col gap-3 px-6 py-5">
          <div className="text-[13px] text-muted">Vas a borrar <b>{item.label.toLowerCase()}</b> — <b style={{ color: 'var(--danger)' }}>{item.count} registro(s)</b> en todas las sucursales. Esta acción <b>no se puede deshacer</b>.</div>
          <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Para confirmar, escribe <b>BORRAR</b></span>
            <input autoFocus value={word} onChange={(e) => setWord(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} placeholder="BORRAR" className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" /></label>
        </div>
        <div className="flex gap-2.5 border-t border-line px-6 py-4">
          <button onClick={onClose} className="flex-1 rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">Cancelar</button>
          <button onClick={run} disabled={!ready || busy} className="flex-[2] rounded-[10px] py-3 text-[13.5px] font-bold text-white disabled:opacity-40" style={{ background: 'var(--danger)' }}>{busy ? 'Borrando…' : 'Borrar definitivamente'}</button>
        </div>
      </div>
    </Overlay>
  );
}

// ── Negocio y sucursales ──
function BusinessTab() {
  const toast = useToast();
  const [branches, setBranches] = useState<BranchGoal[]>([]);
  useEffect(() => { api.get<BranchGoal[]>('/config/branch-goals').then(setBranches).catch(() => {}); }, []);

  function set(id: string, k: keyof BranchGoal, v: string) { setBranches((g) => g.map((b) => b.id === id ? { ...b, [k]: v } : b)); }
  async function save(b: BranchGoal) {
    await api.patch(`/config/branches/${b.id}`, { name: b.name, place: b.place, address: b.address, phone: b.phone, email: b.email ?? '' });
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
            <label className="mb-2.5 block"><span className="mb-1 block text-[11.5px] font-bold text-muted">Teléfono</span><input className={inp} value={b.phone} onChange={(e) => set(b.id, 'phone', e.target.value)} /></label>
            <label className="mb-3.5 block"><span className="mb-1 block text-[11.5px] font-bold text-muted">Correo de la sucursal</span><input className={inp} value={b.email ?? ''} onChange={(e) => set(b.id, 'email', e.target.value)} placeholder="sucursal@gmail.com" /></label>
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
  const [openKey, setOpenKey] = useState<string | null>(null); // canal con el formulario abierto
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [waTest, setWaTest] = useState('');

  const load = () => api.get<IntegrationsView>('/config/integrations').then(setD).catch(() => {});
  useEffect(() => { load(); }, []);

  function openForm(key: string) {
    setForm({});
    setOpenKey(openKey === key ? null : key);
  }

  async function connectChannel(key: string, fields: { name: string; label: string }[]) {
    for (const f of fields) {
      if (!form[f.name]?.trim()) { toast(`Completa "${f.label}"`); return; }
    }
    setBusy(true);
    try {
      const r = await api.post<{ message: string }>(`/config/integrations/${key}/connect`, form);
      toast(r.message); setOpenKey(null); setForm({}); load();
    } catch (e) { toast(e instanceof Error ? e.message : 'Error al conectar'); }
    finally { setBusy(false); }
  }
  async function disconnectChannel(key: string) {
    if (!window.confirm('¿Desconectar este canal?')) return;
    await api.post(`/config/integrations/${key}/disconnect`).catch(() => {});
    toast('Canal desconectado'); load();
  }
  async function sendWaTest() {
    if (!waTest.trim()) { toast('Escribe el número de prueba'); return; }
    try { const r = await api.post<{ message: string }>('/config/whatsapp/test', { to: waTest.trim() }); toast(r.message); }
    catch (e) { toast(e instanceof Error ? e.message : 'Error'); }
  }
  async function connectCalendar(branchId: string) {
    try {
      const r = await api.post<{ redirect?: string }>(`/config/calendar/${branchId}/connect`);
      if (r.redirect) { window.location.href = r.redirect; return; } // OAuth real de Google
      load();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo conectar'); }
  }
  async function disconnectCalendar(branchId: string, name: string) {
    await api.post(`/config/calendar/${branchId}/disconnect`).catch(() => {});
    toast(`Calendario de ${name} desconectado`); load();
  }

  if (!d) return <div className="text-sm text-muted">Cargando…</div>;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="mb-1 text-[15px] font-extrabold">Canales de mensajería</div>
        <div className="mb-3 text-[12.5px] text-muted">Pulsa <b>Conectar</b> para ingresar las credenciales reales de cada plataforma. Solo aparece “Conectado” cuando la conexión es real.</div>
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
          {d.channels.map((c) => (
            <div key={c.key} className="rounded-base border border-line bg-card p-4 shadow-card">
              <div className="mb-2 flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg text-[12px] font-extrabold text-white" style={{ background: c.color }}>{c.label.slice(0, 2).toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-bold leading-tight">{c.label}</div>
                  <div className="truncate text-[11px] font-bold" style={{ color: c.connected ? 'var(--ok)' : 'var(--faint)' }}>{c.connected ? `● Conectado · ${c.account}` : '○ Sin conectar'}</div>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => openForm(c.key)} className="flex-1 rounded-[9px] py-2 text-[12px] font-bold" style={openKey === c.key ? { background: 'var(--bg)', color: 'var(--muted)', border: '1px solid var(--line)' } : { background: 'var(--magenta)', color: '#fff' }}>{openKey === c.key ? 'Cerrar' : c.connected ? 'Editar conexión' : 'Conectar'}</button>
                {c.connected && <button onClick={() => disconnectChannel(c.key)} className="rounded-[9px] px-3 py-2 text-[12px] font-bold" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>Desconectar</button>}
              </div>

              {openKey === c.key && (
                <div className="mt-3 flex flex-col gap-2.5 border-t border-line pt-3">
                  <ol className="list-decimal space-y-1 pl-4 text-[11px] leading-snug text-muted">{c.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                  {c.fields.map((f) => (
                    <label key={f.name} className="flex flex-col gap-1">
                      <span className="text-[11.5px] font-bold text-muted">{f.label}</span>
                      <input value={form[f.name] ?? ''} onChange={(e) => setForm((s) => ({ ...s, [f.name]: e.target.value }))} placeholder={f.placeholder} className={inp} />
                    </label>
                  ))}
                  <button onClick={() => connectChannel(c.key, c.fields)} disabled={busy} className="rounded-[9px] bg-magenta py-2.5 text-[13px] font-bold text-white disabled:opacity-60">Guardar y conectar</button>
                  {c.key === 'whatsapp' && c.connected && (
                    <div className="mt-1 flex items-end gap-2 border-t border-line pt-2.5">
                      <label className="flex flex-1 flex-col gap-1"><span className="text-[11.5px] font-bold text-muted">Enviar prueba a (con país)</span><input value={waTest} onChange={(e) => setWaTest(e.target.value)} placeholder="1 809 000 0000" className={inp} /></label>
                      <button onClick={sendWaTest} className="rounded-[9px] border border-line bg-bg px-4 py-2.5 text-[12.5px] font-bold text-navy hover:border-magenta">Enviar</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 text-[15px] font-extrabold">Calendario / correo por sucursal</div>
        <div className="mb-3 text-[12.5px] text-muted">Cada estética conecta su agenda con Google Calendar (inicio de sesión real de Google) para sincronizar las citas.</div>
        {!d.googleConfigured && (
          <div className="mb-3 rounded-base border border-line bg-warn-soft p-3.5 text-[12.5px] text-warn shadow-card">
            <b>Google Calendar aún no está configurado.</b> Para habilitar la conexión hay que crear credenciales OAuth de Google (GOOGLE_CLIENT_ID/SECRET) en el servidor.
            <details className="mt-2"><summary className="cursor-pointer font-bold">Ver guía</summary>
              <ol className="mt-2 list-decimal space-y-1 pl-4 leading-snug">{d.calendarGuide.map((s, i) => <li key={i}>{s}</li>)}</ol>
            </details>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
          {d.calendars.map((c) => (
            <div key={c.branchId} className="rounded-base border border-line bg-card p-4 shadow-card">
              <div className="mb-2.5 flex items-center gap-2.5"><span className="h-3 w-3 rounded-full" style={{ background: c.dotColor }} /><div><div className="text-[13.5px] font-extrabold">{c.name}</div><div className="text-[11px] font-bold" style={{ color: c.connected ? 'var(--ok)' : 'var(--faint)' }}>{c.connected ? '● Conectado con Google' : '○ Sin conectar'}</div></div></div>
              {c.connected ? (
                <button onClick={() => disconnectCalendar(c.branchId, c.name)} className="w-full rounded-[9px] py-2 text-[12px] font-bold" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>Desconectar</button>
              ) : (
                <button onClick={() => connectCalendar(c.branchId)} disabled={!d.googleConfigured} title={d.googleConfigured ? '' : 'Configura Google OAuth primero'} className="flex w-full items-center justify-center gap-2 rounded-[9px] py-2 text-[12px] font-bold disabled:opacity-50" style={{ background: 'var(--card)', color: 'var(--navy)', border: '1px solid var(--line)' }}>
                  <span className="flex h-4 w-4 items-center justify-center rounded bg-navy-soft text-[9px] font-extrabold" style={{ color: '#4285F4' }}>G</span>
                  Conectar con Google
                </button>
              )}
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
