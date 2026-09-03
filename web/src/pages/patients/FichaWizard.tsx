import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/Toast';
import { Portal } from '../../components/Modal';
import { MOTIVOS, ANTECEDENTES, MEDICAMENTOS, FOTOTIPOS, FOTOTIPO_DESC } from './fichaConstants';
import type { PatientPackage } from '../../lib/types';
import FirmaDigital from '../../components/FirmaDigital';

/** Una visita registrada: qué se aplicó, sobre qué áreas y si el paciente firmó. */
interface SesionAplicada {
  id: string; at: string; fecha: string;
  techniques: string[]; areas: string[]; firmada: boolean; notes: string | null;
}

interface Props {
  patientId: string;
  patientName: string;
  /** Paso inicial (1..4). Al abrir turno se entra directo en Tratamiento. */
  startStep?: number;
  /** Plan que consume la cita: el paso 4 lo preselecciona para no descontar del
   *  paquete equivocado cuando el paciente tiene varios. */
  treatmentId?: string | null;
  onClose: () => void;
  onSaved: () => void;
}

interface FichaPatient { name?: string; phone?: string; email?: string | null; sex?: string | null; age?: number | null; occupation?: string | null; address?: string | null; sector?: string | null; province?: string | null; fichaNumber?: string | null; birthDate?: string | null }
interface FichaData {
  consultDate?: string | null; motivos?: string[];
  antecedentes?: unknown; ginecoObst?: unknown; quirurgicos?: unknown; medicamentos?: unknown;
  fototipo?: string | null; tallaCm?: number | null; pesoLb?: number | null;
  alturaCm?: number | null; cinturaCm?: number | null; abdomenCm?: number | null; piernaCm?: number | null; brazoCm?: number | null;
  abdomenAltoCm?: number | null; abdomenBajoCm?: number | null; piernaAltaCm?: number | null; piernaBajaCm?: number | null; brazoAltoCm?: number | null; brazoBajoCm?: number | null; gluteosCm?: number | null;
  tratamiento?: string | null; controlCitas?: { fecha: string; obs: string }[] | null; cancelPolicyAck?: boolean;
}

// Secuencia de pasos (índices 1..4) según rol.
//
// El paso 4 (Tratamiento) SOLO existe cuando la ficha se abrió para registrar un
// procedimiento desde el turno con código (conTratamiento = true). Al "ver ficha"
// normal se llega hasta Medicamentos & piel: así el plan no queda abierto para
// navegar y no se puede guardar dos veces ni cambiar algo sin la firma del turno.
function sequenceFor(role: string, conTratamiento: boolean): number[] {
  if (role === 'RECEPCIONISTA') return [1];
  if (role === 'ESTETICISTA') return conTratamiento ? [2, 3, 4] : [2, 3];
  // ADMIN ve SIEMPRE el proceso completo (incluye Tratamiento/bitácora) para poder
  // revisar el expediente de un paciente sin depender del turno con código.
  return [1, 2, 3, 4];
}

const STEP_LABELS = ['Datos & motivo', 'Antecedentes', 'Medicamentos & piel', 'Tratamiento'];

/** Consentimiento informado que el paciente valida con su firma al aplicar el procedimiento. */
const CONSENTIMIENTO = 'Declaro que he recibido información clara, completa y comprensible sobre el procedimiento estético que me será realizado, ya sea mediante aparatología —como cavitación, radiofrecuencia, vacunterapia, lipoláser, láser, HIFU, microdermoabrasión u otros equipos—, tratamientos faciales o corporales, peeling, masajes reductores, drenajes y masajes postquirúrgicos, aplicación de toxina botulínica (Botox), mesoterapia, inyecciones u otros procedimientos estéticos. Se me han explicado el objetivo del tratamiento, la forma en que se realizará, los beneficios esperados, las posibles molestias, riesgos, efectos secundarios, contraindicaciones, cuidados posteriores y alternativas disponibles. Confirmo que he informado de manera verdadera cualquier enfermedad, alergia, medicamento, embarazo, cirugía reciente o condición de salud que pueda influir en el procedimiento. Comprendo que los resultados pueden variar en cada persona, que podrían requerirse varias sesiones y que no se garantiza un resultado exacto. Entiendo que los tratamientos postquirúrgicos no sustituyen la evaluación ni las indicaciones del médico cirujano y que los procedimientos inyectables o invasivos deberán ser realizados por el profesional autorizado correspondiente. Autorizo voluntariamente a Li Estetic Center y al profesional responsable a realizar el procedimiento indicado, así como a suspenderlo o modificarlo si se detecta alguna condición que pueda representar un riesgo para mi salud. Comprendo claramente que puedo cambiar de opinión y cancelar el procedimiento antes de que este sea iniciado. Declaro que tuve la oportunidad de hacer preguntas, que recibí respuestas satisfactorias y que me comprometo a seguir todas las indicaciones antes y después del tratamiento, así como a informar inmediatamente cualquier reacción inesperada.';

