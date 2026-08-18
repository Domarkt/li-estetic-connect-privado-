import { useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { useBranch } from '../../layout/BranchContext';
import { useToast } from '../../components/Toast';
import { Overlay, stop } from '../../components/Modal';
import type { PatientRow } from '../../lib/types';

/** "Nuevo paciente": crea el paciente y abre directamente la ficha (Paso 1). */
export default function NewPatientModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: PatientRow) => void }) {
  const { staff } = useAuth();
  const { branches } = useBranch();
  const toast = useToast();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [sector, setSector] = useState('');
  const [province, setProvince] = useState('');
  const [branchId, setBranchId] = useState(staff?.role === 'ADMIN' ? (branches[0]?.id ?? '') : (staff?.branchId ?? ''));
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim() || !phone.trim()) { toast('Nombre y celular requeridos'); return; }
    setBusy(true);
    try {
      const p = await api.post<PatientRow>('/patients', {
        name: name.trim(), phone: phone.trim(),
        address: address.trim() || undefined,
        sector: sector.trim() || undefined,
        province: province.trim() || undefined,
        branchId: staff?.role === 'ADMIN' ? branchId : undefined,
      });
      onCreated(p);
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al crear');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay onClose={onClose} z={115}>
      <div onClick={stop} className="w-[460px] max-w-full overflow-hidden rounded-2xl bg-card animate-pop" style={{ boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
        <div className="flex items-center border-b border-line px-6 py-5"><div className="flex-1 text-base font-extrabold">Nuevo paciente</div><button onClick={onClose} className="h-8 w-8 rounded-lg bg-bg text-muted">×</button></div>
        <div className="flex flex-col gap-3.5 px-6 py-5">
          <p className="text-[12.5px] text-muted">Al crear el paciente se abrirá su ficha clínica para completar el Paso 1.</p>
          <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Nombre completo</span><input className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre y apellidos" /></label>
          <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Celular</span><input className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="809-000-0000" /></label>

          {/* Dirección seccionada: se captura aquí para que no se salte (antes solo salía
              en la ficha, después de agendar). Sector y provincia por separado. */}
          <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Dirección <span className="font-semibold text-faint">(calle y número)</span></span><input className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="C/ Duarte #12" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Sector</span><input className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" value={sector} onChange={(e) => setSector(e.target.value)} placeholder="Villa Verde" /></label>
            <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Provincia</span>
              <input className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" list="prov-do-new" value={province} onChange={(e) => setProvince(e.target.value)} placeholder="La Romana" />
              <datalist id="prov-do-new">{['Distrito Nacional','Santo Domingo','Santiago','La Romana','La Altagracia','San Pedro de Macorís','La Vega','Puerto Plata','Duarte','San Cristóbal','Espaillat','Azua','Barahona','Monseñor Nouel','Peravia','Hermanas Mirabal','Monte Plata','Sánchez Ramírez','María Trinidad Sánchez','Samaná','Valverde','Montecristi','Hato Mayor','El Seibo','San Juan','Baoruco','Independencia','Pedernales','Elías Piña','Santiago Rodríguez','Dajabón','San José de Ocoa'].map((pr) => <option key={pr} value={pr} />)}</datalist>
            </label>
          </div>
          <p className="text-[11.5px] text-faint">El sexo y demás datos se completan en el Paso 1 de la ficha.</p>
          {staff?.role === 'ADMIN' && (
            <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Sucursal</span>
              <select className="rounded-[9px] border border-line bg-card px-3.5 py-3 text-[13.5px]" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
          )}
        </div>
        <div className="flex gap-2.5 border-t border-line px-6 py-4">
          <button onClick={onClose} className="flex-1 rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">Cancelar</button>
          <button onClick={save} disabled={busy} className="flex-[2] rounded-[10px] bg-magenta py-3 text-[13.5px] font-bold text-white disabled:opacity-60">Crear y abrir ficha</button>
        </div>
      </div>
    </Overlay>
  );
}
