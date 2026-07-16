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
  const [therapists, setTherapists] = useState<Therapist[]>([]);
  const [therapistId, setTherapistId] = useState('');
  const [date, setDate] = useState(todayStr());
  const [time, setTime] = useState('10:00');
  const [busy, setBusy] = useState(false);
  const [loadingP, setLoadingP] = useState(true);
  const [errP, setErrP] = useState(false);
  const [pQuery, setPQuery] = useState('');

  function loadPatients() {
    setLoadingP(true); setErrP(false);
    api.get<PatientRow[]>(`/patients?q=${branchQuery}`)
      .then((p) => { setPatients(p); setLoadingP(false); if (p[0]) setPatientId(p[0].id); })
      .catch(() => { setLoadingP(false); setErrP(true); });
  }

  useEffect(() => {
    loadPatients();
    api.get<CatalogItem[]>('/catalog').then((c) => { const s = c.filter((i) => i.kind === 'SERVICIO' || i.kind === 'PAQUETE' || i.kind === 'COMBO'); setServices(s); if (s[0]) setServiceId(s[0].id); });
    api.get<Therapist[]>(`/users/therapists${branchQuery ? '?' + branchQuery.slice(1) : ''}`).then((t) => { setTherapists(t); if (t[0] && staff?.role !== 'ESTETICISTA') setTherapistId(t[0].id); });
    if (staff?.role === 'ESTETICISTA') setTherapistId(staff.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchQuery]);

  const isNew = type === 'NUEVO';

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
      const r = await api.post<{ message: string }>('/appointments', payload);
      toast(r.message);
      onSaved();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al agendar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay onClose={onClose} z={110}>
      <div onClick={stop} className="w-[460px] max-w-full overflow-hidden rounded-2xl bg-card animate-pop" style={{ boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
        <div className="flex items-center border-b border-line px-6 py-5"><div className="flex-1 text-base font-extrabold">Agendar cita</div><button onClick={onClose} className="h-8 w-8 rounded-lg bg-bg text-muted">×</button></div>
        <div className="flex flex-col gap-3.5 px-6 py-5">
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

          <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Servicio / paquete</span>
            <select className="rounded-[9px] border border-line bg-card px-3.5 py-3 text-[13.5px]" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              {!isNew && <option value={FOLLOWUP}>— Seguimiento de tratamiento (continuación, sin cargo) —</option>}
              {services.map((s) => <option key={s.id} value={s.id}>{s.name} — {fmtRD(s.price)}</option>)}
            </select>
          </label>
          {!isNew && serviceId === FOLLOWUP && (
            <div className="rounded-[10px] border px-3.5 py-2.5 text-xs font-semibold" style={{ background: 'var(--teal-soft)', borderColor: '#CFE2F0', color: '#1E5A82' }}>
              ↻ Solo se agenda la próxima sesión del tratamiento actual. No se carga ningún servicio nuevo.
            </div>
          )}

          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1.5"><span className="text-xs font-bold text-muted">Fecha</span><input type="date" className="rounded-[9px] border border-line bg-card px-3.5 py-3 text-[13.5px]" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="flex flex-1 flex-col gap-1.5"><span className="text-xs font-bold text-muted">Hora</span><input type="time" className="rounded-[9px] border border-line bg-card px-3.5 py-3 text-[13.5px]" value={time} onChange={(e) => setTime(e.target.value)} /></label>
          </div>
          <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Esteticista asignada</span>
            <select className="rounded-[9px] border border-line bg-card px-3.5 py-3 text-[13.5px]" value={therapistId} onChange={(e) => setTherapistId(e.target.value)}>
              <option value="">Sin asignar</option>
              {therapists.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        </div>
        <div className="flex gap-2.5 border-t border-line px-6 py-4">
          <button onClick={onClose} className="flex-1 rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">Cancelar</button>
          <button onClick={save} disabled={busy} className="flex-[2] rounded-[10px] bg-magenta py-3 text-[13.5px] font-bold text-white disabled:opacity-60">Agendar y confirmar</button>
        </div>
      </div>
    </Overlay>
  );
}