export default function FichaWizard({ patientId, patientName, startStep, treatmentId, onClose, onSaved }: Props) {
  const { staff } = useAuth();
  const toast = useToast();
  // El paso Tratamiento solo se habilita cuando la ficha se abre desde el turno
  // con código (startStep === 4). Al ver/editar la ficha normal, queda bloqueado.
  const modoTratamiento = startStep === 4;
  const seq = sequenceFor(staff!.role, modoTratamiento);
  // Si se pidió empezar en un paso concreto (p. ej. Tratamiento tras abrir el
  // turno), se arranca ahí siempre que ese paso exista para el rol.
  const [idx, setIdx] = useState(() => {
    const i = startStep ? seq.indexOf(startStep) : -1;
    return i >= 0 ? i : 0;
  });
  const [busy, setBusy] = useState(false);

  // Estado del formulario
  const [datos, setDatos] = useState({ name: patientName, sex: '', age: '', birthDate: '', phone: '', email: '', occupation: '', address: '', sector: '', province: '', fichaNumber: '', consultDate: '' });
  const [motivos, setMotivos] = useState<Set<string>>(new Set());
  const [antecedentes, setAntecedentes] = useState<Record<string, boolean>>({});
  const [gineco, setGineco] = useState({ embarazos: '', partos: '', abortos: '', cesareas: '', lactancia: false });
  const [quirurgicos, setQuirurgicos] = useState({ implantes: false, cirugia: false, observaciones: '' });
  const [medicamentos, setMedicamentos] = useState<Record<string, boolean>>({});
  const [fototipo, setFototipo] = useState('');
  const [talla, setTalla] = useState('');
  const [peso, setPeso] = useState('');
  const [altura, setAltura] = useState('');
  const [medidas, setMedidas] = useState({ abdomenAlto: '', abdomenBajo: '', piernaAlta: '', piernaBaja: '', brazoAlto: '', brazoBajo: '', gluteos: '' });
  const [tratamiento, setTratamiento] = useState('');
  const [controlCitas, setControlCitas] = useState<{ fecha: string; obs: string }[]>(
    Array.from({ length: 10 }, () => ({ fecha: '', obs: '' })),
  );

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
          occupation: patient.occupation ?? d.occupation,
          fichaNumber: patient.fichaNumber ?? d.fichaNumber,
          address: patient.address ?? d.address,
          sector: patient.sector ?? d.sector,
          province: patient.province ?? d.province,
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
            abdomenAlto: ficha.abdomenAltoCm != null ? String(ficha.abdomenAltoCm) : m.abdomenAlto,
            abdomenBajo: ficha.abdomenBajoCm != null ? String(ficha.abdomenBajoCm) : m.abdomenBajo,
            piernaAlta: ficha.piernaAltaCm != null ? String(ficha.piernaAltaCm) : m.piernaAlta,
            piernaBaja: ficha.piernaBajaCm != null ? String(ficha.piernaBajaCm) : m.piernaBaja,
            brazoAlto: ficha.brazoAltoCm != null ? String(ficha.brazoAltoCm) : m.brazoAlto,
            brazoBajo: ficha.brazoBajoCm != null ? String(ficha.brazoBajoCm) : m.brazoBajo,
            gluteos: ficha.gluteosCm != null ? String(ficha.gluteosCm) : m.gluteos,
          }));
          if (ficha.tratamiento) setTratamiento(ficha.tratamiento);
          if (Array.isArray(ficha.controlCitas) && ficha.controlCitas.length) {
            const rows = Array.from({ length: 10 }, (_, i) => ficha.controlCitas![i] ?? { fecha: '', obs: '' });
            setControlCitas(rows as { fecha: string; obs: string }[]);
          }
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
      fichaNumber: datos.fichaNumber || undefined,
      name: datos.name || undefined,
      sex: datos.sex || undefined,
      age: datos.age ? Number(datos.age) : undefined,
      birthDate: datos.birthDate || undefined,
      phone: datos.phone || undefined,
      email: datos.email || undefined,
      occupation: datos.occupation || undefined,
      address: datos.address || undefined,
      sector: datos.sector || undefined,
      province: datos.province || undefined,
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
      abdomenAltoCm: medidas.abdomenAlto ? Number(medidas.abdomenAlto) : undefined,
      abdomenBajoCm: medidas.abdomenBajo ? Number(medidas.abdomenBajo) : undefined,
      piernaAltaCm: medidas.piernaAlta ? Number(medidas.piernaAlta) : undefined,
      piernaBajaCm: medidas.piernaBaja ? Number(medidas.piernaBaja) : undefined,
      brazoAltoCm: medidas.brazoAlto ? Number(medidas.brazoAlto) : undefined,
      brazoBajoCm: medidas.brazoBajo ? Number(medidas.brazoBajo) : undefined,
      gluteosCm: medidas.gluteos ? Number(medidas.gluteos) : undefined,
      tratamiento: tratamiento || undefined,
      controlCitas,
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
        <div className="flex items-center gap-3.5 border-b border-line px-4 sm:px-[26px] py-5">
          <img src="/li-logo.png" alt="Li Estetic Center" className="h-[30px]" />
          <div className="flex-1">
            <div className="text-base font-extrabold">Ficha Clínica Médica y Estética</div>
            <div className="text-[12.5px] text-muted">{patientName} · {phaseLabel}</div>
          </div>
          <button onClick={onClose} className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] bg-bg text-[18px] text-muted">×</button>
        </div>

        {/* Stepper */}
        <div className="flex gap-4 sm:gap-[22px] overflow-x-auto border-b border-line-2 px-4 sm:px-[26px] py-4">
          {[1, 2, 3, 4].map((n) => {
            const active = n === stepNum;
            const inSeq = seq.includes(n);
            return (
              <div key={n} className="flex flex-none items-center gap-2 whitespace-nowrap text-[12.5px] font-bold"
                style={{ color: active ? 'var(--magenta)' : inSeq ? 'var(--ink)' : 'var(--faint)' }}>
                <span className="flex h-6 w-6 items-center justify-center rounded-full text-[11px]"
                  style={{ background: active ? 'var(--magenta)' : 'var(--navy-soft)', color: active ? '#fff' : 'var(--muted)' }}>{n}</span>
                {STEP_LABELS[n - 1]}
              </div>
            );
          })}
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-[26px] py-6">
          {stepNum === 1 && <Step1 datos={datos} setDatos={setDatos} />}
          {stepNum === 2 && <Step2 ant={antecedentes} setAnt={setAntecedentes} gineco={gineco} setGineco={setGineco} quir={quirurgicos} setQuir={setQuirurgicos} motivos={motivos} setMotivos={setMotivos} />}
          {stepNum === 3 && <Step3 med={medicamentos} setMed={setMedicamentos} fototipo={fototipo} setFototipo={setFototipo} peso={peso} setPeso={setPeso} altura={altura} setAltura={setAltura} medidas={medidas} setMedidas={setMedidas} />}
          {stepNum === 4 && <Step4 patientId={patientId} treatmentIdCita={treatmentId} tratamiento={tratamiento} setTratamiento={setTratamiento} rows={controlCitas} setRows={setControlCitas} />}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line px-4 sm:px-[26px] py-4">
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

type Datos = { name: string; sex: string; age: string; birthDate: string; phone: string; email: string; occupation: string; address: string; sector: string; province: string; fichaNumber: string; consultDate: string };

