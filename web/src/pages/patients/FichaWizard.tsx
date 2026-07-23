import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/Toast';
import { Portal } from '../../components/Modal';
import { MOTIVOS, ANTECEDENTES, MEDICAMENTOS, FOTOTIPOS, FOTOTIPO_DESC } from './fichaConstants';
import type { PatientPackage } from '../../lib/types';

interface Props {
  patientId: string;
  patientName: string;
  onClose: () => void;
  onSaved: () => void;
}

interface FichaPatient { name?: string; phone?: string; email?: string | null; sex?: string | null; age?: number | null; cedula?: string | null; occupation?: string | null; address?: string | null; birthDate?: string | null }
interface FichaData {
  consultDate?: string | null; motivos?: string[];
  antecedentes?: unknown; ginecoObst?: unknown; quirurgicos?: unknown; medicamentos?: unknown;
  fototipo?: string | null; tallaCm?: number | null; pesoLb?: number | null;
  alturaCm?: number | null; cinturaCm?: number | null; abdomenCm?: number | null; piernaCm?: number | null; brazoCm?: number | null;
  tratamiento?: string | null; controlCitas?: { fecha: string; obs: string }[] | null; cancelPolicyAck?: boolean;
}

// Secuencia de pasos (índices 1..4) según rol.
function sequenceFor(role: string): number[] {
  if (role === 'RECEPCIONISTA') return [1];
  if (role === 'ESTETICISTA') return [2, 3, 4];
  return [1, 2, 3, 4]; // ADMIN
}

const STEP_LABELS = ['Datos & motivo', 'Antecedentes', 'Medicamentos & piel', 'Tratamiento'];

