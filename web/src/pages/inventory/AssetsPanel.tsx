import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { useBranch } from '../../layout/BranchContext';
import { Overlay, stop } from '../../components/Modal';

const CATEGORIES: Record<Kind, string[]> = {
  EQUIPO: ['Láser', 'Dermapen', 'Cavitación', 'Radiofrecuencia', 'Ultracavitación', 'Vacumterapia', 'Computadora', 'Impresora', 'Mobiliario', 'Otro'],
  SUMINISTRO: ['Uniforme', 'Bata', 'Herramienta', 'Flota', 'Utensilio', 'Desechable', 'Lencería', 'Otro'],
};

type Kind = 'EQUIPO' | 'SUMINISTRO';

interface Asset {
  id: string; code: string; kind: Kind; name: string; category: string | null;
  status: string; statusLabel: string; serial: string | null; notes: string | null;
  branch: string; branchId: string; assignedTo: { id: string; name: string } | null;
}
interface UserLite { id: string; name: string; role: string; branchId: string | null }
interface AssetResp { assets: Asset[]; users: UserLite[]; branches: { id: string; name: string }[] }
interface Ev { id: string; type: string; note: string | null; cost: number | null; by: string; date: string }

const STATUS_COLOR: Record<string, string> = {
  OPERATIVO: '#1F9D6B', MANTENIMIENTO: '#C9880E', AVERIADO: '#e11d48', BAJA: '#8a94a6',
};