function Step1({ datos, setDatos }: {
  datos: Datos; setDatos: React.Dispatch<React.SetStateAction<Datos>>;
}) {
  const set = (k: keyof Datos, v: string) => setDatos({ ...datos, [k]: v });
  return (
    <div className="animate-fade">
      <div className="mb-5 grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <label className="flex flex-col gap-1.5"><span className={lblCls}>N° de ficha física <span className="font-semibold text-faint">(papel)</span></span><input className={inputCls} value={datos.fichaNumber} onChange={(e) => set('fichaNumber', e.target.value)} placeholder="Ej. 0142" /></label>
        <label className="flex flex-col gap-1.5"><span className={lblCls}>Fecha de consulta</span><input type="date" className={inputCls} value={datos.consultDate} onChange={(e) => set('consultDate', e.target.value)} /></label>
        <label className="col-span-2 flex flex-col gap-1.5"><span className={lblCls}>Nombre completo</span><input className={inputCls} value={datos.name} onChange={(e) => set('name', e.target.value)} placeholder="Nombre y apellidos" /></label>
        <label className="flex flex-col gap-1.5"><span className={lblCls}>Edad <span className="font-semibold text-faint">(automática)</span></span><input className={inputCls + ' bg-bg text-muted'} value={datos.age} readOnly placeholder="—" title="Se calcula de la fecha de nacimiento" /></label>
        <label className="flex flex-col gap-1.5"><span className={lblCls}>Fecha de nacimiento</span><input type="date" className={inputCls} value={datos.birthDate} onChange={(e) => setDatos({ ...datos, birthDate: e.target.value, age: ageFromISO(e.target.value) })} /></label>
        <label className="flex flex-col gap-1.5"><span className={lblCls}>Celular</span><input className={inputCls} value={datos.phone} onChange={(e) => set('phone', e.target.value)} placeholder="809-000-0000" /></label>
        <label className="col-span-2 flex flex-col gap-1.5"><span className={lblCls}>Correo electrónico</span><input type="email" className={inputCls} value={datos.email} onChange={(e) => set('email', e.target.value)} placeholder="paciente@correo.com" /></label>
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
        <label className="flex flex-col gap-1.5"><span className={lblCls}>Calle y número</span><input className={inputCls} value={datos.address} onChange={(e) => set('address', e.target.value)} placeholder="C/ Duarte #12" /></label>
        <label className="flex flex-col gap-1.5"><span className={lblCls}>Sector</span><input className={inputCls} value={datos.sector} onChange={(e) => set('sector', e.target.value)} placeholder="Villa Verde" /></label>
        <label className="flex flex-col gap-1.5"><span className={lblCls}>Provincia</span>
          <input className={inputCls} list="prov-do" value={datos.province} onChange={(e) => set('province', e.target.value)} placeholder="La Romana" />
          <datalist id="prov-do">{['Distrito Nacional','Santo Domingo','Santiago','La Romana','La Altagracia','San Pedro de Macorís','La Vega','Puerto Plata','Duarte','San Cristóbal','Espaillat','Azua','Barahona','Monseñor Nouel','Peravia','Hermanas Mirabal','Monte Plata','Sánchez Ramírez','María Trinidad Sánchez','Samaná','Valverde','Montecristi','Hato Mayor','El Seibo','San Juan','Baoruco','Independencia','Pedernales','Elías Piña','Santiago Rodríguez','Dajabón','San José de Ocoa'].map((pr) => <option key={pr} value={pr} />)}</datalist>
        </label>
      </div>
    </div>
  );
}

// Botón Sí/No que SIEMPRE queda en un estado (nunca vacío): por defecto "No".
// Así la ficha no deja campos sin responder por olvido.
function YesNo({ label, value, onChange }: { label: string; value: boolean | undefined; onChange: (v: boolean) => void }) {
  const si = value === true; // undefined o false → No
  return (
    <div className="flex items-center justify-between gap-2.5 border-b border-line-2 px-0.5 py-1.5">
      <span className="text-[13px]">{label}</span>
      <div className="flex flex-none overflow-hidden rounded-full border border-line">
        <button type="button" onClick={() => onChange(true)} className="px-3 py-1 text-[12px] font-bold transition"
          style={{ background: si ? 'var(--magenta)' : 'var(--card)', color: si ? '#fff' : 'var(--muted)' }}>Sí</button>
        <button type="button" onClick={() => onChange(false)} className="px-3 py-1 text-[12px] font-bold transition"
          style={{ background: !si ? 'var(--navy)' : 'var(--card)', color: !si ? '#fff' : 'var(--muted)' }}>No</button>
      </div>
    </div>
  );
}

function Step2({ ant, setAnt, gineco, setGineco, quir, setQuir, motivos, setMotivos }: {
  ant: Record<string, boolean>; setAnt: (v: Record<string, boolean>) => void;
  gineco: { embarazos: string; partos: string; abortos: string; cesareas: string; lactancia: boolean }; setGineco: (v: typeof gineco) => void;
  quir: { implantes: boolean; cirugia: boolean; observaciones: string }; setQuir: (v: typeof quir) => void;
  motivos: Set<string>; setMotivos: (s: Set<string>) => void;
}) {
  const toggleMotivo = (m: string) => { const n = new Set(motivos); n.has(m) ? n.delete(m) : n.add(m); setMotivos(n); };
  return (
    <div className="animate-fade">
      {/* Motivo de la consulta: ahora lo registra la esteticista (antes recepción). */}
      <div className={sectionCls}>A · Motivo de la consulta</div>
      <div className="mb-6 grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {MOTIVOS.map((m) => {
          const on = motivos.has(m);
          return (
            <label key={m} className="flex cursor-pointer items-center gap-2 rounded-[9px] border px-3 py-2.5 text-[13px]"
              style={{ background: on ? 'var(--magenta-soft)' : 'var(--bg)', borderColor: on ? 'var(--magenta)' : 'var(--line)' }}>
              <input type="checkbox" checked={on} onChange={() => toggleMotivo(m)} style={{ accentColor: 'var(--magenta)', width: 16, height: 16 }} />
              {m}
            </label>
          );
        })}
      </div>
      <div className={sectionCls}>B · Antecedentes patológicos</div>
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-x-[22px] gap-y-2">
        {ANTECEDENTES.map((r) => <YesNo key={r} label={r} value={ant[r]} onChange={(v) => setAnt({ ...ant, [r]: v })} />)}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
        <div>
          <div className="mb-2.5 text-[12.5px] font-extrabold uppercase text-navy">Antecedentes gineco-obstétricos</div>
          <div className="mb-2.5 grid grid-cols-4 gap-2">
            {(['embarazos', 'partos', 'abortos', 'cesareas'] as const).map((k) => (
              <label key={k} className="flex flex-col gap-1 min-w-0"><span className="text-[11px] font-bold capitalize text-muted">{k === 'cesareas' ? 'Cesáreas' : k}</span>
                <input className="w-full rounded-lg border border-line p-2 text-[13px]" value={gineco[k]} onChange={(e) => setGineco({ ...gineco, [k]: e.target.value })} /></label>
            ))}
          </div>
          <YesNo label="Lactancia materna" value={gineco.lactancia} onChange={(v) => setGineco({ ...gineco, lactancia: v })} />
        </div>
        <div className="sm:border-l sm:border-line-2 sm:pl-6">
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