export default function FichaWizard({ patientId, patientName, onClose, onSaved }: Props) {
  const { staff } = useAuth();
  const toast = useToast();
  const seq = sequenceFor(staff!.role);
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);

  // Estado del formulario
  const [datos, setDatos] = useState({ name: patientName, sex: '', age: '', birthDate: '', phone: '', email: '', cedula: '', occupation: '', address: '', consultDate: '' });
  const [motivos, setMotivos] = useState<Set<string>>(new Set());
  const [antecedentes, setAntecedentes] = useState<Record<string, boolean>>({});
  const [gineco, setGineco] = useState({ embarazos: '', partos: '', abortos: '', lactancia: false });
  const [quirurgicos, setQuirurgicos] = useState({ implantes: false, cirugia: false, observaciones: '' });
  const [medicamentos, setMedicamentos] = useState<Record<string, boolean>>({});
  const [fototipo, setFototipo] = useState('');
  const [talla, setTalla] = useState('');
  const [peso, setPeso] = useState('');
  const [altura, setAltura] = useState('');
  const [medidas, setMedidas] = useState({ cintura: '', abdomen: '', pierna: '', brazo: '' });
  const [tratamiento, setTratamiento] = useState('');
  const [controlCitas, setControlCitas] = useState<{ fecha: string; obs: string }[]>(
    Array.from({ length: 10 }, () => ({ fecha: '', obs: '' })),
  );
  const [policyAck, setPolicyAck] = useState(false);

  // Precarga la ficha existente para NO perder/ sobrescribir datos ya guardados
  // (antecedentes, medicamentos, etc.) al editar y volver a guardar.
  useEffect(() => {
    api.get<{ patient: FichaPatient; ficha: FichaData | null }>(`/patients/${patientId}/ficha`)
      .then(({ patient, ficha }) => {
        setDatos((d) => ({
          ...d,
          name: patient.name ?? d.name,
          sex: patient.sex ?? d.sex,
          phone: patient.phone ?? d.phone,
          email: patient.email ?? d.email,
          age: patient.age != null ? String(patient.age) : d.age,
          cedula: patient.cedula ?? d.cedula,
          occupation: patient.occupation ?? d.occupation,
          address: patient.address ?? d.address,
          birthDate: patient.birthDate ? String(patient.birthDate).slice(0, 10) : d.birthDate,
          consultDate: ficha?.consultDate ? String(ficha.consultDate).slice(0, 10) : d.consultDate,
        }));
        if (ficha) {
          if (Array.isArray(ficha.motivos)) setMotivos(new Set(ficha.motivos));
          if (ficha.antecedentes) setAntecedentes(ficha.antecedentes as Record<string, boolean>);
          if (ficha.ginecoObst) setGineco((g) => ({ ...g, ...(ficha.ginecoObst as object) }));
          if (ficha.quirurgicos) setQuirurgicos((q) => ({ ...q, ...(ficha.quirurgicos as object) }));
          if (ficha.medicamentos) setMedicamentos(ficha.medicamentos as Record<string, boolean>);
          if (ficha.fototipo) setFototipo(ficha.fototipo);
          if (ficha.tallaCm != null) setTalla(String(ficha.tallaCm));
          if (ficha.pesoLb != null) setPeso(String(ficha.pesoLb));
          if (ficha.alturaCm != null) setAltura(String(ficha.alturaCm));
          setMedidas((m) => ({
            cintura: ficha.cinturaCm != null ? String(ficha.cinturaCm) : m.cintura,
            abdomen: ficha.abdomenCm != null ? String(ficha.abdomenCm) : m.abdomen,
            pierna: ficha.piernaCm != null ? String(ficha.piernaCm) : m.pierna,
            brazo: ficha.brazoCm != null ? String(ficha.brazoCm) : m.brazo,
          }));
          if (ficha.tratamiento) setTratamiento(ficha.tratamiento);
          if (Array.isArray(ficha.controlCitas) && ficha.controlCitas.length) {
            const rows = Array.from({ length: 10 }, (_, i) => ficha.controlCitas![i] ?? { fecha: '', obs: '' });
            setControlCitas(rows as { fecha: string; obs: string }[]);
          }
          if (ficha.cancelPolicyAck) setPolicyAck(true);
        }
      })
      .catch(() => { /* ficha nueva: se queda vacía */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const stepNum = seq[idx];
  const isLast = idx === seq.length - 1;
  const phaseLabel = staff!.role === 'RECEPCIONISTA' ? 'Recepción · Paso 1' : 'Parte clínica (esteticista)';

  async function saveStep1() {
    await api.patch(`/patients/${patientId}/ficha/step1`, {
      consultDate: datos.consultDate || undefined,
      name: datos.name || undefined,
      sex: datos.sex || undefined,
      age: datos.age ? Number(datos.age) : undefined,
      birthDate: datos.birthDate || undefined,
      phone: datos.phone || undefined,
      email: datos.email || undefined,
      cedula: datos.cedula || undefined,
      occupation: datos.occupation || undefined,
      address: datos.address || undefined,
      motivos: [...motivos],
    });
  }

  async function saveClinical(complete: boolean) {
    await api.patch(`/patients/${patientId}/ficha/clinical`, {
      antecedentes, ginecoObst: gineco, quirurgicos, medicamentos,
      fototipo: fototipo || undefined,
      tallaCm: talla ? Number(talla) : undefined,
      pesoLb: peso ? Number(peso) : undefined,
      alturaCm: altura ? Number(altura) : undefined,
      cinturaCm: medidas.cintura ? Number(medidas.cintura) : undefined,
      abdomenCm: medidas.abdomen ? Number(medidas.abdomen) : undefined,
      piernaCm: medidas.pierna ? Number(medidas.pierna) : undefined,
      brazoCm: medidas.brazo ? Number(medidas.brazo) : undefined,
      tratamiento: tratamiento || undefined,
      controlCitas,
      cancelPolicyAck: policyAck,
      complete,
    });
  }

  async function next() {
    setBusy(true);
    try {
      // Guarda el progreso en CADA paso (no solo al final), para no perder datos
      // si se cierra el wizard a mitad. El Paso 1 es de recepción; 2-4 son clínicos.
      if (stepNum === 1) await saveStep1();
      else await saveClinical(isLast); // complete=true solo en el último paso clínico

      if (isLast) {
        toast(staff!.role === 'RECEPCIONISTA'
          ? 'Datos iniciales guardados · ficha enviada a la esteticista'
          : 'Ficha clínica guardada correctamente');
        onSaved();
        onClose();
        return;
      }
      setIdx(idx + 1);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al guardar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Portal>
    <div className="fixed inset-0 z-[110] overflow-y-auto" style={{ background: 'rgba(28,37,64,.5)' }}>
     <div className="flex min-h-full items-start justify-center p-4 sm:p-7">
      <div className="flex max-h-[94vh] w-[820px] max-w-full flex-col overflow-hidden rounded-[18px] bg-card animate-pop"
        style={{ boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
        {/* Header */}
        <div className="flex items-center gap-3.5 border-b border-line px-[26px] py-5">
          <img src="/li-logo.png" alt="Li Estetic Center" className="h-[30px]" />
          <div className="flex-1">
            <div className="text-base font-extrabold">Ficha Clínica Médica y Estética</div>
            <div className="text-[12.5px] text-muted">{patientName} · {phaseLabel}</div>
          </div>
          <button onClick={onClose} className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] bg-bg text-[18px] text-muted">×</button>
        </div>

        {/* Stepper */}
        <div className="flex gap-[22px] border-b border-line-2 px-[26px] py-4">
          {[1, 2, 3, 4].map((n) => {
            const active = n === stepNum;
            const inSeq = seq.includes(n);
            return (
              <div key={n} className="flex items-center gap-2 text-[12.5px] font-bold"
                style={{ color: active ? 'var(--magenta)' : inSeq ? 'var(--ink)' : 'var(--faint)' }}>
                <span className="flex h-6 w-6 items-center justify-center rounded-full text-[11px]"
                  style={{ background: active ? 'var(--magenta)' : 'var(--navy-soft)', color: active ? '#fff' : 'var(--muted)' }}>{n}</span>
                {STEP_LABELS[n - 1]}
              </div>
            );
          })}
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-[26px] py-6">
          {stepNum === 1 && <Step1 datos={datos} setDatos={setDatos} motivos={motivos} setMotivos={setMotivos} />}
          {stepNum === 2 && <Step2 ant={antecedentes} setAnt={setAntecedentes} gineco={gineco} setGineco={setGineco} quir={quirurgicos} setQuir={setQuirurgicos} />}
          {stepNum === 3 && <Step3 med={medicamentos} setMed={setMedicamentos} fototipo={fototipo} setFototipo={setFototipo} talla={talla} setTalla={setTalla} peso={peso} setPeso={setPeso} altura={altura} setAltura={setAltura} medidas={medidas} setMedidas={setMedidas} />}
          {stepNum === 4 && <Step4 patientId={patientId} tratamiento={tratamiento} setTratamiento={setTratamiento} rows={controlCitas} setRows={setControlCitas} policyAck={policyAck} setPolicyAck={setPolicyAck} />}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line px-[26px] py-4">
          <button onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx === 0}
            className="rounded-[10px] border border-line bg-card px-4 py-2.5 text-[13.5px] font-bold text-muted disabled:opacity-40">← Atrás</button>
          <div className="text-[12.5px] font-semibold text-faint">Paso {stepNum} de 4</div>
          <button onClick={next} disabled={busy}
            className="rounded-[10px] bg-magenta px-[22px] py-2.5 text-[13.5px] font-bold text-white disabled:opacity-60"
            style={{ boxShadow: '0 4px 12px rgba(179,28,134,.25)' }}>
            {busy ? 'Guardando…' : isLast ? (staff!.role === 'RECEPCIONISTA' ? 'Guardar y enviar' : 'Guardar ficha') : 'Continuar →'}
          </button>
        </div>
      </div>
     </div>
    </div>
    </Portal>
  );
}

const inputCls = 'rounded-[9px] border border-line px-3 py-2.5 text-[13.5px] outline-none focus:border-magenta';
const lblCls = 'text-xs font-bold text-muted';
const sectionCls = 'mb-3 text-[13px] font-extrabold uppercase tracking-wide text-navy';

/** Edad calculada a partir de una fecha ISO (YYYY-MM-DD). Cadena vacía si no aplica. */
function ageFromISO(iso: string): string {
  if (!iso) return '';
  const b = new Date(iso + 'T00:00:00');
  if (isNaN(b.getTime())) return '';
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--;
  return a >= 0 && a < 130 ? String(a) : '';
}

type Datos = { name: string; sex: string; age: string; birthDate: string; phone: string; email: string; cedula: string; occupation: string; address: string; consultDate: string };

function Step1({ datos, setDatos, motivos, setMotivos }: {
  datos: Datos; setDatos: React.Dispatch<React.SetStateAction<Datos>>;
  motivos: Set<string>; setMotivos: (s: Set<string>) => void;
}) {
  const set = (k: keyof Datos, v: string) => setDatos({ ...datos, [k]: v });
  const toggle = (m: string) => { const n = new Set(motivos); n.has(m) ? n.delete(m) : n.add(m); setMotivos(n); };
  return (
    <div className="animate-fade">
      <div className="mb-5 grid grid-cols-3 gap-3.5">
        <label className="flex flex-col gap-1.5"><span className={lblCls}>Fecha de consulta</span><input type="date" className={inputCls} value={datos.consultDate} onChange={(e) => set('consultDate', e.target.value)} /></label>
        <label className="col-span-2 flex flex-col gap-1.5"><span className={lblCls}>Nombre completo</span><input className={inputCls} value={datos.name} onChange={(e) => set('name', e.target.value)} placeholder="Nombre y apellidos" /></label>
        <label className="flex flex-col gap-1.5"><span className={lblCls}>Edad <span className="font-semibold text-faint">(automática)</span></span><input className={inputCls + ' bg-bg text-muted'} value={datos.age} readOnly placeholder="—" title="Se calcula de la fecha de nacimiento" /></label>
        <label className="flex flex-col gap-1.5"><span className={lblCls}>Fecha de nacimiento</span><input type="date" className={inputCls} value={datos.birthDate} onChange={(e) => setDatos({ ...datos, birthDate: e.target.value, age: ageFromISO(e.target.value) })} /></label>
        <label className="flex flex-col gap-1.5"><span className={lblCls}>Celular</span><input className={inputCls} value={datos.phone} onChange={(e) => set('phone', e.target.value)} placeholder="809-000-0000" /></label>
        <label className="col-span-2 flex flex-col gap-1.5"><span className={lblCls}>Correo electrónico</span><input type="email" className={inputCls} value={datos.email} onChange={(e) => set('email', e.target.value)} placeholder="paciente@correo.com" /></label>
        <label className="flex flex-col gap-1.5"><span className={lblCls}>Cédula / ID</span><input className={inputCls} value={datos.cedula} onChange={(e) => set('cedula', e.target.value)} placeholder="000-0000000-0" /></label>
        <label className="flex flex-col gap-1.5"><span className={lblCls}>Ocupación</span><input className={inputCls} value={datos.occupation} onChange={(e) => set('occupation', e.target.value)} /></label>
        <div className="col-span-2 flex flex-col gap-1.5"><span className={lblCls}>Sexo</span>
          <div className="flex gap-2">
            {([['F', 'Femenino'], ['M', 'Masculino']] as const).map(([v, lbl]) => (
              <button key={v} type="button" onClick={() => set('sex', v)} className="flex-1 rounded-[9px] border py-2.5 text-[13px] font-bold"
                style={{ borderColor: datos.sex === v ? 'var(--magenta)' : 'var(--line)', background: datos.sex === v ? 'var(--magenta-soft)' : 'var(--bg)', color: datos.sex === v ? 'var(--magenta)' : 'var(--muted)' }}>
                {lbl}
              </button>
            ))}
          </div>
        </div>
        <label className="col-span-3 flex flex-col gap-1.5"><span className={lblCls}>Dirección</span><input className={inputCls} value={datos.address} onChange={(e) => set('address', e.target.value)} /></label>
      </div>
      <div className={sectionCls}>A · Motivo de la consulta</div>
      <div className="grid grid-cols-3 gap-2.5">
        {MOTIVOS.map((m) => {
          const on = motivos.has(m);
          return (
            <label key={m} className="flex cursor-pointer items-center gap-2 rounded-[9px] border px-3 py-2.5 text-[13px]"
              style={{ background: on ? 'var(--magenta-soft)' : 'var(--bg)', borderColor: on ? 'var(--magenta)' : 'var(--line)' }}>
              <input type="checkbox" checked={on} onChange={() => toggle(m)} style={{ accentColor: 'var(--magenta)', width: 16, height: 16 }} />
              {m}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function YesNo({ label, value, onChange }: { label: string; value: boolean | undefined; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-2.5 border-b border-line-2 px-0.5 py-1.5">
      <span className="text-[13px]">{label}</span>
      <div className="flex flex-none gap-1.5">
        {[true, false].map((v) => (
          <label key={String(v)} className="flex cursor-pointer items-center gap-1 text-xs" style={{ color: value === v ? 'var(--magenta)' : 'var(--muted)', fontWeight: value === v ? 700 : 400 }}>
            <input type="radio" checked={value === v} onChange={() => onChange(v)} style={{ accentColor: 'var(--magenta)' }} /> {v ? 'Sí' : 'No'}
          </label>
        ))}
      </div>
    </div>
  );
}

function Step2({ ant, setAnt, gineco, setGineco, quir, setQuir }: {
  ant: Record<string, boolean>; setAnt: (v: Record<string, boolean>) => void;
  gineco: { embarazos: string; partos: string; abortos: string; lactancia: boolean }; setGineco: (v: typeof gineco) => void;
  quir: { implantes: boolean; cirugia: boolean; observaciones: string }; setQuir: (v: typeof quir) => void;
}) {
  return (
    <div className="animate-fade">
      <div className={sectionCls}>B · Antecedentes patológicos</div>
      <div className="mb-6 grid grid-cols-2 gap-x-[22px] gap-y-2">
        {ANTECEDENTES.map((r) => <YesNo key={r} label={r} value={ant[r]} onChange={(v) => setAnt({ ...ant, [r]: v })} />)}
      </div>
      <div className="grid grid-cols-2 gap-5">
        <div>
          <div className="mb-2.5 text-[12.5px] font-extrabold uppercase text-navy">Antecedentes gineco-obstétricos</div>
          <div className="mb-2.5 flex gap-2.5">
            {(['embarazos', 'partos', 'abortos'] as const).map((k) => (
              <label key={k} className="flex flex-1 flex-col gap-1"><span className="text-[11.5px] font-bold capitalize text-muted">{k}</span>
                <input className="rounded-lg border border-line p-2 text-[13px]" value={gineco[k]} onChange={(e) => setGineco({ ...gineco, [k]: e.target.value })} /></label>
            ))}
          </div>
          <YesNo label="Lactancia materna" value={gineco.lactancia} onChange={(v) => setGineco({ ...gineco, lactancia: v })} />
        </div>
        <div>
          <div className="mb-2.5 text-[12.5px] font-extrabold uppercase text-navy">C · Antecedentes quirúrgicos</div>
          <YesNo label="Implantes estéticos" value={quir.implantes} onChange={(v) => setQuir({ ...quir, implantes: v })} />
          <YesNo label="Cirugía" value={quir.cirugia} onChange={(v) => setQuir({ ...quir, cirugia: v })} />
          <label className="mt-3 flex flex-col gap-1.5"><span className="text-[11.5px] font-bold text-muted">Observaciones</span>
            <textarea rows={2} className="resize-none rounded-lg border border-line p-2.5 text-[13px]" value={quir.observaciones} onChange={(e) => setQuir({ ...quir, observaciones: e.target.value })} /></label>
        </div>
      </div>
    </div>
  );
}

type Medidas = { cintura: string; abdomen: string; pierna: string; brazo: string };
function Step3({ med, setMed, fototipo, setFototipo, talla, setTalla, peso, setPeso, altura, setAltura, medidas, setMedidas }: {
  med: Record<string, boolean>; setMed: (v: Record<string, boolean>) => void;
  fototipo: string; setFototipo: (v: string) => void;
  talla: string; setTalla: (v: string) => void; peso: string; setPeso: (v: string) => void;
  altura: string; setAltura: (v: string) => void; medidas: Medidas; setMedidas: (v: Medidas) => void;
}) {
  return (
    <div className="animate-fade">
      <div className={sectionCls}>E · ¿Ingiere algún tipo de medicamento?</div>
      <div className="mb-6 grid grid-cols-2 gap-x-[22px] gap-y-2">
        {MEDICAMENTOS.map((m) => <YesNo key={m} label={m} value={med[m]} onChange={(v) => setMed({ ...med, [m]: v })} />)}
      </div>
      <div className="grid grid-cols-[1.6fr_1fr] gap-[22px]">
        <div>
          <div className="mb-2.5 text-[12.5px] font-extrabold uppercase text-navy">D · Fototipo de piel (Fitzpatrick)</div>
          <div className="flex gap-2">
            {FOTOTIPOS.map((k) => {
              const on = fototipo === k;
              return (
                <button key={k} onClick={() => setFototipo(k)} title={FOTOTIPO_DESC[k]}
                  className="flex-1 rounded-[10px] border-[1.5px] py-3 text-[15px] font-extrabold"
                  style={{ borderColor: on ? 'var(--magenta)' : 'var(--line)', background: on ? 'var(--magenta-soft)' : 'transparent', color: on ? 'var(--magenta)' : 'var(--ink)' }}>{k}</button>
              );
            })}
          </div>
          <div className="mt-2 rounded-[9px] px-3 py-2 text-[11.5px] leading-snug" style={{ background: 'var(--bg)', color: fototipo ? 'var(--ink)' : 'var(--muted)' }}>
            {fototipo ? <><b>Fototipo {fototipo}:</b> {FOTOTIPO_DESC[fototipo]}</> : 'Pasa el cursor o toca cada opción para ver la descripción y elegir el tipo de piel.'}
          </div>
        </div>
        <div className="flex flex-col justify-end gap-2.5">
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1"><span className="text-[11px] font-bold text-muted">Altura (cm)</span><input className="rounded-lg border border-line p-2.5 text-[13px]" value={altura} onChange={(e) => setAltura(e.target.value)} /></label>
            <label className="flex flex-col gap-1"><span className="text-[11px] font-bold text-muted">Talla (cm)</span><input className="rounded-lg border border-line p-2.5 text-[13px]" value={talla} onChange={(e) => setTalla(e.target.value)} /></label>
            <label className="flex flex-col gap-1"><span className="text-[11px] font-bold text-muted">Peso (lb)</span><input className="rounded-lg border border-line p-2.5 text-[13px]" value={peso} onChange={(e) => setPeso(e.target.value)} /></label>
          </div>
          <div className="text-[11px] font-extrabold uppercase text-navy">Medidas corporales (cm)</div>
          <div className="grid grid-cols-4 gap-2">
            {([['cintura', 'Cintura'], ['abdomen', 'Abdomen'], ['pierna', 'Piernas'], ['brazo', 'Brazos']] as const).map(([k, lbl]) => (
              <label key={k} className="flex flex-col gap-1"><span className="text-[11px] font-bold text-muted">{lbl}</span><input className="rounded-lg border border-line p-2.5 text-[13px]" value={medidas[k]} onChange={(e) => setMedidas({ ...medidas, [k]: e.target.value })} /></label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

type AreaOptFicha = { key: string; label: string; grupo: string };

/**
 * Panel del PLAN PAGADO en el paso clínico: le muestra a la esteticista el servicio/combo
 * que el paciente compró (con sus sesiones reales) y le deja elegir las ÁREAS a trabajar.
 * Las sesiones se reparten entre las áreas elegidas. Reutiliza el mismo endpoint del drawer.
 */
function PlanPagado({ patientId, onPlan }: { patientId: string; onPlan: (p: { name: string; sessions: number } | null) => void }) {
  const toast = useToast();
  const [pkg, setPkg] = useState<PatientPackage | null>(null);
  const [opciones, setOpciones] = useState<AreaOptFicha[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    Promise.all([
      api.get<{ packages?: PatientPackage[] }>(`/patients/${patientId}`),
      api.get<AreaOptFicha[]>('/catalog/body-areas').catch(() => []),
    ]).then(([detail, opts]) => {
      if (!vivo) return;
      const activo = (detail.packages ?? []).find((p) => p.remaining > 0) ?? (detail.packages ?? [])[0] ?? null;
      setPkg(activo);
      setOpciones(opts);
      setSel((activo?.areas ?? []).filter((a) => !a.isExtra).map((a) => a.area));
      onPlan(activo ? { name: activo.name, sessions: activo.total } : null);
      setLoading(false);
    }).catch(() => { if (vivo) { setLoading(false); } });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  if (loading) return <div className="mb-4 rounded-[11px] border border-line bg-bg px-4 py-3 text-[12.5px] text-muted">Cargando servicio pagado…</div>;
  if (!pkg) return (
    <div className="mb-4 rounded-[11px] border border-dashed border-line px-4 py-3 text-[12.5px] text-muted">
      Aún no hay un servicio/combo pagado para este paciente. Aparecerá aquí una vez recepción registre el cobro.
    </div>
  );

  const grupos = [
    { label: 'Corporal', grupo: 'CORPORAL', areas: opciones.filter((o) => o.grupo === 'CORPORAL') },
    { label: 'Láser', grupo: 'LASER', areas: opciones.filter((o) => o.grupo === 'LASER') },
  ].filter((g) => (pkg.areaGroup ? g.grupo === pkg.areaGroup : true) && g.areas.length > 0);
  const extras = (pkg.areas ?? []).filter((a) => a.isExtra).map((a) => a.area);
  const toggle = (k: string) => { if (extras.includes(k)) return; setSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k])); };
  const porArea = sel.length ? Math.floor(pkg.total / sel.length) : 0;

  async function guardarAreas() {
    if (!sel.length) { toast('Elige al menos un área a trabajar'); return; }
    setBusy(true);
    try {
      const r = await api.patch<{ message: string }>(`/patients/treatments/${pkg!.id}/areas`, { areas: sel });
      toast(r.message);
    } catch (e) { toast(e instanceof Error ? e.message : 'Error'); } finally { setBusy(false); }
  }

  return (
    <div className="mb-4 rounded-[11px] border border-magenta/40 bg-magenta-soft p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-magenta text-[13px] text-white">✦</span>
        <div className="flex-1">
          <div className="text-[13.5px] font-extrabold text-magenta">{pkg.name}</div>
          <div className="text-[11.5px] text-muted">{pkg.total} sesiones · {pkg.done} hechas · {pkg.remaining} restantes</div>
        </div>
      </div>
      {(pkg.services ?? []).length > 0 && (
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {pkg.services!.map((s) => (
            <span key={s.id} className="rounded-full bg-card px-2 py-0.5 text-[11px] font-bold text-navy">
              {s.name}{s.total ? ` · ${s.done ?? 0}/${s.total}` : s.qty ? ` ×${s.qty}` : ''}
            </span>
          ))}
        </div>
      )}
      <div className="mb-1.5 text-[11.5px] font-bold text-muted">Áreas a trabajar <span className="font-semibold text-faint">({sel.length} · {porArea} sesiones c/u)</span></div>
      {grupos.map((g) => (
        <div key={g.label} className="mb-2 flex flex-col gap-1.5">
          {grupos.length > 1 && <div className="text-[10.5px] font-bold uppercase tracking-wide text-faint">{g.label}</div>}
          <div className="flex flex-wrap gap-1.5">
            {g.areas.map((a) => {
              const on = sel.includes(a.key); const isExtra = extras.includes(a.key);
              return (
                <button key={a.key} type="button" onClick={() => toggle(a.key)} disabled={isExtra}
                  className="rounded-full border px-3 py-1.5 text-[12px] font-bold disabled:opacity-60"
                  style={{ borderColor: on || isExtra ? 'var(--magenta)' : 'var(--line)', background: on || isExtra ? 'var(--card)' : 'transparent', color: on || isExtra ? 'var(--magenta)' : 'var(--muted)' }}>
                  {on ? '✓ ' : ''}{a.label}{isExtra ? ' (adicional)' : ''}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <button type="button" onClick={guardarAreas} disabled={busy}
        className="mt-1 w-full rounded-[9px] bg-magenta py-2.5 text-[12.5px] font-bold text-white disabled:opacity-60">
        {busy ? 'Guardando…' : 'Guardar áreas del plan'}
      </button>
    </div>
  );
}

function Step4({ patientId, tratamiento, setTratamiento, rows, setRows, policyAck, setPolicyAck }: {
  patientId: string;
  tratamiento: string; setTratamiento: (v: string) => void;
  rows: { fecha: string; obs: string }[]; setRows: (v: { fecha: string; obs: string }[]) => void;
  policyAck: boolean; setPolicyAck: (v: boolean) => void;
}) {
  const setRow = (i: number, k: 'fecha' | 'obs', v: string) => {
    const next = rows.map((r, j) => (j === i ? { ...r, [k]: v } : r));
    setRows(next);
  };
  // Ajusta el # de filas de control a las sesiones REALES del plan pagado (no un 10 fijo).
  const onPlan = (p: { name: string; sessions: number } | null) => {
    if (!p) return;
    if (!tratamiento.trim()) setTratamiento(`${p.name} — ${p.sessions} sesiones`);
    if (p.sessions > 0 && rows.length !== p.sessions) {
      const vacias = rows.every((r) => !r.fecha && !r.obs);
      if (vacias) setRows(Array.from({ length: p.sessions }, () => ({ fecha: '', obs: '' })));
    }
  };
  return (
    <div className="animate-fade">
      <PlanPagado patientId={patientId} onPlan={onPlan} />
      <label className="mb-4 flex flex-col gap-1.5"><span className={lblCls}>Tratamiento a realizar</span>
        <input className={inputCls} value={tratamiento} onChange={(e) => setTratamiento(e.target.value)} placeholder="Ej. Reducción de medidas — 10 sesiones" /></label>
      <div className="mb-2.5 text-[12.5px] font-extrabold uppercase text-navy">Control de citas (1 – {rows.length})</div>
      <div className="mb-4 overflow-hidden rounded-[11px] border border-line">
        <div className="grid grid-cols-[60px_1fr_1.6fr] px-3.5 py-2.5 text-[11.5px] font-bold uppercase text-navy" style={{ background: 'var(--navy-soft)' }}>
          <div>Cita</div><div>Fecha</div><div>Observaciones</div>
        </div>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[60px_1fr_1.6fr] items-center border-t border-line-2 px-3.5 py-1">
            <div className="text-[13px] font-bold text-muted">{i + 1}</div>
            <input type="date" value={r.fecha} onChange={(e) => setRow(i, 'fecha', e.target.value)} className="bg-transparent px-1 py-2 text-[12.5px] outline-none" />
            <input value={r.obs} onChange={(e) => setRow(i, 'obs', e.target.value)} className="border-l border-line-2 bg-transparent px-2 py-2 text-[12.5px] outline-none" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[1.4fr_1fr] gap-[18px]">
        <div className="rounded-[11px] border p-4" style={{ background: 'var(--warn-soft)', borderColor: '#F0D9A8' }}>
          <div className="mb-1.5 text-xs font-extrabold" style={{ color: 'var(--warn)' }}>⚠ Política de cancelación</div>
          <ul className="m-0 list-disc pl-4 text-xs leading-relaxed" style={{ color: '#7A5A12' }}>
            <li>Cancelar con 24h de anticipación.</li>
            <li>Después de 5 citas canceladas se pierde el tratamiento.</li>
            <li>El servicio es intransferible. No se aceptan reembolsos.</li>
            <li>Suspensión: 45 días para reembolso.</li>
          </ul>
          <label className="mt-3 flex items-center gap-2 text-xs font-semibold" style={{ color: '#7A5A12' }}>
            <input type="checkbox" checked={policyAck} onChange={(e) => setPolicyAck(e.target.checked)} style={{ accentColor: 'var(--warn)' }} />
            El paciente acepta la política
          </label>
        </div>
        <div className="flex flex-col justify-end">
          <div className="flex h-[72px] items-center justify-center rounded-[11px] border-2 border-dashed border-line text-[12.5px] font-semibold text-faint">✎ Firma de autorización</div>
          <div className="mt-1.5 text-center text-[11.5px] text-muted">Firma de autorización del paciente</div>
        </div>
      </div>
    </div>
  );
}