export default function AssetsPanel({ kind, canManage, branchQ, mine }: { kind: Kind; canManage: boolean; branchQ: string; mine?: boolean }) {
  const { branches: ctxBranches, activeBranch } = useBranch();
  const [data, setData] = useState<AssetResp | null>(null);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<Asset | null | 'new'>(null);
  const [reporting, setReporting] = useState<Asset | null>(null);
  const [history, setHistory] = useState<Asset | null>(null);

  useEffect(() => {
    const q = `?kind=${kind}${mine ? '&mine=1' : ''}${branchQ ? `&${branchQ.replace(/^\?/, '')}` : ''}`;
    api.get<AssetResp>(`/assets${q}`).then(setData).catch(() => setData(null));
  }, [kind, branchQ, mine, reload]);

  const assets = data?.assets ?? [];
  const refresh = () => setReload((n) => n + 1);
  const label = kind === 'EQUIPO' ? 'equipo' : 'suministro';

  // Cuántos hay en cada estética (para la vista "Todas las sucursales").
  const porSucursal = Object.entries(
    assets.reduce<Record<string, number>>((acc, a) => {
      acc[a.branch] = (acc[a.branch] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((x, y) => x[0].localeCompare(y[0]));

  return (
    <div>
      {canManage && (
        <div className="mb-3 flex justify-end">
          <button onClick={() => setEditing('new')} className="flex items-center gap-1.5 rounded-[10px] bg-magenta px-[18px] py-2.5 text-[13.5px] font-bold text-white"><span className="text-base">+</span> Agregar {label}</button>
        </div>
      )}

      {/* Cuántos hay en cada estética. Cada equipo es una ficha propia con su
          código (EQ-0001, EQ-0002…), así que dos computadoras iguales en
          sucursales distintas son dos registros separados, no una cantidad. */}
      {porSucursal.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[11px] border border-line bg-card px-4 py-3">
          <span className="text-[12.5px] font-bold text-muted">Total {assets.length} · por estética:</span>
          {porSucursal.map(([suc, n]) => (
            <span key={suc} className="rounded-full bg-bg px-2.5 py-1 text-[11.5px] font-bold text-navy">
              {suc}: {n}
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {assets.map((a) => (
          <div key={a.id} className="rounded-base border border-line bg-card p-4 shadow-card">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div>
                <div className="text-[11px] font-bold text-faint">{a.code}</div>
                <div className="text-sm font-bold leading-tight">{a.name}</div>
                {a.category && <div className="text-[11.5px] text-muted">{a.category}</div>}
              </div>
              <span className="rounded-full px-2.5 py-1 text-[11px] font-bold text-white" style={{ background: STATUS_COLOR[a.status] ?? '#8a94a6' }}>{a.statusLabel}</span>
            </div>
            <div className="mb-3 space-y-0.5 text-[12px] text-muted">
              {a.assignedTo && <div>Asignado a: <b className="text-text">{a.assignedTo.name}</b></div>}
              {a.serial && <div>Serie: {a.serial}</div>}
              <div>Sucursal: {a.branch}</div>
            </div>
            <div className="flex flex-wrap gap-1.5 border-t border-line pt-2.5">
              <button onClick={() => setReporting(a)} className="rounded-lg bg-rose-50 px-2.5 py-1.5 text-[12px] font-bold text-rose-600">Reportar</button>
              <button onClick={() => setHistory(a)} className="rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[12px] font-bold text-muted">Historial</button>
              {canManage && <button onClick={() => setEditing(a)} className="rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[12px] font-bold text-muted">Editar</button>}
            </div>
          </div>
        ))}
        {assets.length === 0 && <div className="col-span-full py-10 text-center text-sm text-muted">Sin {label}s registrados.</div>}
      </div>

      {editing && (
        <AssetModal
          kind={kind}
          asset={editing === 'new' ? null : editing}
          users={data?.users ?? []}
          branches={(data?.branches?.length ? data.branches : ctxBranches.map((b) => ({ id: b.id, name: b.name })))}
          defaultBranchId={activeBranch !== 'all' ? activeBranch : ''}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
      {reporting && <EventModal asset={reporting} canManage={canManage} onClose={() => setReporting(null)} onSaved={refresh} />}
      {history && <HistoryModal asset={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

function AssetModal({ kind, asset, users, branches, defaultBranchId, onClose, onSaved }: {
  kind: Kind; asset: Asset | null; users: UserLite[]; branches: { id: string; name: string }[];
  defaultBranchId: string; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const isSupply = kind === 'SUMINISTRO';
  const [name, setName] = useState(asset?.name ?? '');
  const [category, setCategory] = useState(asset?.category ?? '');
  const [branchId, setBranchId] = useState(asset?.branchId ?? defaultBranchId ?? (branches[0]?.id ?? ''));
  const [assignedToId, setAssignedToId] = useState(asset?.assignedTo?.id ?? '');
  const [serial, setSerial] = useState(asset?.serial ?? '');
  const [notes, setNotes] = useState(asset?.notes ?? '');
  const [status, setStatus] = useState(asset?.status ?? 'OPERATIVO');
  const [busy, setBusy] = useState(false);

  // Personal elegible para asignar (por sucursal seleccionada; admin puede en cualquiera).
  const staff = users.filter((u) => u.role !== 'ADMIN' && (!branchId || u.branchId === branchId));

  // Suministro: la sucursal se toma del personal asignado (o la sucursal por defecto).
  function pickPerson(id: string) {
    setAssignedToId(id);
    if (isSupply && id) {
      const u = users.find((x) => x.id === id);
      if (u?.branchId) setBranchId(u.branchId);
    }
  }

  async function save() {
    if (!name.trim()) { toast('El nombre es requerido'); return; }
    // Sucursal efectiva: la elegida, o (en suministros) la del personal, o la por defecto.
    const effBranch = branchId || (isSupply ? users.find((u) => u.id === assignedToId)?.branchId : '') || defaultBranchId || branches[0]?.id || '';
    if (!asset && !effBranch) { toast(isSupply ? 'Asigna a un miembro o elige una sucursal' : 'Selecciona una sucursal'); return; }
    setBusy(true);
    const payload = {
      kind, name: name.trim(), category: category.trim() || undefined, branchId: effBranch,
      assignedToId: assignedToId || undefined, serial: serial.trim() || undefined,
      notes: notes.trim() || undefined, ...(asset ? { status } : {}),
    };
    try {
      if (asset) await api.patch(`/assets/${asset.id}`, payload);
      else await api.post('/assets', payload);
      toast(asset ? 'Activo actualizado' : 'Activo creado');
      onSaved(); onClose();
    } catch (e) { toast(e instanceof Error ? e.message : 'Error'); } finally { setBusy(false); }
  }

  const listId = `cat-${kind}`;

  return (
    <Overlay onClose={onClose} z={120}>
      <div onClick={stop} className="max-h-[88vh] w-[460px] max-w-full overflow-y-auto rounded-2xl bg-card animate-pop" style={{ boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
        <div className="flex items-center border-b border-line px-6 py-5"><div className="flex-1 text-base font-extrabold">{asset ? 'Editar' : 'Agregar'} {isSupply ? 'suministro' : 'equipo'}</div><button onClick={onClose} className="h-8 w-8 rounded-lg bg-bg text-muted">×</button></div>
        <div className="flex flex-col gap-3.5 px-6 py-5">
          {!asset && (
            <div className="rounded-[9px] bg-magenta-soft px-3 py-2 text-[12px] font-semibold text-magenta">El ID se asigna automáticamente: {isSupply ? 'SU' : 'EQ'}-0001, {isSupply ? 'SU' : 'EQ'}-0002…</div>
          )}
          {asset && <div className="text-[12px] font-bold text-faint">ID: {asset.code}</div>}
          <Field label="Nombre"><input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder={isSupply ? 'Ej. Uniforme talla M' : 'Ej. Láser diodo'} /></Field>
          <Field label="Categoría">
            <input className="inp" list={listId} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Elige o escribe una categoría" />
            <datalist id={listId}>{CATEGORIES[kind].map((c) => <option key={c} value={c} />)}</datalist>
          </Field>

          {/* Suministro: se asigna a una persona (y de ahí sale su sucursal). Equipo: sucursal + persona opcional. */}
          {isSupply ? (
            <>
              <Field label="Asignar a (personal)">
                <select className="inp" value={assignedToId} onChange={(e) => pickPerson(e.target.value)}>
                  <option value="">— Sin asignar —</option>
                  {users.filter((u) => u.role !== 'ADMIN').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </Field>
              {!assignedToId && (
                <Field label="Sucursal (si no lo asignas a alguien)"><select className="inp" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                  <option value="">— Selecciona —</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select></Field>
              )}
            </>
          ) : (
            <>
              <Field label="Sucursal"><select className="inp" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">— Selecciona —</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select></Field>
              <Field label="Asignar a (opcional)"><select className="inp" value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)}>
                <option value="">— Sin asignar —</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select></Field>
            </>
          )}

          <div className="flex gap-3">
            <Field label="Serie / No. (opcional)" className="flex-1"><input className="inp" value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="desechables: dejar vacío" /></Field>
            {asset && <Field label="Estado" className="flex-1"><select className="inp" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="OPERATIVO">Operativo</option><option value="MANTENIMIENTO">En mantenimiento</option><option value="AVERIADO">Averiado</option><option value="BAJA">Dar de baja</option>
            </select></Field>}
          </div>
          <Field label="Notas"><input className="inp" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="opcional" /></Field>
        </div>
        <div className="flex gap-2.5 border-t border-line px-6 py-4">
          <button onClick={onClose} className="flex-1 rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">Cancelar</button>
          <button onClick={save} disabled={busy} className="flex-[2] rounded-[10px] bg-magenta py-3 text-[13.5px] font-bold text-white disabled:opacity-60">Guardar</button>
        </div>
      </div>
    </Overlay>
  );
}

function EventModal({ asset, canManage, onClose, onSaved }: { asset: Asset; canManage: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const staffTypes = [{ k: 'AVERIA', l: 'Avería' }, { k: 'INCIDENTE', l: 'Incidente' }, { k: 'NOTA', l: 'Nota' }];
  const adminExtra = [{ k: 'MANTENIMIENTO', l: 'Mantenimiento' }, { k: 'ENTRADA', l: 'Entrada' }, { k: 'SALIDA', l: 'Salida' }];
  const types = canManage ? [...staffTypes, ...adminExtra] : staffTypes;
  const [type, setType] = useState(types[0].k);
  const [note, setNote] = useState('');
  const [cost, setCost] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.post(`/assets/${asset.id}/event`, { type, note: note.trim() || undefined, cost: cost ? Number(cost) : undefined });
      toast(canManage ? 'Registrado en el historial' : 'Reporte enviado al administrador');
      onSaved(); onClose();
    } catch (e) { toast(e instanceof Error ? e.message : 'Error'); } finally { setBusy(false); }
  }

  return (
    <Overlay onClose={onClose} z={121}>
      <div onClick={stop} className="w-[440px] max-w-full overflow-hidden rounded-2xl bg-card animate-pop" style={{ boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
        <div className="border-b border-line px-6 py-5"><div className="text-base font-extrabold">{asset.code} · {asset.name}</div><div className="text-[12px] text-muted">Registrar en el historial</div></div>
        <div className="flex flex-col gap-3.5 px-6 py-5">
          <Field label="Tipo"><select className="inp" value={type} onChange={(e) => setType(e.target.value)}>{types.map((t) => <option key={t.k} value={t.k}>{t.l}</option>)}</select></Field>
          <Field label="Descripción"><textarea className="inp min-h-[70px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Qué ocurrió / detalle" /></Field>
          {canManage && type === 'MANTENIMIENTO' && <Field label="Costo (RD$)"><input className="inp" value={cost} onChange={(e) => setCost(e.target.value.replace(/\D/g, ''))} placeholder="opcional" /></Field>}
        </div>
        <div className="flex gap-2.5 border-t border-line px-6 py-4">
          <button onClick={onClose} className="flex-1 rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">Cancelar</button>
          <button onClick={save} disabled={busy} className="flex-[2] rounded-[10px] bg-magenta py-3 text-[13.5px] font-bold text-white disabled:opacity-60">{canManage ? 'Registrar' : 'Enviar reporte'}</button>
        </div>
      </div>
    </Overlay>
  );
}

function HistoryModal({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const [events, setEvents] = useState<Ev[] | null>(null);
  useEffect(() => { api.get<Ev[]>(`/assets/${asset.id}/events`).then(setEvents).catch(() => setEvents([])); }, [asset.id]);
  const TYPE_LABEL: Record<string, string> = { ENTRADA: 'Entrada', SALIDA: 'Salida', MANTENIMIENTO: 'Mantenimiento', AVERIA: 'Avería', INCIDENTE: 'Incidente', NOTA: 'Nota', BAJA: 'Baja' };
  return (
    <Overlay onClose={onClose} z={121}>
      <div onClick={stop} className="max-h-[85vh] w-[480px] max-w-full overflow-hidden rounded-2xl bg-card animate-pop" style={{ boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
        <div className="flex items-center border-b border-line px-6 py-5"><div className="flex-1"><div className="text-base font-extrabold">Historial · {asset.code}</div><div className="text-[12px] text-muted">{asset.name}</div></div><button onClick={onClose} className="h-8 w-8 rounded-lg bg-bg text-muted">×</button></div>
        <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
          {events === null && <div className="py-6 text-center text-sm text-muted">Cargando…</div>}
          {events && events.length === 0 && <div className="py-6 text-center text-sm text-muted">Sin movimientos.</div>}
          {events?.map((e) => (
            <div key={e.id} className="border-b border-line py-3 last:border-0">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-bold">{TYPE_LABEL[e.type] ?? e.type}</span>
                <span className="text-[11.5px] text-faint">{e.date}</span>
              </div>
              {e.note && <div className="mt-0.5 text-[12.5px] text-muted">{e.note}</div>}
              <div className="mt-0.5 text-[11.5px] text-faint">{e.by}{e.cost ? ` · RD$${e.cost.toLocaleString('en-US')}` : ''}</div>
            </div>
          ))}
        </div>
        <div className="border-t border-line px-6 py-4"><button onClick={onClose} className="w-full rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">Cerrar</button></div>
      </div>
    </Overlay>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`flex flex-col gap-1.5 ${className ?? ''}`}><span className="text-xs font-bold text-muted">{label}</span>{children}</label>;
}