type Medidas = { abdomenAlto: string; abdomenBajo: string; piernaAlta: string; piernaBaja: string; brazoAlto: string; brazoBajo: string; gluteos: string };
function Step3({ med, setMed, fototipo, setFototipo, peso, setPeso, altura, setAltura, medidas, setMedidas }: {
  med: Record<string, boolean>; setMed: (v: Record<string, boolean>) => void;
  fototipo: string; setFototipo: (v: string) => void;
  peso: string; setPeso: (v: string) => void;
  altura: string; setAltura: (v: string) => void; medidas: Medidas; setMedidas: (v: Medidas) => void;
}) {
  return (
    <div className="animate-fade">
      <div className={sectionCls}>E · ¿Ingiere algún tipo de medicamento?</div>
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-x-[22px] gap-y-2">
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
          <div className="grid grid-cols-2 gap-2 min-w-0">
            <label className="flex flex-col gap-1 min-w-0"><span className="text-[11px] font-bold text-muted">Altura (cm)</span><input className="rounded-lg border border-line p-2.5 text-[13px]" value={altura} onChange={(e) => setAltura(e.target.value)} /></label>
            <label className="flex flex-col gap-1"><span className="text-[11px] font-bold text-muted">Peso (lb)</span><input className="rounded-lg border border-line p-2.5 text-[13px]" value={peso} onChange={(e) => setPeso(e.target.value)} /></label>
          </div>
          <div className="text-[11px] font-extrabold uppercase text-navy">Medidas corporales (cm)</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 min-w-0">
            {([['abdomenAlto', 'Abdomen alto'], ['abdomenBajo', 'Abdomen bajo'], ['piernaAlta', 'Pierna alta'], ['piernaBaja', 'Pierna baja'], ['brazoAlto', 'Brazo alto'], ['brazoBajo', 'Brazo bajo'], ['gluteos', 'Glúteos']] as const).map(([k, lbl]) => (
              <label key={k} className="flex flex-col gap-1 min-w-0"><span className="text-[11px] font-bold text-muted">{lbl}</span><input className="w-full rounded-lg border border-line p-2.5 text-[13px]" value={medidas[k]} onChange={(e) => setMedidas({ ...medidas, [k]: e.target.value })} /></label>
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
// Pasos guiados para la esteticista al atender: uno a la vez, en orden.
const PASOS_PLAN = ['Servicio', 'Áreas', 'Procesos', 'Observaciones', 'Consentimiento', 'Firma', 'Revisar'];

/**
 * Registro del procedimiento aplicado, guiado PASO A PASO para la esteticista:
 * 1) qué servicio(s) trabaja hoy · 2) áreas · 3) procesos (técnicas) ·
 * 4) observaciones · 5) consentimiento y política · 6) firma · 7) revisar y guardar.
 *
 * Sustituye al esquema anterior (elegir plan + "Guardar áreas" + "+ Registrar"),
 * que mezclaba todo en una sola pantalla. Reusa los mismos endpoints:
 * PATCH /areas (define el reparto la 1ª vez) y POST /session (descuenta y firma).
 */
function PlanGuiado({ patientId, treatmentIdCita, onPlan, onSesion }: { patientId: string; treatmentIdCita?: string | null; onPlan: (p: { name: string; sessions: number } | null) => void; onSesion: () => void }) {
  const toast = useToast();
  const [paquetes, setPaquetes] = useState<PatientPackage[]>([]);
  const [pkgId, setPkgId] = useState<string>('');
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const [opciones, setOpciones] = useState<AreaOptFicha[]>([]);
  const [loading, setLoading] = useState(true);
  const [recarga, setRecarga] = useState(0);

  const [paso, setPaso] = useState(1);
  const [areasHoy, setAreasHoy] = useState<string[]>([]);
  const [tecnicas, setTecnicas] = useState<string[]>([]);
  const [tecExtras, setTecExtras] = useState<string[]>([]); // "planId::técnica"
  const [notas, setNotas] = useState('');
  const [consiente, setConsiente] = useState(false);
  const [policyAck, setPolicyAck] = useState(false);
  const [firma, setFirma] = useState<string | null>(null);
  const [sesiones, setSesiones] = useState<SesionAplicada[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    Promise.all([
      api.get<{ packages?: PatientPackage[] }>(`/patients/${patientId}`),
      api.get<AreaOptFicha[]>('/catalog/body-areas').catch(() => []),
    ]).then(([detail, opts]) => {
      if (!vivo) return;
      const todos = detail.packages ?? [];
      setPaquetes(todos);
      setOpciones(opts);
      const elegido = todos.find((p) => p.id === pkgId)
        ?? todos.find((p) => p.id === treatmentIdCita)
        ?? todos.find((p) => p.remaining > 0) ?? todos[0] ?? null;
      setPkgId(elegido?.id ?? '');
      // Áreas del plan ya definidas → vienen marcadas como "trabajadas hoy".
      setAreasHoy((elegido?.areas ?? []).filter((a) => !a.isExtra && a.remaining > 0).map((a) => a.area));
      onPlan(elegido ? { name: elegido.name, sessions: elegido.total } : null);
      setLoading(false);
    }).catch(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, recarga]);

  const pkg = paquetes.find((p) => p.id === pkgId) ?? null;

  useEffect(() => {
    if (!pkg) return;
    api.get<{ sesiones: SesionAplicada[] }>(`/patients/treatments/${pkg.id}/sessions`)
      .then((r) => setSesiones(r.sesiones)).catch(() => setSesiones([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkgId]);

  if (loading) return <div className="mb-4 rounded-[11px] border border-line bg-bg px-4 py-3 text-[12.5px] text-muted">Cargando servicio pagado…</div>;
  if (!pkg) return (
    <div className="mb-4 rounded-[11px] border border-dashed border-line px-4 py-3 text-[12.5px] text-muted">
      Aún no hay un servicio/combo pagado para este paciente. Aparecerá aquí una vez recepción registre el cobro.
    </div>
  );

  const extras = paquetes.filter((x) => x.id !== pkg.id && extraIds.includes(x.id));
  const areasExtras = (pkg.areas ?? []).filter((a) => a.isExtra).map((a) => a.area);
  const planTieneAreas = (pkg.areas ?? []).some((a) => !a.isExtra);
  const grupos = [
    { label: 'Corporal', grupo: 'CORPORAL', areas: opciones.filter((o) => o.grupo === 'CORPORAL') },
    { label: 'Láser', grupo: 'LASER', areas: opciones.filter((o) => o.grupo === 'LASER') },
  ].filter((g) => (pkg.areaGroup ? g.grupo === pkg.areaGroup : true) && g.areas.length > 0);
  const disponibles = (pkg.services ?? []).filter((s) => (s.remaining ?? s.qty ?? 0) > 0);
  const marcadoAlgo = tecnicas.length > 0 || areasHoy.length > 0 || tecExtras.length > 0;
  const toggle = (arr: string[], set: (v: string[]) => void, v: string) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const porArea = areasHoy.length ? Math.floor(pkg.total / areasHoy.length) : 0;

  const cambiarPlan = (id: string) => {
    const p = paquetes.find((x) => x.id === id);
    if (!p) return;
    setPkgId(id);
    setAreasHoy((p.areas ?? []).filter((a) => !a.isExtra && a.remaining > 0).map((a) => a.area));
    setTecnicas([]);
    onPlan({ name: p.name, sessions: p.total });
  };

  // ¿Se puede avanzar del paso actual?
  const puedeAvanzar =
    paso === 1 ? !!pkgId :
    paso === 3 ? marcadoAlgo :
    paso === 5 ? (consiente && policyAck) :
    paso === 6 ? !!firma : true;

  async function guardar() {
    if (!marcadoAlgo) { toast('Marca al menos un proceso o área'); return; }
    if (!firma) { toast('Falta la firma del paciente'); return; }
    setBusy(true);
    try {
      // 1ª vez: si el plan aún no tiene áreas definidas, la selección de hoy define el reparto.
      if (!planTieneAreas && areasHoy.length) {
        await api.patch(`/patients/treatments/${pkg!.id}/areas`, { areas: areasHoy }).catch(() => {});
      }
      let msg = 'Sesión registrada y firmada';
      if (tecnicas.length || areasHoy.length) {
        const r = await api.post<{ message: string; sesiones: SesionAplicada[] }>(
          `/patients/treatments/${pkg!.id}/session`,
          { techniques: tecnicas, areas: areasHoy, signature: firma, notes: notas || undefined, completa: true },
        );
        msg = r.message; setSesiones(r.sesiones);
      }
      for (const ex of extras) {
        const tecs = tecExtras.filter((k) => k.startsWith(ex.id + '::')).map((k) => k.slice(ex.id.length + 2));
        if (!tecs.length) continue;
        const areasEx = (ex.areas ?? []).filter((a) => a.remaining > 0 && !a.isExtra).map((a) => a.area);
        await api.post(`/patients/treatments/${ex.id}/session`, { techniques: tecs, areas: areasEx, signature: firma, notes: notas || undefined });
      }
      toast(msg);
      setPaso(1); setTecnicas([]); setTecExtras([]); setExtraIds([]); setNotas(''); setConsiente(false); setPolicyAck(false); setFirma(null);
      setRecarga((r) => r + 1); onSesion();
    } catch (e) { toast(e instanceof Error ? e.message : 'Error'); } finally { setBusy(false); }
  }

  // FULL_BODY: guarda las áreas trabajadas HOY sin cerrar la sesión (no descuenta ni
  // pide firma). La sesión se completa (y descuenta) el día que termine lo que falta.
  async function guardarParcial() {
    if (!areasHoy.length && !tecnicas.length) { toast('Marca lo que trabajaste hoy'); return; }
    setBusy(true);
    try {
      if (!planTieneAreas && areasHoy.length) await api.patch(`/patients/treatments/${pkg!.id}/areas`, { areas: areasHoy }).catch(() => {});
      const r = await api.post<{ message: string }>(`/patients/treatments/${pkg!.id}/session`, { techniques: tecnicas, areas: areasHoy, completa: false, notes: notas || undefined });
      toast(r.message);
      setPaso(1); setTecnicas([]); setAreasHoy([]); setNotas('');
      setRecarga((v) => v + 1); onSesion();
    } catch (e) { toast(e instanceof Error ? e.message : 'Error'); } finally { setBusy(false); }
  }

  const areaLabel = (k: string) => opciones.find((o) => o.key === k)?.label ?? k;
  const chip = (on: boolean) => ({ borderColor: on ? 'var(--magenta)' : 'var(--line)', background: on ? 'var(--magenta-soft)' : 'transparent', color: on ? 'var(--magenta)' : 'var(--muted)' });

  return (
    <div className="mb-4 rounded-[11px] border border-magenta/40 bg-magenta-soft p-4">
      {/* Encabezado del plan + progreso de pasos */}
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-magenta text-[13px] text-white">✦</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-extrabold text-magenta">{pkg.name}</div>
          <div className="text-[11.5px] text-muted">{pkg.total} sesiones · {pkg.done} hechas · {pkg.remaining} restantes</div>
        </div>
      </div>
      {pkg.sessionMode === 'FULL_BODY' && pkg.enCurso && (pkg.enCurso.areas.length > 0 || pkg.enCurso.techniques.length > 0) && (
        <div className="mb-3 rounded-[10px] px-3.5 py-2.5 text-[11.5px] font-semibold" style={{ background: 'var(--teal-soft)', color: '#1E5A82' }}>
          ↻ Sesión en curso · ya se trabajó: <b>{pkg.enCurso.areas.map(areaLabel).join(', ') || '—'}</b>. Marca lo que falta y usa <b>Completar</b> (con firma) para cerrarla; o guarda de nuevo para seguir otro día.
        </div>
      )}
      {pkg.sessionMode === 'FULL_BODY' && (
        <div className="mb-3 rounded-[10px] bg-card px-3.5 py-2 text-[11px] font-semibold text-muted">🧩 Cuerpo completo: puedes hacer unas áreas hoy y dejar el resto para otro día. Cuenta como <b>1 sesión</b>.</div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
        {PASOS_PLAN.map((lbl, i) => {
          const n = i + 1; const done = n < paso; const cur = n === paso;
          return (
            <button key={lbl} type="button" onClick={() => n < paso && setPaso(n)} disabled={n > paso}
              className="flex items-center gap-1 rounded-full px-2 py-0.5"
              style={{ background: cur ? 'var(--magenta)' : done ? 'var(--ok-soft)' : 'transparent', color: cur ? '#fff' : done ? 'var(--ok)' : 'var(--faint)' }}>
              <span>{done ? '✓' : n}</span><span className="hidden sm:inline">{lbl}</span>
            </button>
          );
        })}
      </div>

      <div className="rounded-[10px] bg-card p-3">
        {/* PASO 1 — Servicio(s) que se trabajan hoy */}
        {paso === 1 && (
          <>
            <div className="mb-1.5 text-[11.5px] font-bold text-muted">¿Qué servicio trabajas hoy?{paquetes.length > 1 ? ' Puedes marcar otro con “+ hoy también”.' : ''}</div>
            <div className="flex flex-col gap-1.5">
              {paquetes.map((p) => {
                const on = p.id === pkgId; const agotado = p.remaining === 0;
                return (
                  <button key={p.id} type="button" onClick={() => cambiarPlan(p.id)}
                    className="flex items-center gap-2 rounded-[9px] border px-3 py-2 text-left"
                    style={{ borderColor: on ? 'var(--magenta)' : 'var(--line)', background: on ? 'var(--magenta-soft)' : 'transparent', opacity: agotado && !on ? 0.6 : 1 }}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-bold" style={{ color: on ? 'var(--magenta)' : 'var(--ink)' }}>{p.name}</span>
                      <span className="block text-[11px] text-muted">{agotado ? 'Sin sesiones disponibles' : `${p.done}/${p.total} · quedan ${p.remaining}`}</span>
                    </span>
                    {on ? <span className="flex-none text-[12px] font-bold text-magenta">✓ hoy</span> : !agotado && (
                      <span role="button" tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); setExtraIds((x) => x.includes(p.id) ? x.filter((i) => i !== p.id) : [...x, p.id]); }}
                        className="flex-none rounded-full border px-2 py-0.5 text-[10.5px] font-bold"
                        style={chip(extraIds.includes(p.id))}>
                        {extraIds.includes(p.id) ? '✓ hoy también' : '+ hoy también'}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* PASO 2 — Áreas */}
        {paso === 2 && (
          <>
            <div className="mb-1.5 text-[11.5px] font-bold text-muted">
              Áreas que trabajas <span className="font-semibold text-faint">({areasHoy.length} · {porArea || '—'} sesiones c/u)</span>
            </div>
            {planTieneAreas ? (
              <div className="flex flex-wrap gap-1.5">
                {(pkg.areas ?? []).filter((a) => !a.isExtra).map((a) => {
                  const on = areasHoy.includes(a.area); const agotada = a.remaining === 0;
                  return (
                    <button key={a.id} type="button" disabled={agotada} onClick={() => toggle(areasHoy, setAreasHoy, a.area)}
                      className="rounded-full border px-3 py-1.5 text-[12px] font-bold disabled:opacity-45" style={chip(on)}>
                      {on ? '✓ ' : ''}{a.label} <span className="font-semibold text-faint">{a.done}/{a.total}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              grupos.map((g) => (
                <div key={g.label} className="mb-2 flex flex-col gap-1.5">
                  {grupos.length > 1 && <div className="text-[10.5px] font-bold uppercase tracking-wide text-faint">{g.label}</div>}
                  <div className="flex flex-wrap gap-1.5">
                    {g.areas.map((a) => {
                      const on = areasHoy.includes(a.key); const isExtra = areasExtras.includes(a.key);
                      return (
                        <button key={a.key} type="button" disabled={isExtra} onClick={() => toggle(areasHoy, setAreasHoy, a.key)}
                          className="rounded-full border px-3 py-1.5 text-[12px] font-bold disabled:opacity-60" style={chip(on || isExtra)}>
                          {on ? '✓ ' : ''}{a.label}{isExtra ? ' (adicional)' : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
            <div className="mt-2 text-[11px] text-faint">Las áreas marcadas se descuentan del plan al firmar.</div>
          </>
        )}

        {/* PASO 3 — Procesos (técnicas) */}
        {paso === 3 && (
          <>
            <div className="mb-1.5 text-[11.5px] font-bold text-muted">¿Qué procesos le aplicaste? <span className="font-semibold text-faint">(marca uno o varios)</span></div>
            {disponibles.length === 0 ? (
              <div className="rounded-[8px] bg-bg px-2.5 py-2 text-[11.5px] text-muted">Ya se consumieron todas las técnicas de este combo.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {disponibles.map((s) => {
                  const on = tecnicas.includes(s.name);
                  return (
                    <button key={s.id} type="button" onClick={() => toggle(tecnicas, setTecnicas, s.name)}
                      className="rounded-full border px-3 py-1.5 text-[12px] font-bold" style={chip(on)}>
                      {on ? '✓ ' : ''}{s.name} <span className="font-semibold text-faint">{s.done ?? 0}/{s.total ?? s.qty}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {extras.map((ex) => {
              const disp = (ex.services ?? []).filter((s) => (s.remaining ?? s.qty ?? 0) > 0);
              if (!disp.length) return null;
              return (
                <div key={ex.id} className="mt-2.5 rounded-[9px] border border-magenta/30 bg-magenta-soft/40 p-2.5">
                  <div className="mb-1.5 text-[11.5px] font-bold text-magenta">También hoy · {ex.name}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {disp.map((s) => {
                      const k = `${ex.id}::${s.name}`; const on = tecExtras.includes(k);
                      return (
                        <button key={s.id} type="button" onClick={() => setTecExtras((x) => x.includes(k) ? x.filter((i) => i !== k) : [...x, k])}
                          className="rounded-full border px-3 py-1.5 text-[12px] font-bold" style={chip(on)}>{on ? '✓ ' : ''}{s.name}</button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* PASO 4 — Observaciones */}
        {paso === 4 && (
          <>
            <div className="mb-1.5 text-[11.5px] font-bold text-muted">Observaciones de la sesión <span className="font-semibold text-faint">(opcional)</span></div>
            <textarea rows={4} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Reacción de la piel, parámetros del equipo, indicaciones…"
              className="w-full resize-none rounded-[9px] border border-line px-3 py-2.5 text-[12.5px] outline-none focus:border-magenta" />
          </>
        )}

        {/* PASO 5 — Consentimiento + política de cancelación */}
        {paso === 5 && (
          <>
            <div className="mb-1 text-[11.5px] font-bold text-navy">Consentimiento informado</div>
            <div className="max-h-[130px] overflow-y-auto rounded-[9px] border border-line bg-bg px-3 py-2.5 text-[11px] leading-relaxed text-muted">{CONSENTIMIENTO}</div>
            <div className="mt-3 rounded-[9px] border p-3" style={{ background: 'var(--warn-soft)', borderColor: '#F0D9A8' }}>
              <div className="mb-1 text-[11.5px] font-extrabold" style={{ color: 'var(--warn)' }}>⚠ Política de cancelación</div>
              <ul className="m-0 list-disc pl-4 text-[11px] leading-relaxed" style={{ color: '#7A5A12' }}>
                <li>Cancelar con 24h de anticipación.</li>
                <li>Después de 5 citas canceladas se pierde el tratamiento.</li>
                <li>El servicio es intransferible. No se aceptan reembolsos.</li>
                <li>Suspensión: 45 días para reembolso.</li>
              </ul>
            </div>
            <label className="mt-2.5 flex items-start gap-2 text-[11.5px] font-semibold text-navy">
              <input type="checkbox" checked={consiente} onChange={(e) => setConsiente(e.target.checked)} className="mt-0.5 h-4 w-4 accent-magenta" />
              El paciente leyó y acepta el <b>consentimiento informado</b>.
            </label>
            <label className="mt-1.5 flex items-start gap-2 text-[11.5px] font-semibold text-navy">
              <input type="checkbox" checked={policyAck} onChange={(e) => setPolicyAck(e.target.checked)} className="mt-0.5 h-4 w-4 accent-magenta" />
              El paciente acepta la <b>política de cancelación</b>.
            </label>
          </>
        )}

        {/* PASO 6 — Firma */}
        {paso === 6 && (
          <FirmaDigital onChange={setFirma} etiqueta="Firma del paciente — valida el consentimiento, la política y el procedimiento" />
        )}

        {/* PASO 7 — Revisar y guardar */}
        {paso === 7 && (
          <>
            <div className="mb-1.5 text-[11.5px] font-extrabold text-navy">Revisa antes de guardar</div>
            <div className="flex flex-col gap-1 rounded-[9px] bg-bg px-3 py-2.5 text-[11.5px] text-muted">
              <div><b className="text-navy">Servicio:</b> {pkg.name}{extras.length ? ` (+${extras.length} también hoy)` : ''}</div>
              <div><b className="text-navy">Áreas:</b> {areasHoy.length ? areasHoy.length + ' marcada(s)' : '—'}</div>
              <div><b className="text-navy">Procesos:</b> {[...tecnicas, ...tecExtras.map((k) => k.split('::')[1])].join(', ') || '—'}</div>
              <div><b className="text-navy">Observaciones:</b> {notas || '—'}</div>
              <div><b className="text-navy">Consentimiento y política:</b> {consiente && policyAck ? 'aceptados' : 'pendientes'}</div>
              <div><b className="text-navy">Firma:</b> {firma ? '✓ firmado' : '— falta'}</div>
            </div>
          </>
        )}

        {/* Navegación del paso a paso */}
        <div className="mt-3 flex gap-2">
          {paso > 1 && (
            <button type="button" onClick={() => setPaso(paso - 1)} className="rounded-[9px] border border-line bg-card px-4 py-2.5 text-[12.5px] font-bold text-muted">← Atrás</button>
          )}
          {paso < 7 ? (
            <button type="button" onClick={() => puedeAvanzar && setPaso(paso + 1)} disabled={!puedeAvanzar}
              className="flex-1 rounded-[9px] bg-magenta py-2.5 text-[12.5px] font-bold text-white disabled:opacity-50">
              {paso === 3 && !marcadoAlgo ? 'Marca al menos un proceso o área'
                : paso === 5 && !(consiente && policyAck) ? 'Marca ambas casillas'
                : paso === 6 && !firma ? 'Falta la firma del paciente'
                : 'Continuar →'}
            </button>
          ) : (
            <button type="button" onClick={guardar} disabled={busy || !firma}
              className="flex-1 rounded-[9px] bg-navy py-2.5 text-[12.5px] font-bold text-white disabled:opacity-50">
              {busy ? 'Guardando…' : (pkg.sessionMode === 'FULL_BODY' ? '✓ Completar sesión (firma)' : '✓ Guardar el plan')}
            </button>
          )}
        </div>
        {pkg.sessionMode === 'FULL_BODY' && (
          <button type="button" onClick={guardarParcial} disabled={busy || (!areasHoy.length && tecnicas.length === 0)}
            className="mt-2 w-full rounded-[9px] border border-magenta bg-magenta-soft py-2.5 text-[12px] font-bold text-magenta disabled:opacity-50">
            💾 Guardar lo de hoy y continuar otro día · no descuenta ni pide firma
          </button>
        )}
      </div>

      {/* Historial breve de lo ya aplicado en este plan */}
      {sesiones.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {sesiones.slice(0, 3).map((s) => (
            <div key={s.id} className="flex items-start gap-2 rounded-[8px] bg-card px-2.5 py-1.5 text-[11.5px]">
              <span className="flex-none font-bold text-muted">{s.fecha}</span>
              <span className="min-w-0 flex-1 text-muted">{s.techniques.join(', ') || '—'}{s.areas.length ? ` · ${s.areas.join(', ')}` : ''}</span>
              {s.firmada && <span className="flex-none font-bold text-ok" title="Validado por el paciente">✓</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Una visita en la bitácora del paciente. */
interface VisitaBitacora {
  id: string; numero: number; fecha: string; hora: string;
  tratamiento: string; techniques: string[]; areas: string[];
  esteticista: string | null; observaciones: string | null; firmada: boolean;
}

/**
 * Bitácora digital del paciente: se genera sola con cada sesión registrada.
 *
 * Sustituye al "control de citas" que se llenaba a mano. Deja constancia de qué
 * se aplicó, sobre qué áreas y QUIÉN lo hizo: a una misma paciente la pueden
 * atender varias esteticistas según el combo y la técnica de ese día.
 */
function Bitacora({ patientId, recarga = 0 }: { patientId: string; recarga?: number }) {
  const [rows, setRows] = useState<VisitaBitacora[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    api.get<{ bitacora: VisitaBitacora[] }>(`/patients/${patientId}/bitacora`)
      .then((r) => { setRows(r.bitacora); setCargando(false); })
      .catch(() => setCargando(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, recarga]);

  return (
    <div className="mb-4">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="text-[12.5px] font-extrabold uppercase text-navy">Bitácora de citas</span>
        <span className="rounded-full bg-navy-soft px-2 py-0.5 text-[10.5px] font-bold text-muted">automática</span>
      </div>

      {cargando ? (
        <div className="rounded-[11px] border border-line px-3.5 py-3 text-[12.5px] text-muted">Cargando bitácora…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-[11px] border border-dashed border-line px-3.5 py-4 text-[12.5px] text-muted">
          Todavía no hay visitas registradas. Cada vez que registres el procedimiento aplicado
          (arriba, con la firma del paciente), se agrega sola una línea aquí.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[11px] border border-line">
          <div className="min-w-[620px]">
            <div className="grid grid-cols-[46px_86px_1.5fr_1.2fr_1.1fr] gap-2 px-3.5 py-2.5 text-[11px] font-bold uppercase text-navy" style={{ background: 'var(--navy-soft)' }}>
              <div>Cita</div><div>Fecha</div><div>Tratamiento aplicado</div><div>Áreas</div><div>Esteticista</div>
            </div>
            {rows.map((v) => (
              <div key={v.id} className="border-t border-line-2 px-3.5 py-2">
                <div className="grid grid-cols-[46px_86px_1.5fr_1.2fr_1.1fr] items-start gap-2">
                  <div className="text-[13px] font-bold text-muted">{v.numero}</div>
                  <div className="text-[12px]">
                    <div className="font-semibold">{v.fecha}</div>
                    <div className="text-[10.5px] text-faint">{v.hora}</div>
                  </div>
                  <div className="text-[12px]">
                    <div className="font-semibold">{v.tratamiento}</div>
                    {v.techniques.length > 0 && <div className="text-[11px] text-muted">{v.techniques.join(', ')}</div>}
                  </div>
                  <div className="text-[11.5px] text-muted">{v.areas.length ? v.areas.join(', ') : '—'}</div>
                  <div className="flex items-start gap-1 text-[11.5px]">
                    <span className="min-w-0 flex-1 truncate font-semibold">{v.esteticista ?? '—'}</span>
                    {v.firmada && <span className="flex-none text-ok" title="Validado por el paciente">✓</span>}
                  </div>
                </div>
                {v.observaciones && (
                  <div className="mt-1 rounded-[7px] bg-bg px-2.5 py-1.5 text-[11.5px] text-muted">
                    <b className="text-navy">Obs.</b> {v.observaciones}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="mt-1.5 text-[11px] text-faint">
        Se genera con cada sesión firmada. Las observaciones se escriben al registrar el procedimiento.
      </div>
    </div>
  );
}

function Step4({ patientId, treatmentIdCita, tratamiento, setTratamiento, rows, setRows }: {
  patientId: string;
  treatmentIdCita?: string | null;
  tratamiento: string; setTratamiento: (v: string) => void;
  rows: { fecha: string; obs: string }[]; setRows: (v: { fecha: string; obs: string }[]) => void;
}) {
  // Al registrar una sesión, la bitácora se vuelve a leer para incluirla.
  const [recargaBitacora, setRecargaBitacora] = useState(0);

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
      <PlanGuiado patientId={patientId} treatmentIdCita={treatmentIdCita} onPlan={onPlan} onSesion={() => setRecargaBitacora((r) => r + 1)} />
      <Bitacora patientId={patientId} recarga={recargaBitacora} />
      {/* Filas antiguas escritas a mano: se conservan visibles para no perder lo
          que ya se había anotado antes de la bitácora automática. */}
      {rows.some((r) => r.fecha || r.obs) && (
        <div className="mb-4">
          <div className="mb-1.5 text-[11.5px] font-bold text-faint">Anotaciones anteriores (escritas a mano)</div>
          <div className="overflow-hidden rounded-[11px] border border-line">
            {rows.map((r, i) => (r.fecha || r.obs) ? (
              <div key={i} className="grid grid-cols-[50px_1fr_1.6fr] items-center border-b border-line-2 px-3.5 py-1.5 last:border-0">
                <div className="text-[12px] font-bold text-muted">{i + 1}</div>
                <input type="date" value={r.fecha} onChange={(e) => setRow(i, 'fecha', e.target.value)} className="bg-transparent px-1 py-1.5 text-[12px] outline-none" />
                <input value={r.obs} onChange={(e) => setRow(i, 'obs', e.target.value)} className="border-l border-line-2 bg-transparent px-2 py-1.5 text-[12px] outline-none" />
              </div>
            ) : null)}
          </div>
        </div>
      )}
    </div>
  );
}
