import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Icon } from '../components/icons';
import { fmtRD, type PortalAppointment, type PortalPackages, type PortalProceso } from '../lib/types';

type Tab = 'proceso' | 'citas' | 'paquetes';

export default function PatientPortal() {
  const { patient, logout } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('proceso');

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
        </div>

        <div className="flex border-t border-line bg-card px-3 pb-2.5 pt-1.5">
          {([
            { key: 'proceso', label: 'Mi Proceso', icon: 'star' },
            { key: 'citas', label: 'Citas', icon: 'cal' },
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
  const [service, setService] = useState('Reducción de medidas');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState('10:00');

  const load = useCallback(() => { api.get<PortalAppointment[]>('/portal/appointments', 'patient').then(setAppts).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  async function book() {
    const r = await api.post<{ message: string }>('/portal/appointments', { serviceName: service, date, time }, 'patient');
    toast(r.message); load();
  }
  async function cancel(id: string) {
    const r = await api.del<{ message: string }>(`/portal/appointments/${id}`, 'patient');
    toast(r.message); load();
  }
  async function reschedule(id: string) {
    const r = await api.patch<{ message: string }>(`/portal/appointments/${id}`, { date, time }, 'patient');
    toast(r.message); load();
  }

  return (
    <div className="flex animate-fade flex-col gap-4">
      <div className="rounded-[18px] bg-card p-5 shadow-card">
        <div className="mb-3.5 text-[15px] font-extrabold">Agendar nueva cita</div>
        <div className="flex flex-col gap-2.5">
          <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Servicio</span>
            <select value={service} onChange={(e) => setService(e.target.value)} className="rounded-[10px] border border-line bg-card p-3 text-[13.5px]">
              <option>Reducción de medidas</option><option>Radiofrecuencia corporal</option><option>Masaje reductor</option><option>Limpieza facial profunda</option>
            </select>
          </label>
          <div className="flex gap-2.5">
            <label className="flex flex-1 flex-col gap-1.5"><span className="text-xs font-bold text-muted">Fecha</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-[10px] border border-line bg-card p-3 text-[13.5px]" /></label>
            <label className="flex flex-1 flex-col gap-1.5"><span className="text-xs font-bold text-muted">Hora</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="rounded-[10px] border border-line bg-card p-3 text-[13.5px]" /></label>
          </div>
          <button onClick={book} className="mt-1 rounded-[11px] bg-magenta p-3.5 text-sm font-bold text-white">Solicitar cita</button>
        </div>
      </div>

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
                <button onClick={() => reschedule(a.id)} className="flex-1 rounded-[9px] py-2.5 text-[12.5px] font-bold" style={{ background: 'var(--navy-soft)', color: 'var(--navy)' }}>Reagendar</button>
                <button onClick={() => cancel(a.id)} className="flex-1 rounded-[9px] py-2.5 text-[12.5px] font-bold" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>Cancelar</button>
              </div>
            </div>
          ))}
          {appts.length === 0 && <div className="rounded-[16px] bg-card p-4 text-center text-sm text-muted shadow-card">No tienes citas próximas.</div>}
        </div>
        <div className="mt-3 px-1 text-[11.5px] leading-normal text-faint">⚠ Recuerda cancelar con 24h de anticipación. Después de 5 cancelaciones se pierde el tratamiento.</div>
      </div>
    </div>
  );
}

function Paquetes() {
  const toast = useToast();
  const [d, setD] = useState<PortalPackages | null>(null);
  useEffect(() => { api.get<PortalPackages>('/portal/packages', 'patient').then(setD).catch(() => {}); }, []);

  async function buy(id: string) {
    const r = await api.post<{ message: string }>('/portal/purchase', { catalogItemId: id }, 'patient');
    toast(r.message);
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
              <button onClick={() => buy(p.id)} className="flex-none rounded-[9px] bg-magenta px-3.5 py-2.5 text-[12.5px] font-bold text-white">Comprar</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
