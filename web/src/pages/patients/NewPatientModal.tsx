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
  const [branchId, setBranchId] = useState(staff?.role === 'ADMIN' ? (branches[0]?.id ?? '') : (staff?.branchId ?? ''));
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim() || !phone.trim()) { toast('Nombre y celular requeridos'); return; }
    setBusy(true);
    try {
      const p = await api.post<PatientRow>('/patients', {
        name: name.trim(), phone: phone.trim(),
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
