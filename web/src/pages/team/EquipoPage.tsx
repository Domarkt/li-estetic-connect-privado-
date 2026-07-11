import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useBranch } from '../../layout/BranchContext';
import { useToast } from '../../components/Toast';
import { Overlay, stop } from '../../components/Modal';
import { fmtRD, type Role, type SystemUser, type TeamResponse } from '../../lib/types';

const initials = (n: string) => n.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const roleChip = 'rounded-full bg-magenta-soft px-2.5 py-0.5 text-[11.5px] font-bold text-magenta';

export default function EquipoPage() {
  const [data, setData] = useState<TeamResponse>({ collaborators: [], systemUsers: [] });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SystemUser | null>(null);
  const toast = useToast();

  const load = useCallback(() => { api.get<TeamResponse>('/users/team').then(setData).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  async function removeUser(u: SystemUser) {
    if (!window.confirm(`¿Eliminar a ${u.name}? Esta acción no se puede deshacer.`)) return;
    try {
      const r = await api.del<{ message: string }>(`/users/${u.id}`);
      toast(r.message);
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al eliminar');
    }
  }

  return (
    <div className="flex animate-fade flex-col gap-[18px]">
      <div className="flex items-center justify-between">
        <div className="text-base font-extrabold">Colaboradoras · desempeño</div>
        <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 rounded-[10px] bg-magenta px-[18px] py-2.5 text-[13.5px] font-bold text-white"><span className="text-base">+</span> Agregar colaborador</button>
      </div>

      <div className="overflow-hidden rounded-base border border-line bg-card shadow-card">
        <div className="grid grid-cols-[2fr_1.4fr_1fr_1.2fr_1.2fr_.9fr] gap-3 border-b border-line px-5 py-3 text-[11.5px] font-bold uppercase tracking-wide text-muted">
          <div>Colaboradora</div><div>Sucursal</div><div>Puntos</div><div>Ventas mes</div><div>Comisión</div><div>Asist.</div>
        </div>
        {data.collaborators.map((e) => (
          <div key={e.id} className="grid grid-cols-[2fr_1.4fr_1fr_1.2fr_1.2fr_.9fr] items-center gap-3 border-b border-line-2 px-5 py-3.5">
            <div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-bold text-white" style={{ background: e.avatarColor }}>{initials(e.name)}</div><div><div className="text-[13.5px] font-bold">{e.name}</div><div className="text-xs text-muted">{e.role}</div></div></div>
            <div className="text-[13px] text-muted">{e.branch}</div>
            <div className="text-[13.5px] font-extrabold text-magenta">{e.points}</div>
            <div className="text-[13px] font-semibold">{fmtRD(e.sales)}</div>
            <div className="text-[13px] font-extrabold">{fmtRD(e.commission)}</div>
            <div className="text-[13px] font-bold text-ok">{e.attendance}</div>
          </div>
        ))}
        {data.collaborators.length === 0 && <div className="px-5 py-8 text-center text-sm text-muted">Sin colaboradoras.</div>}
      </div>

      <div className="mt-1 text-base font-extrabold">Usuarios del sistema</div>
      <div className="overflow-hidden rounded-base border border-line bg-card shadow-card">
        {data.systemUsers.map((u) => (
          <div key={u.id} className="flex items-center gap-3 border-b border-line-2 px-5 py-3.5">
            <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full text-[12px] font-bold text-white" style={{ background: u.avatarColor }}>{initials(u.name)}</div>
            <div className="flex-1"><div className="text-[13.5px] font-bold">{u.name}</div><div className="text-xs text-muted">{u.email}</div></div>
            <span className="text-xs font-semibold text-muted">{u.branch}</span>
            <span className={roleChip}>{u.role}</span>
            {!u.active && <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-bold text-danger">Inactivo</span>}
            <div className="flex items-center gap-1.5">
              <button onClick={() => setEditing(u)} className="rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[12px] font-bold text-muted hover:text-magenta hover:border-magenta">Editar</button>
              <button onClick={() => removeUser(u)} className="rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[12px] font-bold text-muted hover:text-danger hover:border-danger">Eliminar</button>
            </div>
          </div>
        ))}
      </div>

      {open && <CollaboratorModal onClose={() => setOpen(false)} onSaved={load} />}
      {editing && <CollaboratorModal user={editing} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}

function CollaboratorModal({ user, onClose, onSaved }: { user?: SystemUser; onClose: () => void; onSaved: () => void }) {
  const { branches } = useBranch();
  const toast = useToast();
  const isEdit = !!user;
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>(user?.roleKey ?? 'RECEPCIONISTA');
  const [branchId, setBranchId] = useState(user?.branchId ?? branches[0]?.id ?? '');
  const [active, setActive] = useState(user?.active ?? true);
  const [busy, setBusy] = useState(false);

  function genPassword() { setPassword('Li' + Math.random().toString(36).slice(2, 8) + '!'); }

  async function save() {
    if (!name.trim() || !email.trim()) { toast('Nombre y correo requeridos'); return; }
    if (!isEdit && !password.trim()) { toast('Asigna una contraseña'); return; }
    setBusy(true);
    try {
      if (isEdit) {
        const r = await api.patch<{ message: string }>(`/users/${user!.id}`, {
          name: name.trim(), email: email.trim(), role, active,
          branchId: role === 'ADMIN' ? null : branchId,
          ...(password.trim() ? { password } : {}),
        });
        toast(r.message);
      } else {
        const r = await api.post<{ message: string }>('/users', {
          name: name.trim(), email: email.trim(), password, role,
          branchId: role === 'ADMIN' ? undefined : branchId,
        });
        toast(r.message);
      }
      onSaved();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al guardar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay onClose={onClose} z={120}>
      <div onClick={stop} className="w-[460px] max-w-full overflow-hidden rounded-2xl bg-card animate-pop" style={{ boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
        <div className="flex items-center border-b border-line px-6 py-5"><div className="flex-1 text-base font-extrabold">{isEdit ? 'Editar colaborador' : 'Agregar colaborador'}</div><button onClick={onClose} className="h-8 w-8 rounded-lg bg-bg text-muted">×</button></div>
        <div className="flex flex-col gap-3.5 px-6 py-5">
          <p className="text-[12.5px] text-muted">{isEdit ? 'Actualiza cualquier dato. Deja la contraseña vacía para no cambiarla.' : 'El colaborador recibirá estas credenciales para iniciar sesión en el sistema.'}</p>
          <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Nombre completo</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre y apellidos" className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" /></label>
          <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Correo (usuario de acceso)</span><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@liestetic.do" className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" /></label>
          <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">{isEdit ? 'Nueva contraseña (opcional)' : 'Contraseña'}</span>
            <div className="flex gap-2">
              <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder={isEdit ? 'Dejar vacío = sin cambios' : 'Mínimo 6 caracteres'} className="flex-1 rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" />
              <button onClick={genPassword} type="button" className="rounded-[9px] border border-line bg-bg px-3 text-[12px] font-bold text-muted">Generar</button>
            </div>
          </label>
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1.5"><span className="text-xs font-bold text-muted">Rol</span>
              <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="rounded-[9px] border border-line bg-card px-3.5 py-3 text-[13.5px]">
                <option value="RECEPCIONISTA">Recepcionista</option><option value="ESTETICISTA">Esteticista</option><option value="ADMIN">Administradora</option>
              </select>
            </label>
            {role !== 'ADMIN' && (
              <label className="flex flex-1 flex-col gap-1.5"><span className="text-xs font-bold text-muted">Sucursal</span>
                <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="rounded-[9px] border border-line bg-card px-3.5 py-3 text-[13.5px]">
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
            )}
          </div>
          {isEdit && (
            <label className="flex items-center gap-2.5 rounded-[9px] border border-line px-3.5 py-3">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 accent-magenta" />
              <span className="text-[13px] font-semibold">Usuario activo (puede iniciar sesión)</span>
            </label>
          )}
        </div>
        <div className="flex gap-2.5 border-t border-line px-6 py-4">
          <button onClick={onClose} className="flex-1 rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">Cancelar</button>
          <button onClick={save} disabled={busy} className="flex-[2] rounded-[10px] bg-magenta py-3 text-[13.5px] font-bold text-white disabled:opacity-60">{isEdit ? 'Guardar cambios' : 'Crear colaborador'}</button>
        </div>
      </div>
    </Overlay>
  );
}
