import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { useBranch } from '../../layout/BranchContext';
import { useToast } from '../../components/Toast';
import { Portal } from '../../components/Modal';
import { fmtRD, type AgendaResponse, type Appointment, type CalendarStatus, type PatientPackage } from '../../lib/types';
import ScheduleModal from './ScheduleModal';
import FichaWizard from '../patients/FichaWizard';
import CalendarView from './CalendarView';

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function AgendaPage() {
  const { staff } = useAuth();
  const { activeBranch } = useBranch();
  const toast = useToast();
  const [data, setData] = useState<AgendaResponse>({ appointments: [], counters: { total: 0, confirmed: 0, pending: 0 } });
  const [cal, setCal] = useState<CalendarStatus>({ connected: false, mode: null, googleConfigured: false });
  const [schedOpen, setSchedOpen] = useState(false);
  const [ficha, setFicha] = useState<{ id: string; name: string } | null>(null);
  const [view, setView] = useState<'dia' | 'mes'>('dia');
  const [date, setDate] = useState(todayISO());
  const [remindFor, setRemindFor] = useState<Appointment | null>(null);
  const [finishFor, setFinishFor] = useState<Appointment | null>(null);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [checkinFor, setCheckinFor] = useState<Appointment | null>(null);
  const [cancelFor, setCancelFor] = useState<Appointment | null>(null);

  const branchQuery = staff?.role === 'ADMIN' && activeBranch !== 'all' ? `branch=${activeBranch}` : '';
  // Recepción, Admin y Esteticista pueden agendar (la esteticista para su propia agenda).
  const canSchedule = true;
  const isMasa = staff?.role === 'ESTETICISTA';
  const isAdmin = staff?.role === 'ADMIN';
  // Abrir/cerrar turno es exclusivo de la esteticista (y admin). Recepción cancela citas.
  const canOpenTurno = isMasa || isAdmin;
  const canCancel = staff?.role === 'RECEPCIONISTA' || isAdmin;
  const isToday = date === todayISO();
  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('es-DO', { weekday: 'long', day: '2-digit', month: 'long' });

  const load = useCallback(() => {
    const q = new URLSearchParams();
    q.set('date', date);
    if (branchQuery) q.set('branch', branchQuery.split('=')[1]);
    api.get<AgendaResponse>(`/appointments?${q.toString()}`).then(setData).catch(() => {});
    // El calendario se conecta por sucursal: la admin consulta la sucursal activa; el
    // personal de sucursal (sin ?branch) resuelve la suya en el servidor.
    const calQ = branchQuery ? `?${branchQuery}` : '';
    api.get<CalendarStatus>(`/calendar/status${calQ}`).then(setCal).catch(() => {});
  }, [branchQuery, date]);

  function shiftDate(days: number) {
    const d = new Date(date + 'T00:00:00'); d.setDate(d.getDate() + days); setDate(d.toISOString().slice(0, 10));
  }

  useEffect(() => { load(); }, [load]);

  // Volver del OAuth de Google con ?calendar=connected
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('calendar') === 'connected') {
      toast('Google Calendar conectado correctamente');
      window.history.replaceState({}, '', '/app/agenda');
      load();
    }
  }, [load, toast]);

  // Si la cita pertenece a un combo con áreas, se pregunta cuáles se trabajaron
  // (cada área consume una sesión). Si no, se cierra directo.
  async function finishService(a: Appointment) {
    if (a.treatmentId) { setFinishFor(a); return; }
    if (!window.confirm(`¿Cerrar el turno de ${a.patient}? Quedarás libre para el siguiente paciente y ${a.patient} podrá calificar el servicio.`)) return;
    try {
      const r = await api.post<{ message: string }>(`/appointments/${a.id}/finish`);
      toast(r.message);
      load();
    } catch (e) { toast(e instanceof Error ? e.message : 'Error'); }
  }

  async function connect() {
    // El calendario se conecta por sucursal. Debe haber una sucursal activa concreta.
    if (activeBranch === 'all') { toast('Elige una sucursal (E1/E2/E3) para conectar su calendario'); return; }
    try {
      const r = await api.post<{ redirect?: string; message?: string }>(`/config/calendar/${activeBranch}/connect`);
      if (r.redirect) { window.location.href = r.redirect; return; } // OAuth real de Google
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo conectar Google Calendar');
    }
  }

  return (
    <div className="animate-fade">
      {/* Toggle de vista + navegación de fecha */}
      <div className="mb-3.5 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-[10px] border border-line bg-bg p-1">
          {(['dia', 'mes'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className="rounded-[7px] px-3.5 py-1.5 text-[12.5px] font-bold transition"
              style={{ background: view === v ? 'var(--magenta)' : 'transparent', color: view === v ? '#fff' : 'var(--muted)' }}>
              {v === 'dia' ? 'Día' : 'Calendario'}
            </button>
          ))}
        </div>
        {view === 'dia' && (
          <div className="flex items-center gap-2">
            <button onClick={() => shiftDate(-1)} className="h-8 w-8 rounded-lg border border-line bg-card font-bold text-muted hover:border-magenta">‹</button>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-[12.5px] font-semibold" />
            <button onClick={() => shiftDate(1)} className="h-8 w-8 rounded-lg border border-line bg-card font-bold text-muted hover:border-magenta">›</button>
            {!isToday && <button onClick={() => setDate(todayISO())} className="rounded-lg border border-line bg-card px-3 py-1.5 text-[12px] font-bold text-muted hover:border-magenta">Hoy</button>}
            <span className="text-[12.5px] font-semibold capitalize text-muted">{dateLabel}</span>
          </div>
        )}
        <div className="flex-1" />
        {(staff?.role === 'ESTETICISTA' || staff?.role === 'ADMIN') && (
          <button onClick={() => setCheckinOpen(true)} className="flex items-center gap-1.5 rounded-xl border border-line bg-card px-[18px] py-2 text-[13.5px] font-bold text-navy hover:border-magenta">
            🔓 Abrir turno
          </button>
        )}
        {canSchedule && (
          <button onClick={() => setSchedOpen(true)} className="flex items-center gap-1.5 rounded-xl bg-magenta px-[18px] py-2 text-[13.5px] font-bold text-white">
            <span className="text-[17px]">+</span> Agendar cita
          </button>
        )}
      </div>

      {view === 'mes' ? (
        <CalendarView branchQuery={branchQuery} onPickDay={(d) => { setDate(d); setView('dia'); }} />
      ) : (
      <>
      {cal.connected && (
        <div className="mb-3.5 flex items-center gap-3 rounded-xl border px-4 py-3" style={{ background: 'var(--ok-soft)', borderColor: '#CDEBDD' }}>
          <span className="flex h-[26px] w-[26px] items-center justify-center rounded-md bg-white text-[13px] font-extrabold" style={{ color: '#1F9D6B' }}>G</span>
          <div className="flex-1 text-[13px] font-bold" style={{ color: '#1F7A54' }}>
            Google Calendar conectado · las citas se sincronizan automáticamente
          </div>
          <span className="text-[11.5px] font-bold text-ok">● Activo</span>
        </div>
      )}

      <div className="mb-[18px] flex gap-3.5">
        <Counter label={isToday ? 'Citas de hoy' : 'Citas del día'} value={data.counters.total} />
        <Counter label="Confirmadas" value={data.counters.confirmed} color="var(--ok)" />
        <Counter label="Sin confirmar" value={data.counters.pending} color="var(--warn)" />
        {!cal.connected && cal.canManage && (
          <button onClick={connect} className="flex items-center gap-2 rounded-xl border border-line bg-card px-[18px] text-[13px] font-bold text-navy hover:border-magenta">
            <span className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-navy-soft text-[11px] font-extrabold" style={{ color: '#4285F4' }}>G</span>
            Conectar Calendar
          </button>
        )}
      </div>

      <div className="rounded-base border border-line bg-card p-2 shadow-card">
        {data.appointments.length === 0 && <div className="py-10 text-center text-sm text-muted">No hay citas para este día. Aprovecha para gestionar pacientes.</div>}
        {data.appointments.map((a) => (
          <div key={a.id} className="flex flex-col gap-2.5 rounded-[11px] px-3.5 py-3.5 hover:bg-bg sm:flex-row sm:items-center sm:gap-4">
            <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center sm:gap-4">
            <div className="w-[52px] flex-none pt-0.5 text-right sm:w-[74px] sm:pt-0"><div className="text-sm font-extrabold">{a.time}</div></div>
            <div className="w-[3px] self-stretch flex-none rounded" style={{ background: a.barColor }} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5">
                <span className="text-sm font-bold">{a.patient}</span>
                {a.patientType === 'NUEVO'
                  ? <span className="rounded-full bg-magenta-soft px-2 py-0.5 text-[10px] font-bold text-magenta">Cliente nuevo</span>
                  : <span className="rounded-full bg-navy-soft px-2 py-0.5 text-[10px] font-bold text-muted">Recurrente</span>}
                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: a.statusColor + '1a', color: a.statusColor }}>{a.statusLabel}</span>
                {a.inService && <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'var(--ok-soft)', color: 'var(--ok)' }}>🔓 Turno abierto</span>}
                {a.finished && <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'var(--navy-soft)', color: 'var(--navy)' }}>✓ Atendido</span>}
              </div>
              <div className="mt-0.5 text-[12.5px] text-muted">{a.service} · {a.therapist} · {a.branchName}</div>
              {a.status === 'CANCELADA' && a.cancelReason && (
                <div className="mt-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
                  ✕ Cancelada {a.cancelledBy === 'PATIENT' ? 'por el paciente' : 'por recepción'} · {a.cancelReason}
                </div>
              )}
              {a.balance > 0 && (
                <div className="mt-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
                  ⚠ Saldo {fmtRD(a.balance)} · cobrar antes de atender
                </div>
              )}
            </div>
            </div>
            <div className="flex flex-wrap gap-2 sm:flex-none sm:justify-end">
            {canOpenTurno && !a.checkedIn && a.status !== 'CANCELADA' && (
              <button onClick={() => setCheckinFor(a)}
                className="rounded-[9px] border px-3.5 py-2.5 text-[12.5px] font-bold"
                style={{ borderColor: 'var(--ok)', color: 'var(--ok)', background: 'var(--ok-soft)' }}>
                🔓 Abrir turno
              </button>
            )}
            {canOpenTurno && a.inService && (
              <button onClick={() => finishService(a)}
                className="rounded-[9px] px-3.5 py-2.5 text-[12.5px] font-bold text-white" style={{ background: 'var(--navy)' }}>
                ✓ Cerrar turno
              </button>
            )}
            {canCancel && a.status !== 'CANCELADA' && a.status !== 'COMPLETADA' && !a.finished && !a.inService && (
              <button onClick={() => setCancelFor(a)}
                className="rounded-[9px] border px-3.5 py-2.5 text-[12.5px] font-bold"
                style={{ borderColor: 'var(--danger)', color: 'var(--danger)', background: 'var(--danger-soft)' }}>
                ✕ Cancelar cita
              </button>
            )}
            {a.finished && a.durationLabel && (
              <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: 'var(--navy-soft)', color: 'var(--navy)' }} title="Tiempo de atención (solo visible para administración)">⏱ {a.durationLabel}</span>
            )}
            {isMasa && a.status !== 'CANCELADA' && (
              <button onClick={() => setFicha({ id: a.patientId, name: a.patient })}
                className="rounded-[9px] px-3.5 py-2.5 text-[12.5px] font-bold"
                style={a.fichaComplete ? { background: 'var(--magenta)', color: '#fff' } : { background: 'var(--magenta-soft)', color: 'var(--magenta)' }}>
                {a.fichaComplete ? 'Abrir ficha' : 'Llenar ficha'}
              </button>
            )}
            {a.status !== 'CANCELADA' && (
              <button onClick={() => setRemindFor(a)} className="rounded-[9px] border border-line bg-card px-3.5 py-2.5 text-[12.5px] font-bold text-muted hover:border-magenta hover:text-magenta">
                {a.reminderSent ? 'Recordado ✓' : 'Recordar'}
              </button>
            )}
            </div>
          </div>
        ))}
      </div>
      </>
      )}

      {schedOpen && <ScheduleModal branchQuery={branchQuery ? '&' + branchQuery : ''} onClose={() => setSchedOpen(false)} onSaved={load} />}
      {ficha && <FichaWizard patientId={ficha.id} patientName={ficha.name} onClose={() => setFicha(null)} onSaved={load} />}
      {remindFor && <RemindModal appt={remindFor} onClose={() => setRemindFor(null)} onSent={load} />}
      {finishFor && <FinishModal appt={finishFor} onClose={() => setFinishFor(null)} onDone={load} />}
      {(checkinOpen || checkinFor) && <CheckinModal appt={checkinFor} onClose={() => { setCheckinOpen(false); setCheckinFor(null); }} onDone={load} />}
      {cancelFor && <CancelModal appt={cancelFor} onClose={() => setCancelFor(null)} onDone={load} />}
    </div>
  );
}

