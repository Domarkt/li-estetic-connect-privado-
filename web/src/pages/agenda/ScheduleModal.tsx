import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { useBranch } from '../../layout/BranchContext';
import { useToast } from '../../components/Toast';
import { Overlay, stop } from '../../components/Modal';
import { fmtRD, type BusinessHours, type CatalogItem, type PatientRow, type PatientType, type Therapist } from '../../lib/types';

interface Props { branchQuery: string; onClose: () => void; onSaved: () => void }

const todayStr = () => new Date().toISOString().slice(0, 10);
// Mismas etiquetas que en el cobro, para que el equipo vea siempre el mismo formato.
const KIND_TAG: Record<string, string> = { SERVICIO: 'Servicio', PAQUETE: 'Paquete', COMBO: 'Combo' };
const DEFAULT_HOURS: BusinessHours = {
  weekdays: { open: '09:00', close: '19:00', closed: false },
  saturday: { open: '09:00', close: '15:00', closed: false },
  sunday: { open: '09:00', close: '15:00', closed: true },
};
const minusMinutes = (hhmm: string, amount: number) => {
  const [h, m] = hhmm.split(':').map(Number); const n = Math.max(0, h * 60 + m - amount);
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
};

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
  const [newSector, setNewSector] = useState('');
  const [newProvince, setNewProvince] = useState('');
  const [branchId, setBranchId] = useState(staff?.role === 'ADMIN' ? (branches[0]?.id ?? '') : (staff?.branchId ?? ''));
  const [services, setServices] = useState<CatalogItem[]>([]);
  const [serviceIds, setServiceIds] = useState<string[]>([]); // varios servicios a agendar/cobrar
  const [followUp, setFollowUp] = useState(false); // seguimiento (sin cargo)
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
  // Agendar varias citas de una vez (paquete recién comprado).
  const [serie, setSerie] = useState(false);
  const [serieModo, setSerieModo] = useState<'intervalo' | 'fechas'>('intervalo');
  const [serieCount, setSerieCount] = useState('4');
  const [serieEvery, setSerieEvery] = useState(7); // 1 diario · 2 interdiario · 7 semanal · 14 quincenal · 30 mensual
  // Fechas/horas individuales (procedimientos irregulares: 3x/semana, etc.).
  const [serieSlots, setSerieSlots] = useState<{ date: string; time: string }[]>([{ date: '', time: '10:00' }]);
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
  const appointmentBranchId = isNew
    ? (staff?.role === 'ADMIN' ? branchId : staff?.branchId)
    : patients.find((p) => p.id === patientId)?.branchId;
  const configuredHours = branches.find((b) => b.id === appointmentBranchId)?.businessHours ?? DEFAULT_HOURS;
  const dayNo = new Date(`${date}T12:00:00`).getDay();
  const dayHours = dayNo === 0 ? configuredHours.sunday : dayNo === 6 ? configuredHours.saturday : configuredHours.weekdays;
  const latestStart = minusMinutes(dayHours.close, durationMin);

  // Paquetes/combos que el paciente YA PAGÓ y aún tiene sesiones por consumir.
  // Son la primera opción al agendar: buscar el mismo servicio en el catálogo
  // terminaría cobrándoselo dos veces.
  const planesPagados = (patients.find((p) => p.id === patientId)?.packages ?? [])
    .filter((t) => t.remaining > 0);

  /** Agenda una sesión del plan pagado: sin servicio del catálogo y sin cargo. */
  const elegirPlan = (id: string) => {
    setTreatmentId(id);
    setServiceIds([]); setFollowUp(false);
    setSvcQuery('');
  };

  const toggleSvc = (id: string) => setServiceIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const svcSel = services.filter((s) => serviceIds.includes(s.id));
  const serviciosFiltrados = services.filter((s) => {
    const q = svcQuery.trim().toLowerCase();
    return !q || s.name.toLowerCase().includes(q) || (s.code ?? '').toLowerCase().includes(q);
  });

  async function save() {
    if (dayHours.closed) { toast('La sucursal está cerrada ese día. Administración puede modificarlo en Configuración.'); return; }
    if (time < dayHours.open || time > latestStart) {
      toast(`Para ${durationMin} minutos, elige una hora entre ${dayHours.open} y ${latestStart}`);
      return;
    }
    // Paciente conocido: hay que decir a qué viene (su plan pagado, un servicio
    // nuevo o un seguimiento). Sin esto la cita quedaba como "Valoración inicial".
    if (!isNew && !treatmentId && !followUp && serviceIds.length === 0) {
      toast('Elige su paquete ya pagado o uno o varios servicios');
      return;
    }
    if (isNew && !followUp && serviceIds.length === 0) {
      toast('Agrega al menos un servicio para el paciente nuevo');
      return;
    }
    setBusy(true);
    try {
      // Sesión de un plan YA PAGADO: se agenda contra el tratamiento, sin ítem del
      // catálogo. Varios servicios nuevos → se mandan como serviceIds y se guardan
      // como cargos pendientes para cobrarlos TODOS al llegar.
      const plan = treatmentId ? planesPagados.find((t) => t.id === treatmentId) : null;
      const esSeguimiento = !!plan || followUp;
      const nombres = svcSel.map((s) => s.name).join(' + ');
      const payload: Record<string, unknown> = {
        patientType: type, date, time,
        therapistId: therapistId || undefined,
        isFollowUp: esSeguimiento,
        serviceName: plan
          ? plan.name // en la agenda se lee el combo real, no "Seguimiento"
          : followUp ? 'Seguimiento de tratamiento' : (nombres || 'Valoración inicial'),
        catalogItemId: null,
        serviceIds: (!plan && !followUp && serviceIds.length) ? serviceIds : undefined,
        treatmentId: treatmentId || null,
        durationMin,
      };
      // Serie de citas para un paciente ya registrado (paquete recién comprado).
      if (!isNew && serie) {
        if (!patientId) { toast('Selecciona un paciente'); setBusy(false); return; }
        // Fechas individuales (diario/interdiario/3x semana/irregular) o por intervalo.
        const slots = serieModo === 'fechas'
          ? serieSlots.filter((s) => s.date && s.time).map((s) => ({ date: s.date, time: s.time }))
          : undefined;
        if (serieModo === 'fechas' && (!slots || slots.length === 0)) { toast('Agrega al menos una fecha con su hora'); setBusy(false); return; }
        const r = await api.post<{ message: string; count: number }>('/appointments/serie', {
          patientId,
          serviceName: payload.serviceName,
          catalogItemId: payload.catalogItemId ?? undefined,
          treatmentId: treatmentId || undefined,
          therapistId: therapistId || undefined,
          date, time, durationMin,
          ...(slots ? { slots } : { count: Math.max(1, Math.min(60, Number(serieCount) || 1)), everyDays: serieEvery }),
        });
        toast(r.message); onSaved(); onClose(); return;
      }
      if (isNew) {
        if (!newName.trim() || !newPhone.trim()) { toast('Nombre y celular del paciente nuevo requeridos'); setBusy(false); return; }
        if (!newSex) { toast('Selecciona el sexo del paciente'); setBusy(false); return; }
        payload.newPatient = {
          name: newName.trim(), phone: newPhone.trim(), sex: newSex,
          email: newEmail.trim() || undefined,
          birthDate: newBirth || undefined,
          address: newAddress.trim() || undefined,
          sector: newSector.trim() || undefined,
          province: newProvince.trim() || undefined,
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
    // No se cierra al hacer click fuera (se perdía el formulario a medio llenar):
    // solo con la ✕ o Cancelar.
    <Overlay onClose={() => {}} z={110}>
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
              {/* Dirección seccionada: se captura aquí, al agendar, para que no se salte. */}
              <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Dirección <span className="font-semibold text-faint">(calle y número)</span></span><input value={newAddress} onChange={(e) => setNewAddress(e.target.value)} placeholder="C/ Duarte #12" className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" /></label>
              <div className="flex gap-3">
                <label className="flex flex-1 flex-col gap-1.5"><span className="text-xs font-bold text-muted">Sector</span><input value={newSector} onChange={(e) => setNewSector(e.target.value)} placeholder="Villa Verde" className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" /></label>
                <label className="flex flex-1 flex-col gap-1.5"><span className="text-xs font-bold text-muted">Provincia</span>
                  <input list="prov-do-sched" value={newProvince} onChange={(e) => setNewProvince(e.target.value)} placeholder="La Romana" className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" />
                  <datalist id="prov-do-sched">{['Distrito Nacional','Santo Domingo','Santiago','La Romana','La Altagracia','San Pedro de Macorís','La Vega','Puerto Plata','Duarte','San Cristóbal','Espaillat','Azua','Barahona','Monseñor Nouel','Peravia','Hermanas Mirabal','Monte Plata','Sánchez Ramírez','María Trinidad Sánchez','Samaná','Valverde','Montecristi','Hato Mayor','El Seibo','San Juan','Baoruco','Independencia','Pedernales','Elías Piña','Santiago Rodríguez','Dajabón','San José de Ocoa'].map((pr) => <option key={pr} value={pr} />)}</datalist>
                </label>
              </div>
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
                    <div key={p.id} onClick={() => { setPatientId(p.id); setTreatmentId(''); setServiceIds([]); setFollowUp(false); }} className="flex cursor-pointer items-center gap-2 rounded-[8px] px-2.5 py-2 text-[13px]" style={{ background: on ? 'var(--magenta-soft)' : 'transparent' }}>
                      <span className="flex-1 font-semibold">{p.name}</span>
                      <span className="text-[11.5px] text-muted">{p.phone}</span>
                      {on && <span className="font-extrabold text-magenta">✓</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* PLANES YA PAGADOS — van primero y a la vista.
              Si el paciente compró un combo, agendar su próxima sesión NO debe pasar
              por el catálogo: buscar ahí el mismo servicio termina cobrándolo otra vez. */}
          {!isNew && planesPagados.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-muted">Ya pagado · agenda su próxima sesión</span>
              <div className="flex flex-col gap-1.5">
                {planesPagados.map((t) => {
                  const on = treatmentId === t.id;
                  return (
                    <button key={t.id} type="button" onClick={() => elegirPlan(t.id)}
                      className="flex items-center gap-2.5 rounded-[10px] border px-3 py-2.5 text-left"
                      style={{ borderColor: on ? 'var(--magenta)' : 'var(--line)', background: on ? 'var(--magenta-soft)' : 'var(--card)' }}>
                      <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg text-[13px]"
                        style={{ background: on ? 'var(--magenta)' : 'var(--magenta-soft)', color: on ? '#fff' : 'var(--magenta)' }}>✦</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-bold">{t.name}</span>
                        <span className="block text-[11.5px] text-muted">Quedan {t.remaining} de {t.total} sesiones · sin cargo</span>
                      </span>
                      {on && <span className="flex-none text-[12px] font-bold text-magenta">✓</span>}
                    </button>
                  );
                })}
              </div>
              <span className="text-[11px] text-faint">
                Esta cita consume una sesión del paquete. No se cobra de nuevo.
              </span>
            </div>
          )}

          {/* Servicio del catálogo: solo para lo que hay que COBRAR.
              Se oculta si ya se eligió un plan pagado, para no mezclar. */}
          {!treatmentId && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-bold text-muted">
              {!isNew && planesPagados.length > 0 ? 'O agenda uno o varios servicios (se cobran)' : 'Servicios (puedes agregar varios)'}
            </span>
            {followUp ? (
              <div className="flex items-center gap-2.5 rounded-[10px] border border-magenta bg-magenta-soft px-3 py-2.5">
                <div className="flex-1 text-[13px] font-bold">↻ Seguimiento de tratamiento <span className="font-semibold text-muted">(sin cargo)</span></div>
                <button type="button" onClick={() => setFollowUp(false)} className="rounded-lg px-2 py-1 text-[12px] font-bold text-magenta">Cambiar</button>
              </div>
            ) : (
              <>
                {/* Servicios ya elegidos (etiquetas quitables). Se cobran todos al llegar. */}
                {svcSel.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {svcSel.map((s) => (
                      <span key={s.id} className="flex items-center gap-1.5 rounded-full border border-magenta bg-magenta-soft px-2.5 py-1 text-[12px] font-bold text-magenta">
                        {s.name}<span className="text-[11px] font-semibold">{s.price ? fmtRD(s.price) : 'sin $'}</span>
                        <button type="button" onClick={() => toggleSvc(s.id)} className="text-[13px] leading-none text-magenta/70 hover:text-danger">×</button>
                      </span>
                    ))}
                  </div>
                )}
                <input value={svcQuery} onChange={(e) => setSvcQuery(e.target.value)} placeholder="🔍 Buscar y agregar servicio, combo o paquete…"
                  className="rounded-[9px] border border-line px-3 py-2.5 text-[13px] outline-none focus:border-magenta" />
                <div className="flex max-h-[190px] flex-col gap-1 overflow-y-auto rounded-[10px] border border-line-2 p-2">
                  {!isNew && svcSel.length === 0 && (
                    <button type="button" onClick={() => setFollowUp(true)}
                      className="rounded-[9px] px-2.5 py-2 text-left text-[12.5px] font-bold text-navy hover:bg-bg">
                      ↻ Seguimiento de tratamiento <span className="font-semibold text-muted">(continuación, sin cargo)</span>
                    </button>
                  )}
                  {serviciosFiltrados.map((s) => {
                    const on = serviceIds.includes(s.id);
                    return (
                      <button key={s.id} type="button" onClick={() => toggleSvc(s.id)}
                        className="flex items-center gap-2 rounded-[9px] px-2.5 py-2 text-left hover:bg-bg"
                        style={on ? { background: 'var(--magenta-soft)' } : undefined}>
                        <span className="flex-none rounded-full bg-navy-soft px-2 py-0.5 text-[10.5px] font-bold text-navy">{KIND_TAG[s.kind] ?? s.kind}</span>
                        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{on ? '✓ ' : ''}{s.name}</span>
                        <span className="flex-none text-[12.5px] font-bold text-magenta">{s.price ? fmtRD(s.price) : 'sin precio'}</span>
                      </button>
                    );
                  })}
                  {serviciosFiltrados.length === 0 && (
                    <div className="px-2.5 py-3 text-center text-[12.5px] text-muted">
                      {services.length === 0 ? 'No hay servicios en el catálogo.' : 'Sin coincidencias.'}
                    </div>
                  )}
                </div>
                {svcSel.length > 1 && <div className="text-[11px] text-faint">Se agendan los {svcSel.length} servicios y se cobran juntos cuando el paciente llegue.</div>}
              </>
            )}
          </div>
          )}

          {/* Plan elegido: se confirma qué se agendó y cómo deshacerlo. */}
          {treatmentId && (() => {
            const t = planesPagados.find((x) => x.id === treatmentId);
            if (!t) return null;
            return (
              <div className="flex items-center gap-2 rounded-[10px] border px-3.5 py-2.5 text-xs font-semibold"
                style={{ background: 'var(--teal-soft)', borderColor: '#CFE2F0', color: '#1E5A82' }}>
                <span className="flex-1">✓ Sesión de <b>{t.name}</b> · ya pagada, no se cobra de nuevo.</span>
                <button type="button" onClick={() => { setTreatmentId(''); setServiceIds([]); setFollowUp(false); }}
                  className="flex-none rounded-lg px-2 py-1 text-[11.5px] font-bold text-magenta">Cambiar</button>
              </div>
            );
          })()}

          {!isNew && !treatmentId && followUp && (
            <div className="rounded-[10px] border px-3.5 py-2.5 text-xs font-semibold" style={{ background: 'var(--teal-soft)', borderColor: '#CFE2F0', color: '#1E5A82' }}>
              ↻ Solo se agenda la próxima sesión del tratamiento actual. No se carga ningún servicio nuevo.
            </div>
          )}

          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1.5"><span className="text-xs font-bold text-muted">Fecha</span><input type="date" className="rounded-[9px] border border-line bg-card px-3.5 py-3 text-[13.5px]" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="flex flex-1 flex-col gap-1.5"><span className="text-xs font-bold text-muted">Hora</span><input type="time" min={dayHours.open} max={latestStart} className="rounded-[9px] border border-line bg-card px-3.5 py-3 text-[13.5px]" value={time} onChange={(e) => setTime(e.target.value)} /></label>
          </div>
          {/* Duración real del proceso: reserva a la esteticista todo ese tiempo. */}
          <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">¿Cuánto durará?</span>
            <select className="rounded-[9px] border border-line bg-card px-3.5 py-3 text-[13.5px]" value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))}>
              {[30, 45, 60, 90, 120, 150, 180, 240].map((m) => (
                <option key={m} value={m}>{m < 60 ? `${m} minutos` : m % 60 === 0 ? `${m / 60} hora${m > 60 ? 's' : ''}` : `${Math.floor(m / 60)}h ${m % 60}min`}</option>
              ))}
            </select>
            <span className="text-[11px] text-faint">La esteticista queda reservada exactamente durante ese bloque. Puede agendarse otra cita al terminar.</span>
            <span className="text-[11px] font-semibold" style={{ color: dayHours.closed ? 'var(--danger)' : 'var(--teal)' }}>
              {dayHours.closed ? 'Sucursal cerrada ese día' : `Horario de la sucursal: ${dayHours.open}–${dayHours.close} · última hora para ${durationMin} min: ${latestStart}`}
            </span>
          </label>

          {/* Serie de citas: cuando compra un paquete se agendan todas de una vez. */}
          {!isNew && (
            <div className="rounded-[10px] border border-line bg-bg p-3">
              <button type="button" onClick={() => setSerie((v) => !v)} className="flex w-full items-center justify-between text-left">
                <span className="flex flex-col">
                  <span className="text-[13px] font-bold">Agendar varias citas (paquete)</span>
                  <span className="text-[11px] text-faint">Fija la 1ª y el sistema crea las demás al mismo horario.</span>
                </span>
                <span className="relative flex h-6 w-11 flex-none items-center rounded-full transition" style={{ background: serie ? 'var(--magenta)' : 'var(--line)' }}>
                  <span className="absolute h-5 w-5 rounded-full bg-white transition-all" style={{ left: serie ? 22 : 2 }} />
                </span>
              </button>
              {serie && (
                <div className="mt-2.5 flex flex-col gap-2.5">
                  {/* Cómo generar las citas: por intervalo regular o eligiendo cada fecha. */}
                  <div className="flex gap-1.5">
                    {([['intervalo', 'Por intervalo'], ['fechas', 'Elegir fechas']] as const).map(([m, lbl]) => (
                      <button key={m} type="button" onClick={() => setSerieModo(m)}
                        className="flex-1 rounded-[9px] border py-2 text-[12px] font-bold"
                        style={{ borderColor: serieModo === m ? 'var(--magenta)' : 'var(--line)', background: serieModo === m ? 'var(--magenta-soft)' : 'var(--card)', color: serieModo === m ? 'var(--magenta)' : 'var(--muted)' }}>{lbl}</button>
                    ))}
                  </div>

                  {serieModo === 'intervalo' ? (
                    <>
                      <div className="flex gap-2.5">
                        <label className="flex flex-1 flex-col gap-1"><span className="text-[11px] font-bold text-muted">¿Cuántas citas?</span>
                          <input inputMode="numeric" value={serieCount} onChange={(e) => setSerieCount(e.target.value.replace(/\D/g, ''))} placeholder="4"
                            className="rounded-[9px] border border-line bg-card px-3 py-2.5 text-[13px] outline-none focus:border-magenta" /></label>
                        <label className="flex flex-1 flex-col gap-1"><span className="text-[11px] font-bold text-muted">¿Cada cuánto?</span>
                          <select value={serieEvery} onChange={(e) => setSerieEvery(Number(e.target.value))} className="rounded-[9px] border border-line bg-card px-3 py-2.5 text-[13px]">
                            <option value={1}>Diario</option>
                            <option value={2}>Interdiario (día por medio)</option>
                            <option value={7}>Semanal</option>
                            <option value={14}>Cada 15 días</option>
                            <option value={30}>Mensual</option>
                          </select></label>
                      </div>
                      <div className="text-[11px] text-faint">Todas a las <b>{time}</b> con la misma esteticista, desde la fecha de arriba.</div>
                    </>
                  ) : (
                    <>
                      <span className="text-[11px] font-bold text-muted">Fechas y horas de cada cita</span>
                      <div className="flex flex-col gap-1.5">
                        {serieSlots.map((s, i) => (
                          <div key={i} className="flex items-center gap-1.5">
                            <input type="date" value={s.date} onChange={(e) => setSerieSlots((x) => x.map((y, j) => j === i ? { ...y, date: e.target.value } : y))}
                              className="flex-1 rounded-[9px] border border-line bg-card px-2.5 py-2 text-[12.5px]" />
                            <input type="time" value={s.time} onChange={(e) => setSerieSlots((x) => x.map((y, j) => j === i ? { ...y, time: e.target.value } : y))}
                              className="rounded-[9px] border border-line bg-card px-2.5 py-2 text-[12.5px]" />
                            <button type="button" onClick={() => setSerieSlots((x) => x.length > 1 ? x.filter((_, j) => j !== i) : x)}
                              className="flex-none rounded-md px-2 text-[15px] font-bold text-muted hover:text-danger">×</button>
                          </div>
                        ))}
                      </div>
                      <button type="button" onClick={() => setSerieSlots((x) => [...x, { date: '', time: x[x.length - 1]?.time || '10:00' }])}
                        className="self-start text-[12px] font-bold text-magenta">+ Agregar otra fecha</button>
                      <div className="text-[11px] text-faint">Ideal para diario, 3 veces por semana o fechas irregulares. Cada cita con su propia esteticista se reagenda después.</div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

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
