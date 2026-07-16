import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Icon } from '../components/icons';
import { fmtRD, type PortalAppointment, type PortalBranch, type PortalHistoryItem, type PortalPackages, type PortalProceso, type PortalProfile } from '../lib/types';
import { ANTECEDENTES, MEDICAMENTOS, FOTOTIPOS, FOTOTIPO_DESC } from './patients/fichaConstants';

interface PortalFichaState {
  status: string; sentToPatient: boolean; filled: boolean; completed: boolean;
  ficha: {
    antecedentes: Record<string, boolean>; medicamentos: Record<string, boolean>; fototipo: string;
    tallaCm: number | null; pesoLb: number | null;
    alturaCm: number | null; cinturaCm: number | null; abdomenCm: number | null; piernaCm: number | null; brazoCm: number | null;
  } | null;
}

type Tab = 'proceso' | 'citas' | 'paquetes' | 'perfil';

export default function PatientPortal() {
  const { patient, logout } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('perfil');

  if (!patient) return null;
  const firstName = patient.name.split(' ')[0];

  function doLogout() { logout(); navigate('/portal/login'); }

  return (
    <div className="flex min-h-screen items-center justify-center p-6" style={{ background: 'linear-gradient(160deg,#EEF1F8,#F7EEF4)' }}>
      <div className="relative flex h-[800px] w-[390px] max-w-full flex-col overflow-hidden rounded-[34px] border border-line bg-bg" style={{ boxShadow: '0 30px 80px rgba(28,37,64,.22)' }}>
        <div className="px-[22px] pb-5 pt-[22px] text-white" style={{ background: 'linear-gradient(135deg,#B31C86,#8E1268)' }}>
          <div className="flex items-center justify-between">
            <div><div className="text-[13px] opacity-85">Hola,</div><div className="text-[21px] font-extrabold">{firstName} 👋</div></div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-[9px] bg-white px-2 py-[5px]"><img src="/li-logo.png" className="h-5" /></div>
              <button onClick={doLogout} title="Salir" className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] text-white" style={{ background: 'rgba(255,255,255,.18)' }}><Icon name="logout" size={17} /></button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-[18px]">
          {tab === 'proceso' && <Proceso />}
          {tab === 'citas' && <Citas />}
          {tab === 'paquetes' && <Paquetes />}
          {tab === 'perfil' && <Perfil />}
        </div>

        <div className="flex border-t border-line bg-card px-3 pb-2.5 pt-1.5">
          {([
            { key: 'perfil', label: 'Mi Ficha', icon: 'users' },
            { key: 'citas', label: 'Citas', icon: 'cal' },
            { key: 'proceso', label: 'Proceso', icon: 'star' },
            { key: 'paquetes', label: 'Paquetes', icon: 'box' },
          ] as const).map((t) => {
            const on = tab === t.key;
            return (
              <button key={t.key} onClick={() => setTab(t.key)} className="flex flex-1 flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-bold transition" style={{ color: on ? 'var(--magenta)' : 'var(--faint)' }}>
                <span className="flex"><Icon name={t.icon} size={20} /></span>{t.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Proceso() {
  const [d, setD] = useState<PortalProceso | null>(null);
  useEffect(() => { api.get<PortalProceso>('/portal/proceso', 'patient').then(setD).catch(() => {}); }, []);
  if (!d) return <div className="text-center text-sm text-muted">Cargando…</div>;

  return (
    <div className="flex animate-fade flex-col gap-4">
      {d.notices && d.notices.length > 0 && d.notices.map((n) => (
        <div key={n.id} className="rounded-[16px] border p-4" style={{ background: 'var(--danger-soft)', borderColor: '#F0C8C8' }}>
          <div className="mb-1 text-[13.5px] font-bold" style={{ color: 'var(--danger)' }}>✕ Cita cancelada por la clínica</div>
          <div className="text-[12.5px] leading-normal" style={{ color: '#8A2E2E' }}>
            {n.service} · {n.date}<br/><b>Motivo:</b> {n.reason}<br/>Contáctanos para reagendar.
          </div>
        </div>
      ))}
      {d.treatment ? (
        <div className="rounded-[18px] bg-card p-5 shadow-card">
          <div className="mb-3.5 flex items-center justify-between">
            <div><div className="text-xs font-semibold text-muted">Mi tratamiento</div><div className="text-base font-extrabold">{d.treatment.name}</div></div>
            <div className="text-right"><div className="text-[26px] font-extrabold leading-none text-magenta">{d.treatment.done}/{d.treatment.total}</div><div className="text-[11px] text-faint">sesiones</div></div>
          </div>
          <div className="mb-4 h-[9px] overflow-hidden rounded-md" style={{ background: 'var(--navy-soft)' }}><div className="h-full rounded-md" style={{ width: `${d.treatment.pct}%`, background: 'linear-gradient(90deg,#B31C86,#D4419E)' }} /></div>
          <div className="flex flex-wrap justify-center gap-2.5">
            {Array.from({ length: d.treatment.total }, (_, i) => i + 1).map((n) => {
              const done = n <= d.treatment!.done;
              return <div key={n} className="flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-bold" style={{ background: done ? 'var(--magenta)' : 'var(--navy-soft)', color: done ? '#fff' : 'var(--faint)' }}>{n}</div>;
            })}
          </div>
        </div>
      ) : <div className="rounded-[18px] bg-card p-5 text-center text-sm text-muted shadow-card">Aún no tienes un tratamiento activo.</div>}

      {d.nextAppointment && (
        <div className="rounded-[18px] bg-card p-[18px] shadow-card">
          <div className="mb-2.5 text-xs font-bold uppercase tracking-wide text-magenta">Tu próxima cita</div>
          <div className="flex items-center gap-3.5">
            <div className="flex h-[52px] w-[52px] flex-none flex-col items-center justify-center rounded-[14px] bg-magenta-soft text-magenta"><div className="text-[18px] font-extrabold leading-none">{d.nextAppointment.day}</div><div className="text-[10px] font-bold">{d.nextAppointment.month}</div></div>
            <div className="flex-1"><div className="text-[15px] font-extrabold">{d.nextAppointment.time}</div><div className="text-[12.5px] text-muted">{d.nextAppointment.service} · {d.nextAppointment.therapist}</div><div className="text-xs text-faint">{d.nextAppointment.branch}</div></div>
          </div>
          {d.nextAppointment.code && (
            <div className="mt-3 rounded-[12px] border border-dashed px-3.5 py-2.5 text-center" style={{ borderColor: 'var(--magenta)', background: 'var(--magenta-soft)' }}>
              <div className="text-[10.5px] font-bold uppercase tracking-wide text-magenta">Tu código de turno</div>
              <div className="text-[22px] font-extrabold tracking-[.3em] text-magenta">{d.nextAppointment.code}</div>
              <div className="text-[10.5px] text-muted">{d.nextAppointment.checkedIn ? '✓ Turno ya abierto' : 'Muéstralo en cabina para abrir tu turno'}</div>
            </div>
          )}
        </div>
      )}

      <div className="rounded-[16px] border p-4" style={{ background: 'var(--teal-soft)', borderColor: '#CFE2F0' }}>
        <div className="mb-1.5 text-[13.5px] font-bold" style={{ color: '#1E5A82' }}>💧 Cuidados post-tratamiento</div>
        <div className="text-[12.5px] leading-normal" style={{ color: '#2C6B94' }}>{d.tips}</div>
      </div>
    </div>
  );
}

function Citas() {
  const toast = useToast();
  const [appts, setAppts] = useState<PortalAppointment[]>([]);
  const [branches, setBranches] = useState<PortalBranch[]>([]);
  const [cancelId, setCancelId] = useState<string | null>(null);

  const load = useCallback(() => { api.get<PortalAppointment[]>('/portal/appointments', 'patient').then(setAppts).catch(() => {}); }, []);
  useEffect(() => {
    load();
    api.get<PortalBranch[]>('/portal/branches', 'patient').then(setBranches).catch(() => {});
  }, [load]);

  function waLink(b: PortalBranch, msg: string) {
    return `https://wa.me/${b.waNumber}?text=${encodeURIComponent(msg)}`;
  }

  return (
    <div className="flex animate-fade flex-col gap-4">
      <div>
        <div className="mx-0.5 mb-2.5 text-sm font-extrabold">Mis próximas citas</div>
        <div className="flex flex-col gap-2.5">
          {appts.map((a) => (
            <div key={a.id} className="rounded-[16px] bg-card p-4 shadow-card">
              <div className="text-sm font-extrabold capitalize">{a.date}</div>
              <div className="mb-2 mt-0.5 text-[12.5px] text-muted">{a.service} · {a.therapist}</div>
              {a.code && (
                <div className="mb-3 flex items-center gap-2 rounded-lg bg-magenta-soft px-2.5 py-1.5">
                  <span className="text-[10.5px] font-bold uppercase text-magenta">Código</span>
                  <span className="text-[15px] font-extrabold tracking-[.2em] text-magenta">{a.code}</span>
                  {a.checkedIn && <span className="ml-auto text-[10.5px] font-bold text-ok">✓ abierto</span>}
                </div>
              )}
              <div className="flex gap-2.5">
                {branches[0] && (
                  <a href={waLink(branches[0], `Hola, quiero reagendar mi cita del ${a.date} (${a.service}).`)} target="_blank" rel="noreferrer"
                    className="flex-1 rounded-[9px] py-2.5 text-center text-[12.5px] font-bold no-underline" style={{ background: 'var(--navy-soft)', color: 'var(--navy)' }}>Reagendar por WhatsApp</a>
                )}
                <button onClick={() => setCancelId(a.id)} className="flex-1 rounded-[9px] py-2.5 text-[12.5px] font-bold" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>Cancelar</button>
              </div>
            </div>
          ))}
          {appts.length === 0 && <div className="rounded-[16px] bg-card p-4 text-center text-sm text-muted shadow-card">No tienes citas próximas.</div>}
        </div>
        <div className="mt-3 px-1 text-[11.5px] leading-normal text-faint">⚠ Recuerda cancelar con 24h de anticipación. Después de 5 cancelaciones se pierde el tratamiento.</div>
      </div>

      {cancelId && <PortalCancelModal onClose={() => setCancelId(null)} onDone={(m) => { toast(m); setCancelId(null); load(); }}
        appointmentId={cancelId} />}

      {/* Solicitar una NUEVA cita por WhatsApp (recepción la confirma en agenda) */}
      <div className="rounded-[18px] bg-card p-5 shadow-card">
        <div className="mb-1 text-[15px] font-extrabold">¿Necesitas otra cita?</div>
        <div className="mb-3.5 text-[12px] text-muted">Escríbele por WhatsApp a la sucursal y recepción te la agenda y confirma.</div>
        <div className="flex flex-col gap-2.5">
          {branches.map((b) => (
            <a key={b.id} href={waLink(b, `Hola ${b.name}, quiero solicitar una cita. Mi nombre es `)} target="_blank" rel="noreferrer"
              className="flex items-center gap-3 rounded-[13px] border border-line px-4 py-3 no-underline transition hover:border-magenta">
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-white" style={{ background: '#25D366' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15l-1.4 5 5.1-1.3A10 10 0 1 0 12 2zm0 18a8 8 0 0 1-4.1-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 1 1 12 20zm4.5-6c-.2-.1-1.4-.7-1.6-.8-.2-.1-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1a6.5 6.5 0 0 1-3.2-2.8c-.1-.2 0-.4.1-.5l.4-.5c.1-.1.1-.3 0-.5l-.7-1.6c-.2-.4-.4-.4-.5-.4h-.5c-.2 0-.4.1-.6.3-.7.7-.9 1.6-.6 2.7.4 1.4 1.4 2.7 3.2 3.9 2.3 1.5 3.4 1.3 4 1.2.5-.1 1.4-.6 1.6-1.1.2-.5.2-1 .1-1.1z"/></svg>
              </span>
              <div className="flex-1"><div className="text-[13.5px] font-bold">{b.name}</div><div className="text-[11.5px] text-muted">{b.phone} · {b.place}</div></div>
              <span className="text-[12px] font-bold text-magenta">Escribir →</span>
            </a>
          ))}
          {branches.length === 0 && <div className="text-[12.5px] text-muted">Cargando sucursales…</div>}
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-[10px] bg-bg px-3 py-2.5"><div className="text-[11px] font-semibold text-muted">{label}</div><div className="text-[13px] font-bold">{value}</div></div>;
}

function MiFicha({ onSaved }: { onSaved?: () => void }) {
  const toast = useToast();
  const [d, setD] = useState<PortalFichaState | null>(null);
  const [open, setOpen] = useState(false);
  const [ant, setAnt] = useState<Record<string, boolean>>({});
  const [med, setMed] = useState<Record<string, boolean>>({});
  const [fototipo, setFototipo] = useState('');
  const [talla, setTalla] = useState('');
  const [peso, setPeso] = useState('');
  const [altura, setAltura] = useState('');
  const [cintura, setCintura] = useState('');
  const [abdomen, setAbdomen] = useState('');
  const [pierna, setPierna] = useState('');
  const [brazo, setBrazo] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<PortalFichaState>('/portal/ficha', 'patient').then((r) => {
      setD(r);
      if (r.ficha) {
        const f = r.ficha; const s = (v: number | null) => (v ? String(v) : '');
        setAnt(f.antecedentes || {}); setMed(f.medicamentos || {});
        setFototipo(f.fototipo || ''); setTalla(s(f.tallaCm)); setPeso(s(f.pesoLb));
        setAltura(s(f.alturaCm)); setCintura(s(f.cinturaCm)); setAbdomen(s(f.abdomenCm)); setPierna(s(f.piernaCm)); setBrazo(s(f.brazoCm));
      }
    }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!d) return null;
  if (d.completed) return (
    <div className="rounded-[16px] border px-4 py-3 text-[12.5px] font-bold" style={{ background: 'var(--ok-soft)', borderColor: '#CDEBDD', color: '#1F7A54' }}>✓ Tu ficha clínica está completa y validada.</div>
  );

  async function save() {
    setBusy(true);
    const num = (v: string) => (v ? Number(v) : undefined);
    try {
      const r = await api.patch<{ message: string }>('/portal/ficha', {
        antecedentes: ant, medicamentos: med,
        fototipo: fototipo || undefined,
        tallaCm: num(talla), pesoLb: num(peso),
        alturaCm: num(altura), cinturaCm: num(cintura), abdomenCm: num(abdomen), piernaCm: num(pierna), brazoCm: num(brazo),
      }, 'patient');
      toast(r.message); setOpen(false); load(); onSaved?.();
    } catch (e) { toast(e instanceof Error ? e.message : 'Error'); }
    finally { setBusy(false); }
  }

  return (
    <div className="rounded-[16px] border px-4 py-3.5" style={{ background: 'var(--magenta-soft)', borderColor: '#F0CDE4' }}>
      <div className="flex items-center justify-between">
        <div className="text-[13.5px] font-extrabold text-magenta-d">📋 Completa tu ficha clínica</div>
        <button onClick={() => setOpen(!open)} className="rounded-[9px] bg-magenta px-3 py-1.5 text-[12px] font-bold text-white">{open ? 'Cerrar' : d.filled ? 'Editar' : 'Completar'}</button>
      </div>
      <div className="mt-1 text-[11.5px]" style={{ color: 'var(--magenta-d)' }}>
        {d.filled ? 'Ya la enviaste · la esteticista la validará contigo. Puedes editarla.' : 'Ayúdanos con tu historial de salud antes de tu cita.'}
      </div>

      {open && (
        <div className="mt-3 flex flex-col gap-3">
          <FichaGroup title="¿Tienes alguno de estos antecedentes?" items={ANTECEDENTES} state={ant} setState={setAnt} />
          <FichaGroup title="¿Tomas alguno de estos medicamentos?" items={MEDICAMENTOS} state={med} setState={setMed} />
          <div className="rounded-[12px] bg-card p-3">
            <div className="mb-2 text-[12px] font-bold text-navy">Fototipo de piel <span className="font-semibold text-muted">(tipo de piel)</span></div>
            <div className="flex gap-1.5">
              {FOTOTIPOS.map((k) => (
                <button key={k} onClick={() => setFototipo(k)} title={FOTOTIPO_DESC[k]} className="flex-1 rounded-lg border py-2 text-[13px] font-extrabold" style={{ borderColor: fototipo === k ? 'var(--magenta)' : 'var(--line)', background: fototipo === k ? 'var(--magenta-soft)' : '#fff', color: fototipo === k ? 'var(--magenta)' : 'var(--ink)' }}>{k}</button>
              ))}
            </div>
            <div className="mt-2 rounded-lg px-2.5 py-2 text-[11px] leading-snug" style={{ background: 'var(--bg)', color: fototipo ? 'var(--ink)' : 'var(--muted)' }}>
              {fototipo ? <><b>Tipo {fototipo}:</b> {FOTOTIPO_DESC[fototipo]}</> : 'Toca cada número para ver la descripción y elegir tu tipo de piel.'}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <label><span className="mb-1 block text-[11px] font-bold text-muted">Altura (cm)</span><input inputMode="numeric" value={altura} onChange={(e) => setAltura(e.target.value)} className="w-full rounded-lg border border-line p-2 text-[13px]" /></label>
              <label><span className="mb-1 block text-[11px] font-bold text-muted">Talla (cm)</span><input inputMode="numeric" value={talla} onChange={(e) => setTalla(e.target.value)} className="w-full rounded-lg border border-line p-2 text-[13px]" /></label>
              <label><span className="mb-1 block text-[11px] font-bold text-muted">Peso (lb)</span><input inputMode="numeric" value={peso} onChange={(e) => setPeso(e.target.value)} className="w-full rounded-lg border border-line p-2 text-[13px]" /></label>
            </div>
            <div className="mt-2.5 text-[11px] font-bold text-navy">Medidas corporales (cm)</div>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <label><span className="mb-1 block text-[11px] font-bold text-muted">Cintura</span><input inputMode="numeric" value={cintura} onChange={(e) => setCintura(e.target.value)} className="w-full rounded-lg border border-line p-2 text-[13px]" /></label>
              <label><span className="mb-1 block text-[11px] font-bold text-muted">Abdomen</span><input inputMode="numeric" value={abdomen} onChange={(e) => setAbdomen(e.target.value)} className="w-full rounded-lg border border-line p-2 text-[13px]" /></label>
              <label><span className="mb-1 block text-[11px] font-bold text-muted">Piernas</span><input inputMode="numeric" value={pierna} onChange={(e) => setPierna(e.target.value)} className="w-full rounded-lg border border-line p-2 text-[13px]" /></label>
              <label><span className="mb-1 block text-[11px] font-bold text-muted">Brazos</span><input inputMode="numeric" value={brazo} onChange={(e) => setBrazo(e.target.value)} className="w-full rounded-lg border border-line p-2 text-[13px]" /></label>
            </div>
          </div>
          <button onClick={save} disabled={busy} className="rounded-[11px] bg-magenta py-3 text-sm font-bold text-white disabled:opacity-60">{busy ? 'Enviando…' : 'Enviar a mi esteticista'}</button>
        </div>
      )}
    </div>
  );
}

function FichaGroup({ title, items, state, setState }: { title: string; items: string[]; state: Record<string, boolean>; setState: (s: Record<string, boolean>) => void }) {
  return (
    <div className="rounded-[12px] bg-card p-3">
      <div className="mb-2 text-[12px] font-bold text-navy">{title}</div>
      <div className="flex flex-col gap-1">
        {items.map((it) => (
          <div key={it} className="flex items-center justify-between border-b border-line-2 py-1.5">
            <span className="text-[12.5px]">{it}</span>
            <div className="flex gap-1.5">
              {[true, false].map((v) => (
                <button key={String(v)} onClick={() => setState({ ...state, [it]: v })}
                  className="rounded-md px-2.5 py-1 text-[11px] font-bold"
                  style={{ background: state[it] === v ? (v ? 'var(--magenta)' : 'var(--navy)') : 'var(--bg)', color: state[it] === v ? '#fff' : 'var(--muted)' }}>
                  {v ? 'Sí' : 'No'}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Perfil() {
  const toast = useToast();
  const [p, setP] = useState<PortalProfile | null>(null);
  const [history, setHistory] = useState<PortalHistoryItem[]>([]);

  const load = useCallback(() => {
    api.get<PortalProfile>('/portal/profile', 'patient').then(setP).catch(() => {});
    api.get<PortalHistoryItem[]>('/portal/history', 'patient').then(setHistory).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!p) return <div className="text-center text-sm text-muted">Cargando…</div>;

  return (
    <div className="flex animate-fade flex-col gap-4">
      <MiFicha onSaved={load} />
      <div className="rounded-[18px] bg-card p-5 shadow-card">
        <div className="text-[17px] font-extrabold">{p.firstName} {p.lastName}</div>
        <div className="text-[12.5px] text-muted">{p.phone}{p.branch ? ` · ${p.branch}` : ''}</div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Info label="Edad" value={p.age != null ? `${p.age} años` : '—'} />
          <Info label="Fototipo" value={p.baseline.fototipo ?? '—'} />
          <Info label="Altura" value={p.baseline.alturaCm ? `${p.baseline.alturaCm} cm` : '—'} />
          <Info label="Talla" value={p.baseline.tallaCm ? `${p.baseline.tallaCm} cm` : '—'} />
          <Info label="Peso" value={p.baseline.pesoLb ? `${p.baseline.pesoLb} lb` : '—'} />
          <Info label="Paciente desde" value={p.since} />
        </div>
        {(p.baseline.cinturaCm || p.baseline.abdomenCm || p.baseline.piernaCm || p.baseline.brazoCm) && (
          <div className="mt-2 grid grid-cols-4 gap-2">
            <Info label="Cintura" value={p.baseline.cinturaCm ? `${p.baseline.cinturaCm}` : '—'} />
            <Info label="Abdomen" value={p.baseline.abdomenCm ? `${p.baseline.abdomenCm}` : '—'} />
            <Info label="Piernas" value={p.baseline.piernaCm ? `${p.baseline.piernaCm}` : '—'} />
            <Info label="Brazos" value={p.baseline.brazoCm ? `${p.baseline.brazoCm}` : '—'} />
          </div>
        )}
        {p.baseline.motivos.length > 0 && (
          <div className="mt-3"><div className="text-[11px] font-semibold text-muted">Motivo inicial</div><div className="mt-1 flex flex-wrap gap-1.5">{p.baseline.motivos.map((m) => <span key={m} className="rounded-full bg-magenta-soft px-2 py-0.5 text-[11px] font-semibold text-magenta">{m}</span>)}</div></div>
        )}
        {p.firstEval && <div className="mt-2 text-[11.5px] text-faint">Primera evaluación: {p.firstEval}</div>}
      </div>

      {p.treatment && (
        <div className="rounded-[18px] bg-card p-5 shadow-card">
          <div className="mb-2 flex items-center justify-between"><div className="text-[13px] font-bold">{p.treatment.name}</div><div className="text-[12.5px] font-semibold text-muted">{p.treatment.done}/{p.treatment.total}</div></div>
          <div className="h-2 overflow-hidden rounded-md" style={{ background: 'var(--navy-soft)' }}><div className="h-full rounded-md" style={{ width: `${p.treatment.pct}%`, background: 'linear-gradient(90deg,#B31C86,#D4419E)' }} /></div>
          <div className="mt-2 text-[11.5px] text-muted">Vas midiendo tu avance sesión a sesión 💜</div>
        </div>
      )}

      <div>
        <div className="mx-0.5 mb-2.5 text-sm font-extrabold">Califica tus citas</div>
        <div className="flex flex-col gap-2.5">
          {history.map((h) => <RateCard key={h.id} item={h} onDone={(msg) => { toast(msg); load(); }} />)}
          {history.length === 0 && <div className="rounded-[16px] bg-card p-4 text-center text-sm text-muted shadow-card">Aún no tienes citas atendidas.</div>}
        </div>
      </div>
    </div>
  );
}

function RateCard({ item, onDone }: { item: PortalHistoryItem; onDone: (msg: string) => void }) {
  const [stars, setStars] = useState(item.rating ?? 0);
  const [comment, setComment] = useState(item.ratingComment ?? '');
  const [busy, setBusy] = useState(false);
  const rated = item.rating != null;

  async function send() {
    if (stars === 0) return;
    if (stars < 5 && !comment.trim()) { onDone('Escribe qué ocurrió (comentario requerido)'); return; }
    setBusy(true);
    try { const r = await api.post<{ message: string }>(`/portal/appointments/${item.id}/rate`, { stars, comment: comment.trim() || undefined }, 'patient'); onDone(r.message); }
    catch (e) { onDone(e instanceof Error ? e.message : 'Error'); }
    finally { setBusy(false); }
  }

  return (
    <div className="rounded-[16px] bg-card p-4 shadow-card">
      <div className="text-[13px] font-bold">{item.service}</div>
      <div className="mb-2 text-[11.5px] text-muted">{item.date} · {item.therapist}{item.durationMin != null ? ` · ⏱ ${item.durationMin} min` : ''}</div>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} disabled={rated} onClick={() => setStars(n)} className="text-[24px] leading-none disabled:cursor-default" style={{ color: n <= stars ? '#F5B301' : 'var(--line)' }}>★</button>
        ))}
      </div>
      {!rated && stars > 0 && (
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2}
          placeholder={stars < 5 ? '¿Qué ocurrió? Cuéntanos para mejorar (requerido)' : 'Comparte tu experiencia (opcional)'}
          className="mt-2 w-full resize-none rounded-[10px] border border-line p-2.5 text-[12.5px] outline-none focus:border-magenta" />
      )}
      {rated
        ? <div className="mt-1 text-[11.5px] font-semibold text-ok">✓ Calificada{item.ratingComment ? ` · "${item.ratingComment}"` : ''}</div>
        : <button onClick={send} disabled={busy || stars === 0} className="mt-2 w-full rounded-[10px] bg-magenta py-2.5 text-[12.5px] font-bold text-white disabled:opacity-50">{busy ? 'Enviando…' : 'Enviar calificación'}</button>}
    </div>
  );
}

const CANCEL_REASONS = ['Por horario', 'Tráfico', 'Otro motivo'] as const;

function PortalCancelModal({ appointmentId, onClose, onDone }: { appointmentId: string; onClose: () => void; onDone: (msg: string) => void }) {
  const [choice, setChoice] = useState<string>('');
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const isOther = choice === 'Otro motivo';
  // El motivo final: la opción elegida, o el texto libre si es "Otro motivo".
  const reason = isOther ? other.trim() : choice;
  const canSubmit = !!choice && (!isOther || other.trim().length >= 3);

  async function submit() {
    if (!canSubmit) { onDone(isOther ? 'Escribe el motivo' : 'Elige un motivo'); return; }
    setBusy(true);
    try {
      const r = await api.post<{ message: string }>(`/portal/appointments/${appointmentId}/cancel`, { reason }, 'patient');
      onDone(r.message);
    } catch (e) { onDone(e instanceof Error ? e.message : 'Error'); }
    finally { setBusy(false); }
  }

  return (
    <div onClick={onClose} className="fixed inset-0 z-[120] flex items-center justify-center p-5" style={{ background: 'rgba(28,37,64,.55)' }}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-[340px] overflow-hidden rounded-[20px] bg-card" style={{ boxShadow: '0 24px 70px rgba(0,0,0,.4)' }}>
        <div className="border-b border-line px-5 py-4"><div className="text-[15px] font-extrabold">Cancelar cita</div><div className="text-[11.5px] text-muted">¿Cuál es el motivo?</div></div>
        <div className="flex flex-col gap-2 px-5 py-4">
          {CANCEL_REASONS.map((r) => {
            const on = choice === r;
            return (
              <button key={r} onClick={() => setChoice(r)} className="flex items-center gap-3 rounded-[11px] border px-4 py-3 text-left" style={{ borderColor: on ? 'var(--magenta)' : 'var(--line)', background: on ? 'var(--magenta-soft)' : 'var(--card)' }}>
                <span className="flex h-5 w-5 items-center justify-center rounded-full border-2" style={{ borderColor: on ? 'var(--magenta)' : 'var(--line)', background: on ? 'var(--magenta)' : 'transparent' }}>{on && <span className="h-2 w-2 rounded-full bg-white" />}</span>
                <span className="text-[13.5px] font-bold">{r}</span>
              </button>
            );
          })}
          {isOther && (
            <textarea autoFocus value={other} onChange={(e) => setOther(e.target.value)} rows={2}
              placeholder="Cuéntanos brevemente…"
              className="mt-1 w-full resize-none rounded-[10px] border border-line p-3 text-[13px] outline-none focus:border-magenta" />
          )}
          <div className="mt-0.5 text-[10.5px] text-faint">Recepción recibirá el aviso con tu motivo.</div>
        </div>
        <div className="flex gap-2 border-t border-line px-5 py-3.5">
          <button onClick={onClose} className="flex-1 rounded-[10px] border border-line py-2.5 text-[12.5px] font-bold text-muted">Volver</button>
          <button onClick={submit} disabled={busy || !canSubmit} className="flex-[2] rounded-[10px] py-2.5 text-[12.5px] font-bold text-white disabled:opacity-50" style={{ background: 'var(--danger)' }}>{busy ? 'Cancelando…' : 'Confirmar'}</button>
        </div>
      </div>
    </div>
  );
}

function Paquetes() {
  const toast = useToast();
  const [d, setD] = useState<PortalPackages | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; name: string; price: number } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get<PortalPackages>('/portal/packages', 'patient').then(setD).catch(() => {}); }, []);

  async function doBuy() {
    if (!confirm) return;
    setBusy(true);
    try {
      const r = await api.post<{ message: string }>('/portal/purchase', { catalogItemId: confirm.id }, 'patient');
      toast(r.message);
      setConfirm(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo enviar');
    } finally { setBusy(false); }
  }
  if (!d) return <div className="text-center text-sm text-muted">Cargando…</div>;

  return (
    <div className="flex animate-fade flex-col gap-4">
      {d.active && (
        <div className="rounded-[18px] p-5 text-white" style={{ background: 'linear-gradient(135deg,#1C2540,#3a2440)' }}>
          <div className="text-xs font-semibold opacity-85">Paquete activo</div>
          <div className="my-0.5 mb-3 text-[17px] font-extrabold">{d.active.name}</div>
          <div className="mb-2 h-2 overflow-hidden rounded-md" style={{ background: 'rgba(255,255,255,.18)' }}><div className="h-full rounded-md" style={{ width: `${d.active.pct}%`, background: '#E85CB6' }} /></div>
          <div className="text-[12.5px] opacity-90">{d.active.remaining} sesiones restantes{d.active.expiresAt ? ` · vence ${d.active.expiresAt}` : ''}</div>
        </div>
      )}
      <div>
        <div className="mx-0.5 mb-2.5 text-sm font-extrabold">Explora nuevos paquetes</div>
        <div className="flex flex-col gap-2.5">
          {d.shop.map((p) => (
            <div key={p.id} className="flex items-center gap-3.5 rounded-[16px] bg-card p-4 shadow-card">
              <div className="flex h-[50px] w-[50px] flex-none items-center justify-center rounded-[13px] bg-magenta-soft text-xl text-magenta">✦</div>
              <div className="min-w-0 flex-1"><div className="text-sm font-bold">{p.name}</div><div className="text-xs text-muted">{p.sessions} sesiones · {fmtRD(p.price)}</div></div>
              <button onClick={() => setConfirm({ id: p.id, name: p.name, price: p.price })} className="flex-none rounded-[9px] bg-magenta px-3.5 py-2.5 text-[12.5px] font-bold text-white">Comprar</button>
            </div>
          ))}
        </div>
      </div>

      {confirm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 px-6" onClick={() => !busy && setConfirm(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-[360px] overflow-hidden rounded-2xl bg-card">
            <div className="px-5 py-5">
              <div className="mb-1 text-[15px] font-extrabold">¿Confirmar solicitud de compra?</div>
              <div className="text-[13px] text-muted">Vas a solicitar <b className="text-text">{confirm.name}</b> · {fmtRD(confirm.price)}. Recepción te contactará para completar la compra. <b>No es un cobro automático.</b></div>
            </div>
            <div className="flex gap-2.5 border-t border-line px-5 py-4">
              <button onClick={() => setConfirm(null)} disabled={busy} className="flex-1 rounded-[10px] border border-line bg-card py-2.5 text-[13px] font-bold text-muted">Cancelar</button>
              <button onClick={doBuy} disabled={busy} className="flex-[2] rounded-[10px] bg-magenta py-2.5 text-[13px] font-bold text-white disabled:opacity-60">{busy ? 'Enviando…' : 'Sí, enviar solicitud'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