function CancelModal({ appt, onClose, onDone }: { appt: Appointment; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (reason.trim().length < 3) { toast('Escribe el motivo de la cancelación'); return; }
    setBusy(true);
    try {
      const r = await api.post<{ message: string }>(`/appointments/${appt.id}/cancel`, { reason: reason.trim() });
      toast(r.message);
      onDone();
      onClose();
    } catch (e) { toast(e instanceof Error ? e.message : 'Error'); }
    finally { setBusy(false); }
  }

  return (
    <Portal>
    <div onClick={onClose} className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto p-4 sm:p-7" style={{ background: 'rgba(28,37,64,.5)' }}>
      <div onClick={(e) => e.stopPropagation()} className="my-auto w-[440px] max-w-full overflow-hidden rounded-2xl bg-card animate-pop" style={{ boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
        <div className="flex items-center border-b border-line px-6 py-5"><div className="flex-1"><div className="text-base font-extrabold">Cancelar cita</div><div className="text-[12.5px] text-muted">{appt.patient} · {appt.service} · {appt.time}</div></div><button onClick={onClose} className="h-8 w-8 rounded-lg bg-bg text-muted">×</button></div>
        <div className="flex flex-col gap-3 px-6 py-5">
          <div className="text-xs font-bold text-muted">Motivo de la cancelación (obligatorio)</div>
          <textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
            placeholder="Ej: el cliente llamó/escribió por WhatsApp para cancelar, no puede asistir…"
            className="rounded-[10px] border border-line px-4 py-3 text-[13.5px] outline-none focus:border-magenta" />
          <div className="text-[11.5px] text-faint">Se enviará un correo al paciente con el motivo y quedará el aviso en su portal.</div>
        </div>
        <div className="flex gap-2.5 border-t border-line px-6 py-4">
          <button onClick={onClose} className="flex-1 rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">Volver</button>
          <button onClick={submit} disabled={busy} className="flex-[2] rounded-[10px] py-3 text-[13.5px] font-bold text-white disabled:opacity-60" style={{ background: 'var(--danger)' }}>{busy ? 'Cancelando…' : 'Confirmar cancelación'}</button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

function CheckinModal({ appt, onClose, onDone }: { appt?: Appointment | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function validate() {
    if (code.trim().length < 4) { toast('Ingresa el código del turno'); return; }
    setBusy(true); setResult(null);
    try {
      const r = await api.post<{ message: string }>('/appointments/checkin', { code: code.trim() });
      setResult({ ok: true, text: r.message });
      toast(r.message);
      onDone();
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : 'Error' });
    } finally { setBusy(false); }
  }

  return (
    <Portal>
    <div onClick={onClose} className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto p-4 sm:p-7" style={{ background: 'rgba(28,37,64,.5)' }}>
      <div onClick={(e) => e.stopPropagation()} className="my-auto w-[420px] max-w-full overflow-hidden rounded-2xl bg-card animate-pop" style={{ boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
        <div className="flex items-center border-b border-line px-6 py-5"><div className="flex-1"><div className="text-base font-extrabold">Abrir turno en cabina</div><div className="text-[12.5px] text-muted">{appt ? `${appt.patient} · ${appt.time} · valida su código` : 'Valida el código del paciente antes de atender'}</div></div><button onClick={onClose} className="h-8 w-8 rounded-lg bg-bg text-muted">×</button></div>
        <div className="flex flex-col gap-3 px-6 py-5">
          <input autoFocus value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && validate()}
            placeholder="Código del turno (ej. K7X2QP)" className="rounded-[10px] border border-line px-4 py-3 text-center text-[18px] font-extrabold tracking-[.3em] outline-none focus:border-magenta" />
          {result && (
            <div className="rounded-[10px] px-4 py-3 text-[13px] font-bold" style={result.ok ? { background: 'var(--ok-soft)', color: 'var(--ok)' } : { background: 'var(--danger-soft)', color: 'var(--danger)' }}>
              {result.ok ? '✓ ' : '⚠ '}{result.text}
            </div>
          )}
          <div className="text-[11.5px] text-faint">El código es único por cita y no se puede reutilizar. Así se evita que otra persona use el turno.</div>
        </div>
        <div className="flex gap-2.5 border-t border-line px-6 py-4">
          <button onClick={onClose} className="flex-1 rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">Cerrar</button>
          <button onClick={validate} disabled={busy} className="flex-[2] rounded-[10px] bg-magenta py-3 text-[13.5px] font-bold text-white disabled:opacity-60">{busy ? 'Validando…' : 'Validar y abrir'}</button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

/**
 * Cierre de turno de una cita que pertenece a un combo: la esteticista marca qué
 * áreas trabajó. Cada área marcada consume una sesión del combo.
 */
function FinishModal({ appt, onClose, onDone }: { appt: Appointment; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [pkg, setPkg] = useState<PatientPackage | null>(null);
  const [cargando, setCargando] = useState(true);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [tec, setTec] = useState<Set<string>>(new Set()); // técnicas aplicadas hoy
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<{ packages?: PatientPackage[] }>(`/patients/${appt.patientId}`)
      .then((d) => {
        const p = (d.packages ?? []).find((x) => x.id === appt.treatmentId) ?? null;
        setPkg(p);
        // Por defecto se marcan las áreas que aún tienen sesiones disponibles.
        setSel(new Set((p?.areas ?? []).filter((a) => a.remaining > 0).map((a) => a.area)));
      })
      .catch(() => setPkg(null))
      .finally(() => setCargando(false));
  }, [appt.patientId, appt.treatmentId]);

  const areas = pkg?.areas ?? [];
  const tecnicas = pkg?.services ?? [];
  const toggle = (k: string) => { const n = new Set(sel); n.has(k) ? n.delete(k) : n.add(k); setSel(n); };
  const toggleTec = (k: string) => { const n = new Set(tec); n.has(k) ? n.delete(k) : n.add(k); setTec(n); };

  async function cerrar() {
    setBusy(true);
    try {
      const r = await api.post<{ message: string }>(`/appointments/${appt.id}/finish`, { areas: [...sel], techniques: [...tec] });
      toast(r.message);
      onDone();
      onClose();
    } catch (e) { toast(e instanceof Error ? e.message : 'Error'); }
    finally { setBusy(false); }
  }

  return (
    <Portal>
      <div onClick={onClose} className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto p-4 sm:p-7" style={{ background: 'rgba(28,37,64,.5)' }}>
        <div onClick={(e) => e.stopPropagation()} className="my-auto w-[420px] max-w-full overflow-hidden rounded-2xl bg-card animate-pop" style={{ boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
          <div className="flex items-center border-b border-line px-6 py-5">
            <div className="flex-1">
              <div className="text-base font-extrabold">Cerrar turno</div>
              <div className="text-[12.5px] text-muted">{appt.patient} · {appt.time}</div>
            </div>
            <button onClick={onClose} className="h-8 w-8 rounded-lg bg-bg text-muted">×</button>
          </div>

          <div className="flex flex-col gap-3 px-6 py-5">
            {cargando && <div className="py-4 text-center text-[13px] text-muted">Cargando el paquete…</div>}
            {!cargando && areas.length === 0 && (
              <div className="rounded-[10px] bg-bg px-3.5 py-3 text-[12.5px] text-muted">
                Este paquete no tiene áreas definidas. Se descontará <b>una sesión</b> al cerrar.
              </div>
            )}
            {!cargando && areas.length > 0 && (
              <>
                <div className="text-xs font-bold text-muted">¿Qué áreas trabajaste? Cada una descuenta una sesión.</div>
                {areas.map((a) => {
                  const on = sel.has(a.area);
                  const agotada = a.remaining === 0;
                  return (
                    <button key={a.id} onClick={() => !agotada && toggle(a.area)} disabled={agotada}
                      className="flex items-center gap-3 rounded-[11px] border px-4 py-3 text-left disabled:opacity-45"
                      style={{ borderColor: on ? 'var(--magenta)' : 'var(--line)', background: on ? 'var(--magenta-soft)' : 'var(--card)' }}>
                      <span className="flex-1">
                        <span className="text-[13.5px] font-bold">{a.label}</span>
                        {a.isExtra && <span className="ml-1.5 rounded-full bg-warn-soft px-1.5 py-0.5 text-[10px] font-bold text-warn">adicional</span>}
                        <span className="block text-[11.5px] text-muted">{agotada ? 'Sin sesiones disponibles' : `Quedan ${a.remaining} de ${a.total}`}</span>
                      </span>
                      <span className="flex h-5 w-5 items-center justify-center rounded-md text-[11px] font-extrabold text-white" style={{ background: on ? 'var(--magenta)' : 'var(--line)' }}>✓</span>
                    </button>
                  );
                })}
                <div className="rounded-[10px] bg-bg px-3 py-2 text-[11.5px] text-muted">
                  Se descontarán <b>{sel.size || 1}</b> sesión{(sel.size || 1) === 1 ? '' : 'es'} de <b>{pkg?.name}</b>.
                </div>
              </>
            )}

            {/* Checklist de lo aplicado hoy: queda en el historial de la sesión. */}
            {!cargando && tecnicas.length > 0 && (
              <div className="mt-1 border-t border-line-2 pt-3">
                <div className="mb-2 text-xs font-bold text-muted">¿Qué le aplicaste hoy?</div>
                <div className="flex flex-wrap gap-1.5">
                  {tecnicas.map((t) => {
                    const on = tec.has(t.name);
                    const agotada = t.remaining != null && t.remaining <= 0;
                    const progreso = t.total != null ? ` ${t.done ?? 0}/${t.total}` : (t.qty ? ` (${t.qty})` : '');
                    return (
                      <button key={t.id} onClick={() => !agotada && toggleTec(t.name)} disabled={agotada} title={agotada ? 'Sin sesiones disponibles de esta técnica' : ''}
                        className="rounded-full border px-3 py-1.5 text-[12px] font-bold disabled:opacity-45"
                        style={{ borderColor: on ? 'var(--magenta)' : 'var(--line)', background: on ? 'var(--magenta-soft)' : 'var(--card)', color: on ? 'var(--magenta)' : 'var(--muted)' }}>
                        {on ? '✓ ' : ''}{t.name}{progreso}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2.5 border-t border-line px-6 py-4">
            <button onClick={onClose} className="flex-1 rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">Cancelar</button>
            <button onClick={cerrar} disabled={busy || cargando} className="flex-[2] rounded-[10px] py-3 text-[13.5px] font-bold text-white disabled:opacity-60" style={{ background: 'var(--navy)' }}>
              {busy ? 'Cerrando…' : '✓ Cerrar turno'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

const REMIND_CHANNELS = [
  { key: 'whatsapp', label: 'WhatsApp', color: '#25D366' },
  { key: 'correo', label: 'Correo', color: '#2C7FB8' },
  { key: 'portal', label: 'Portal del paciente', color: '#B31C86' },
] as const;

function RemindModal({ appt, onClose, onSent }: { appt: Appointment; onClose: () => void; onSent: () => void }) {
  const toast = useToast();
  const [sel, setSel] = useState<Set<string>>(new Set(['whatsapp']));
  const [busy, setBusy] = useState(false);
  const toggle = (k: string) => { const n = new Set(sel); n.has(k) ? n.delete(k) : n.add(k); setSel(n); };
  const all = sel.size === REMIND_CHANNELS.length;

  async function send() {
    if (!sel.size) { toast('Selecciona al menos un canal'); return; }
    setBusy(true);
    try {
      const r = await api.post<{ message: string; results: Record<string, string>; whatsappUrl: string | null }>(`/appointments/${appt.id}/remind`, { channels: [...sel] });
      // Si se eligió WhatsApp, abrir el chat con el mensaje ya escrito para enviarlo.
      if (sel.has('whatsapp') && r.whatsappUrl) window.open(r.whatsappUrl, '_blank', 'noopener');
      toast(r.message);
      onSent();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Portal>
    <div onClick={onClose} className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto p-4 sm:p-7" style={{ background: 'rgba(28,37,64,.5)' }}>
      <div onClick={(e) => e.stopPropagation()} className="my-auto w-[420px] max-w-full overflow-hidden rounded-2xl bg-card animate-pop" style={{ boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
        <div className="flex items-center border-b border-line px-6 py-5"><div className="flex-1"><div className="text-base font-extrabold">Recordar cita</div><div className="text-[12.5px] text-muted">{appt.patient} · {appt.time}</div></div><button onClick={onClose} className="h-8 w-8 rounded-lg bg-bg text-muted">×</button></div>
        <div className="flex flex-col gap-3 px-6 py-5">
          <div className="text-xs font-bold text-muted">¿Por qué vía quieres recordar?</div>
          {REMIND_CHANNELS.map((c) => {
            const on = sel.has(c.key);
            return (
              <button key={c.key} onClick={() => toggle(c.key)} className="flex items-center gap-3 rounded-[11px] border px-4 py-3 text-left" style={{ borderColor: on ? 'var(--magenta)' : 'var(--line)', background: on ? 'var(--magenta-soft)' : 'var(--card)' }}>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg text-[11px] font-extrabold text-white" style={{ background: c.color }}>{c.label.slice(0, 2).toUpperCase()}</span>
                <span className="flex-1 text-[13.5px] font-bold">{c.label}</span>
                <span className="flex h-5 w-5 items-center justify-center rounded-md text-[11px] font-extrabold text-white" style={{ background: on ? 'var(--magenta)' : 'var(--line)' }}>✓</span>
              </button>
            );
          })}
          <button onClick={() => setSel(all ? new Set() : new Set(REMIND_CHANNELS.map((c) => c.key)))} className="text-[12.5px] font-bold text-magenta">{all ? 'Quitar todas' : 'Enviar por todas (notificación masiva)'}</button>
        </div>
        <div className="flex gap-2.5 border-t border-line px-6 py-4">
          <button onClick={onClose} className="flex-1 rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">Cancelar</button>
          <button onClick={send} disabled={busy} className="flex-[2] rounded-[10px] bg-magenta py-3 text-[13.5px] font-bold text-white disabled:opacity-60">Enviar recordatorio</button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

function Counter({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex-1 rounded-xl border border-line bg-card px-[18px] py-3.5 shadow-card">
      <div className="text-xs font-semibold text-muted">{label}</div>
      <div className="text-[22px] font-extrabold" style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}
