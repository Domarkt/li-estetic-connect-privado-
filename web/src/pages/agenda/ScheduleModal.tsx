import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { useBranch } from '../../layout/BranchContext';
import { useToast } from '../../components/Toast';
import { Overlay, stop } from '../../components/Modal';
import { fmtRD, type CatalogItem, type PatientRow, type PatientType, type Therapist } from '../../lib/types';

interface Props { branchQuery: string; onClose: () => void; onSaved: () => void }

const todayStr = () => new Date().toISOString().slice(0, 10);
const FOLLOWUP = '__followup__';
// Mismas etiquetas que en el cobro, para que el equipo vea siempre el mismo formato.
const KIND_TAG: Record<string, string> = { SERVICIO: 'Servicio', PAQUETE: 'Paquete', COMBO: 'Combo' };

export default function ScheduleModal({ branchQuery, onClose, onSaved }: Props) {
  const { staff } = useAuth();
  const { branches } = useBranch();
  const toast = useToast();
  const [type, setType] = useState<PatientType>('NUEVO');
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [patientId, setPatientId] = useState('');
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newSex, setNewSex] = useState<'M' | 'F' | ''>('');
  const [newEmail, setNewEmail] = useState('');
  const [newBirth, setNewBirth] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [branchId, setBranchId] = useState(staff?.role === 'ADMIN' ? (branches[0]?.id ?? '') : (staff?.branchId ?? ''));
  const [services, setServices] = useState<CatalogItem[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [svcQuery, setSvcQuery] = useState(''); // buscador de servicios (formato del cobro)
  const [therapists, setTherapists] = useState<Therapist[]>([]);
  const [therapistId, setTherapistId] = useState('');
  const [date, setDate] = useState(todayStr());
  const [time, setTime] = useState('10:00');
  const [busy, setBusy] = useState(false);
  const [loadingP, setLoadingP] = useState(true);
  const [errP, setErrP] = useState(false);
  const [pQuery, setPQuery] = useState('');
  const [treatmentId, setTreatmentId] = useState(''); // paquete cuya sesión consume la cita
  const [durationMin, setDurationMin] = useState(60); // un proceso puede pasar de una hora
  // Tras agendar: pantalla de confirmación con el botón de WhatsApp precargado.
  const [done, setDone] = useState<{ whatsappUrl: string | null; patientName: string; emailSent: boolean } | null>(null);

  function loadPatients() {
    setLoadingP(true); setErrP(false);
    api.get<PatientRow[]>(`/patients?q=${branchQuery}`)
      .then((p) => { setPatients(p); setLoadingP(false); if (p[0]) setPatientId(p[0].id); })
      .catch(() => { setLoadingP(false); setErrP(true); });
  }

  useEffect(() => {
    loadPatients();
    // No se preselecciona ninguno: con el buscador, elegir es explícito (antes quedaba
    // agendado el primer servicio de la lista sin que nadie lo mirara).
    api.get<CatalogItem[]>('/catalog').then((c) => setServices(c.filter((i) => i.kind === 'SERVICIO' || i.kind === 'PAQUETE' || i.kind === 'COMBO')));
    api.get<Therapist[]>(`/users/therapists${branchQuery ? '?' + branchQuery.slice(1) : ''}`).then((t) => { setTherapists(t); if (t[0] && staff?.role !== 'ESTETICISTA') setTherapistId(t[0].id); });
    if (staff?.role === 'ESTETICISTA') setTherapistId(staff.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchQuery]);

  const isNew = type === 'NUEVO';
  const svcElegido = services.find((s) => s.id === serviceId) ?? null;
  const serviciosFiltrados = services.filter((s) => {
    const q = svcQuery.trim().toLowerCase();
    return !q || s.name.toLowerCase().includes(q) || (s.code ?? '').toLowerCase().includes(q);
  });

  async function save() {
    setBusy(true);
    try {
      const followUp = !isNew && serviceId === FOLLOWUP;
      const svc = services.find((s) => s.id === serviceId);
      const payload: Record<string, unknown> = {
        patientType: type, date, time,
        therapistId: therapistId || undefined,
        isFollowUp: followUp,
        serviceName: followUp ? 'Seguimiento de tratamiento' : (svc?.name ?? 'Valoración inicial'),
        catalogItemId: followUp ? null : (svc?.id ?? null),
        treatmentId: treatmentId || null,
        durationMin,
      };
      if (isNew) {
        if (!newName.trim() || !newPhone.trim()) { toast('Nombre y celular del paciente nuevo requeridos'); setBusy(false); return; }
        if (!newSex) { toast('Selecciona el sexo del paciente'); setBusy(false); return; }
        payload.newPatient = {
          name: newName.trim(), phone: newPhone.trim(), sex: newSex,
          email: newEmail.trim() || undefined,
          birthDate: newBirth || undefined,
          address: newAddress.trim() || undefined,
        };
        if (staff?.role === 'ADMIN') payload.branchId = branchId;
      } else {
        if (!patientId) { toast('Selecciona un paciente'); setBusy(false); return; }
        payload.patientId = patientId;
      }
      const r = await api.post<{ message: string; whatsappUrl: string | null; patientName: string; emailSent: boolean }>('/appointments', payload);
      toast(r.message);
      onSaved(); // refresca la agenda por detrás
      // No cerramos: mostramos la confirmación con el botón de WhatsApp al paciente.
      setDone({ whatsappUrl: r.whatsappUrl, patientName: r.patientName, emailSent: r.emailSent });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al agendar');
    } finally {
      setBusy(false);
    }
  }

  // Pantalla de confirmación: la cita ya se creó; ofrece enviar el WhatsApp al paciente.
  if (done) {
    return (
      <Overlay onClose={onClose} z={110}>
        <div onClick={stop} className="w-[420px] max-w-full overflow-hidden rounded-2xl bg-card animate-pop" style={{ boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
          <div className="flex flex-col items-center gap-2 px-4 sm:px-6 pt-7 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full text-[26px]" style={{ background: 'var(--ok-soft)' }}>✓</div>
            <div className="text-base font-extrabold">Cita agendada</div>
            <div className="text-[13px] text-muted">{done.patientName}{done.emailSent ? ' · confirmación enviada por correo' : ''}</div>
          </div>
          <div className="flex flex-col gap-2.5 px-4 sm:px-6 py-6">
            {done.whatsappUrl ? (
              <>
                <a href={done.whatsappUrl} target="_blank" rel="noopener noreferrer" onClick={() => { onClose(); }}
                  className="flex items-center justify-center gap-2 rounded-[11px] py-3.5 text-[14px] font-bold text-white" style={{ background: '#25D366' }}>
                  <span className="text-[17px]">💬</span> Enviar confirmación por WhatsApp
                </a>
                <div className="text-center text-[11.5px] text-faint">Se abre WhatsApp con el mensaje ya escrito; solo toca <b>Enviar</b>.</div>
              </>
            ) : (
              <div className="rounded-[10px] bg-bg px-3.5 py-3 text-center text-[12.5px] text-muted">Este paciente no tiene celular registrado, no se puede enviar por WhatsApp.</div>
            )}
            <button onClick={onClose} className="rounded-[11px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">Cerrar</button>
          </div>
        </div>
      </Overlay>
    );
  }

  return (
    <Overlay onClose={onClose} z={110}>
      <div onClick={stop} className="w-[460px] max-w-full overflow-hidden rounded-2xl bg-card animate-pop" style={{ boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
        <div className="flex items-center border-b border-line px-4 sm:px-6 py-5"><div className="flex-1 text-base font-extrabold">Agendar cita</div><button onClick={onClose} className="h-8 w-8 rounded-lg bg-bg text-muted">×</button></div>
        <div className="flex flex-col gap-3.5 px-4 sm:px-6 py-5">
          <div>
            <span className="mb-1.5 block text-xs font-bold text-muted">Tipo de cliente</span>
            <div className="flex gap-2">
              {(['NUEVO', 'RECURRENTE'] as const).map((t) => {
                const on = type === t;
                return (
                  <button key={t} onClick={() => setType(t)} className="flex-1 rounded-[9px] border py-2.5 text-[13px] font-bold"
                    style={{ borderColor: on ? 'var(--magenta)' : 'var(--line)', background: on ? 'var(--magenta-soft)' : 'var(--card)', color: on ? 'var(--magenta)' : 'var(--muted)' }}>
                    {t === 'NUEVO' ? 'Cliente nuevo' : 'Recurrente'}
                  </button>
                );
              })}
            </div>
          </div>

          {isNew ? (
            <>
              <div className="rounded-[10px] border px-3.5 py-2.5 text-xs font-semibold" style={{ background: 'var(--magenta-soft)', borderColor: '#F0CDE4', color: 'var(--magenta-d)' }}>
                ✎ Paso 1 de la ficha. Con el correo, el paciente recibirá la confirmación con su código y el acceso al portal para completar la ficha; la esteticista queda notificada.
              </div>
              <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Nombre del nuevo paciente</span><input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nombre y apellidos" className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" /></label>
              <div className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Sexo</span>
                <div className="flex gap-2">
                  {([['F', 'Femenino'], ['M', 'Masculino']] as const).map(([v, lbl]) => (
                    <button key={v} type="button" onClick={() => setNewSex(v)} className="flex-1 rounded-[9px] border py-2.5 text-[13px] font-bold"
                      style={{ borderColor: newSex === v ? 'var(--magenta)' : 'var(--line)', background: newSex === v ? 'var(--magenta-soft)' : 'var(--card)', color: newSex === v ? 'var(--magenta)' : 'var(--muted)' }}>
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-3">
                <label className="flex flex-1 flex-col gap-1.5"><span className="text-xs font-bold text-muted">Celular</span><input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="809-000-0000" className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" /></label>
                <label className="flex flex-1 flex-col gap-1.5"><span className="text-xs font-bold text-muted">Fecha de nacimiento</span><input type="date" value={newBirth} onChange={(e) => setNewBirth(e.target.value)} className="rounded-[9px] border border-line bg-card px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" /></label>
              </div>
              <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Correo electrónico <span className="font-semibold text-faint">(para enviarle acceso + código)</span></span><input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="paciente@correo.com" className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" /></label>
              <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Dirección</span><input value={newAddress} onChange={(e) => setNewAddress(e.target.value)} placeholder="Calle, sector, ciudad" className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" /></label>
              {staff?.role === 'ADMIN' && (
                <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Sucursal</span>
                  <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="rounded-[9px] border border-line bg-card px-3.5 py-3 text-[13.5px]">
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </label>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-muted">Paciente recurrente</span>
              <input value={pQuery} onChange={(e) => setPQuery(e.target.value)} placeholder="🔍 Buscar por nombre o teléfono…"
                className="rounded-[9px] border border-line px-3.5 py-2.5 text-[13.5px] outline-none focus:border-magenta" />
              <div className="flex max-h-[150px] flex-col gap-1 overflow-y-auto rounded-[9px] border border-line-2 p-1.5">
                {loadingP && <div className="px-2 py-3 text-center text-[12.5px] text-muted">Cargando pacientes…</div>}
                {errP && <button onClick={loadPatients} className="px-2 py-3 text-center text-[12.5px] font-bold text-magenta">No se pudieron cargar. Reintentar</button>}
                {!loadingP && !errP && patients.length === 0 && <div className="px-2 py-3 text-center text-[12.5px] text-muted">No hay pacientes. Usa "Cliente nuevo".</div>}
                {patients.filter((p) => { const q = pQuery.trim().toLowerCase(); return !q || p.name.toLowerCase().includes(q) || (p.phone ?? '').includes(q); }).map((p) => {
                  const on = patientId === p.id;
                  return (
                    <div key={p.id} onClick={() => setPatientId(p.id)} className="flex cursor-pointer items-center gap-2 rounded-[8px] px-2.5 py-2 text-[13px]" style={{ background: on ? 'var(--magenta-soft)' : 'transparent' }}>
                      <span className="flex-1 font-semibold">{p.name}</span>
                      <span className="text-[11.5px] text-muted">{p.phone}</span>
                      {on && <span className="font-extrabold text-magenta">✓</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Selector de servicio con buscador, igual que en el cobro: con el catálogo
              lleno, un <select> largo obliga a desplazarse a ciegas. */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-bold text-muted">Servicio / paquete</span>
            {svcElegido ? (
              <div className="flex items-center gap-2.5 rounded-[10px] border border-magenta bg-magenta-soft px-3 py-2.5">
                <span className="rounded-full bg-card px-2 py-0.5 text-[10.5px] font-bold text-navy">{KIND_TAG[svcElegido.kind] ?? svcElegido.kind}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-bold">{svcElegido.name}</div>
                  <div className="text-[11.5px] text-muted">{svcElegido.price ? fmtRD(svcElegido.price) : 'sin precio'}{svcElegido.sessions > 1 ? ` · ${svcElegido.sessions} sesiones` : ''}</div>
                </div>
                <button type="button" onClick={() => { setServiceId(''); setSvcQuery(''); }} className="rounded-lg px-2 py-1 text-[12px] font-bold text-magenta">Cambiar</button>
              </div>
            ) : serviceId === FOLLOWUP ? (
              <div className="flex items-center gap-2.5 rounded-[10px] border border-magenta bg-magenta-soft px-3 py-2.5">
                <div className="flex-1 text-[13px] font-bold">↻ Seguimiento de tratamiento <span className="font-semibold text-muted">(sin cargo)</span></div>
                <button type="button" onClick={() => setServiceId('')} className="rounded-lg px-2 py-1 text-[12px] font-bold text-magenta">Cambiar</button>
              </div>
            ) : (
              <>
                <input value={svcQuery} onChange={(e) => setSvcQuery(e.target.value)} placeholder="🔍 Buscar servicio, combo o paquete…"
                  className="rounded-[9px] border border-line px-3 py-2.5 text-[13px] outline-none focus:border-magenta" />
                <div className="flex max-h-[190px] flex-col gap-1 overflow-y-auto rounded-[10px] border border-line-2 p-2">
                  {!isNew && (
                    <button type="button" onClick={() => setServiceId(FOLLOWUP)}
                      className="rounded-[9px] px-2.5 py-2 text-left text-[12.5px] font-bold text-navy hover:bg-bg">
                      ↻ Seguimiento de tratamiento <span className="font-semibold text-muted">(continuación, sin cargo)</span>
                    </button>
                  )}
                  {serviciosFiltrados.map((s) => (
                    <button key={s.id} type="button" onClick={() => { setServiceId(s.id); setSvcQuery(''); }}
                      className="flex items-center gap-2 rounded-[9px] px-2.5 py-2 text-left hover:bg-bg">
                      <span className="flex-none rounded-full bg-navy-soft px-2 py-0.5 text-[10.5px] font-bold text-navy">{KIND_TAG[s.kind] ?? s.kind}</span>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{s.name}</span>
                      <span className="flex-none text-[12.5px] font-bold text-magenta">{s.price ? fmtRD(s.price) : 'sin precio'}</span>
                    </button>
                  ))}
                  {serviciosFiltrados.length === 0 && (
                    <div className="px-2.5 py-3 text-center text-[12.5px] text-muted">
                      {services.length === 0 ? 'No hay servicios en el catálogo.' : 'Sin coincidencias.'}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          {/* Si el paciente tiene paquetes comprados, se elige cuál consume esta sesión.
              Así el sistema descuenta la sesión al cerrar el turno (antes se llevaba en papel). */}
          {(() => {
            const pk = patients.find((p) => p.id === patientId)?.packages ?? [];
            if (isNew || pk.length === 0) return null;
            return (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-muted">¿De cuál paquete es esta sesión?</span>
                <select value={treatmentId} onChange={(e) => setTreatmentId(e.target.value)} className="rounded-[9px] border border-line bg-card px-3.5 py-3 text-[13.5px]">
                  <option value="">— Ninguno (servicio suelto) —</option>
                  {pk.map((t) => <option key={t.id} value={t.id}>{t.name} · quedan {t.remaining} de {t.total}</option>)}
                </select>
                <span className="text-[11px] text-faint">Al cerrar el turno se descuenta 1 sesión del paquete elegido.</span>
              </label>
            );
          })()}
          {!isNew && serviceId === FOLLOWUP && (
            <div className="rounded-[10px] border px-3.5 py-2.5 text-xs font-semibold" style={{ background: 'var(--teal-soft)', borderColor: '#CFE2F0', color: '#1E5A82' }}>
              ↻ Solo se agenda la próxima sesión del tratamiento actual. No se carga ningún servicio nuevo.
            </div>
          )}

          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1.5"><span className="text-xs font-bold text-muted">Fecha</span><input type="date" className="rounded-[9px] border border-line bg-card px-3.5 py-3 text-[13.5px]" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="flex flex-1 flex-col gap-1.5"><span className="text-xs font-bold text-muted">Hora</span><input type="time" className="rounded-[9px] border border-line bg-card px-3.5 py-3 text-[13.5px]" value={time} onChange={(e) => setTime(e.target.value)} /></label>
          </div>
          {/* Duración real del proceso: reserva a la esteticista todo ese tiempo. */}
          <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">¿Cuánto durará?</span>
            <select className="rounded-[9px] border border-line bg-card px-3.5 py-3 text-[13.5px]" value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))}>
              {[30, 45, 60, 90, 120, 150, 180, 240].map((m) => (
                <option key={m} value={m}>{m < 60 ? `${m} minutos` : m % 60 === 0 ? `${m / 60} hora${m > 60 ? 's' : ''}` : `${Math.floor(m / 60)}h ${m % 60}min`}</option>
              ))}
            </select>
            <span className="text-[11px] text-faint">La esteticista queda reservada todo ese tiempo. Entre pacientes se dejan 30 minutos.</span>
          </label>
          <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Esteticista asignada</span>
            <select className="rounded-[9px] border border-line bg-card px-3.5 py-3 text-[13.5px]" value={therapistId} onChange={(e) => setTherapistId(e.target.value)}>
              <option value="">Sin asignar</option>
              {therapists.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        </div>
        <div className="flex gap-2.5 border-t border-line px-4 sm:px-6 py-4">
          <button onClick={onClose} className="flex-1 rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">Cancelar</button>
          <button onClick={save} disabled={busy} className="flex-[2] rounded-[10px] bg-magenta py-3 text-[13.5px] font-bold text-white disabled:opacity-60">Agendar y confirmar</button>
        </div>
      </div>
    </Overlay>
  );
}
