import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Overlay, stop } from '../components/Modal';
import { fmtRD, type CatalogItem, type CatalogKind } from '../lib/types';

const TABS: { key: CatalogKind; label: string }[] = [
  { key: 'SERVICIO', label: 'Servicios' },
  { key: 'PAQUETE', label: 'Paquetes' },
  { key: 'COMBO', label: 'Combos' },
  { key: 'PRODUCTO', label: 'Productos' },
  { key: 'INSUMO', label: 'Insumos' },
];

const STOCKABLE = (k: CatalogKind) => k === 'PRODUCTO' || k === 'INSUMO';

export default function CatalogPage() {
  const { staff } = useAuth();
  const isAdmin = staff?.role === 'ADMIN';
  const [tab, setTab] = useState<CatalogKind>('SERVICIO');
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [modal, setModal] = useState<{ mode: 'add' | 'edit'; item?: CatalogItem } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    api.get<CatalogItem[]>('/catalog').then(setItems).catch(() => setItems([]));
  }, [reload]);

  const shown = items.filter((i) => i.kind === tab);
  const refresh = () => setReload((r) => r + 1);

  return (
    <div className="animate-fade">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => {
            const on = tab === t.key;
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                className="rounded-[10px] px-4 py-2 text-[13px] font-bold transition"
                style={{ background: on ? 'var(--magenta)' : 'var(--card)', color: on ? '#fff' : 'var(--muted)', border: `1px solid ${on ? 'var(--magenta)' : 'var(--line)'}` }}>
                {t.label}
              </button>
            );
          })}
        </div>
        {isAdmin && (
          <button onClick={() => setModal({ mode: 'add' })} className="flex items-center gap-1.5 rounded-[10px] bg-magenta px-[18px] py-2.5 text-[13.5px] font-bold text-white"><span className="text-base">+</span> Agregar</button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((it) => (
          <div key={it.id} className="group relative rounded-base border border-line bg-card p-[18px] shadow-card">
            <div className="mb-3 flex items-start justify-between gap-2.5">
              <div className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[11px] bg-magenta-soft text-lg text-magenta">✦</div>
              <span className="rounded-full bg-bg px-2.5 py-1 text-[11px] font-bold text-muted">
                {STOCKABLE(it.kind) ? (it.unit ? `Por ${it.unit}` : 'Inventariable') : it.category ?? it.tag ?? `${it.sessions} ses`}
              </span>
            </div>
            <div className="mb-1.5 text-sm font-bold leading-tight">{it.name}</div>
            <div className="mb-3 text-xs text-faint">{it.kind === 'INSUMO' ? 'Insumo operativo' : it.sessions > 1 ? `${it.sessions} sesiones` : it.tag || '1 sesión'}</div>
            <div className="text-[19px] font-extrabold text-magenta">{it.kind === 'INSUMO' && !it.price ? '—' : fmtRD(it.price)}</div>

            {isAdmin && (
              <div className="mt-3 flex gap-2 border-t border-line pt-3">
                <button onClick={() => setModal({ mode: 'edit', item: it })} className="flex-1 rounded-lg border border-line bg-bg py-2 text-[12px] font-bold text-muted hover:text-text">Editar</button>
                <DeleteButton item={it} onDone={refresh} />
              </div>
            )}
          </div>
        ))}
        {shown.length === 0 && <div className="col-span-full py-10 text-center text-sm text-muted">Sin ítems en esta categoría.</div>}
      </div>

      {modal && (
        <CatalogModal
          mode={modal.mode}
          item={modal.item}
          defaultKind={tab}
          onClose={() => setModal(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

function DeleteButton({ item, onDone }: { item: CatalogItem; onDone: () => void }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function del() {
    setBusy(true);
    try {
      await api.del(`/catalog/${item.id}`);
      toast('Elemento eliminado');
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  if (!confirm) {
    return <button onClick={() => setConfirm(true)} className="flex-1 rounded-lg border border-line bg-bg py-2 text-[12px] font-bold text-rose-500 hover:bg-rose-50">Eliminar</button>;
  }
  return (
    <div className="flex flex-1 gap-1.5">
      <button onClick={() => setConfirm(false)} className="flex-1 rounded-lg border border-line bg-bg py-2 text-[11px] font-bold text-muted">No</button>
      <button onClick={del} disabled={busy} className="flex-1 rounded-lg bg-rose-500 py-2 text-[11px] font-bold text-white disabled:opacity-60">Sí, borrar</button>
    </div>
  );
}

function CatalogModal({ mode, item, defaultKind, onClose, onSaved }: {
  mode: 'add' | 'edit';
  item?: CatalogItem;
  defaultKind: CatalogKind;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [kind, setKind] = useState<CatalogKind>(item?.kind ?? defaultKind);
  const [name, setName] = useState(item?.name ?? '');
  const [price, setPrice] = useState(item?.price != null ? String(item.price) : '');
  const [sessions, setSessions] = useState(item?.sessions ? String(item.sessions) : '1');
  const [unit, setUnit] = useState(item?.unit ?? '');
  const [busy, setBusy] = useState(false);
  const stockable = STOCKABLE(kind);

  async function save() {
    if (!name.trim()) { toast('El nombre es requerido'); return; }
    if (!stockable && !price) { toast('El precio es requerido'); return; }
    setBusy(true);
    const payload = {
      kind, name: name.trim(),
      price: Number(price) || 0,
      sessions: Number(sessions) || 1,
      unit: stockable ? (unit.trim() || undefined) : undefined,
    };
    try {
      if (mode === 'edit' && item) {
        await api.patch(`/catalog/${item.id}`, payload);
        toast('Cambios guardados');
      } else {
        await api.post('/catalog', payload);
        toast('Agregado al catálogo');
      }
      onSaved();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay onClose={onClose} z={120}>
      <div onClick={stop} className="w-[460px] max-w-full overflow-hidden rounded-2xl bg-card animate-pop" style={{ boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
        <div className="flex items-center border-b border-line px-6 py-5"><div className="flex-1 text-base font-extrabold">{mode === 'edit' ? 'Editar ítem' : 'Agregar al catálogo'}</div><button onClick={onClose} className="h-8 w-8 rounded-lg bg-bg text-muted">×</button></div>
        <div className="flex flex-col gap-3.5 px-6 py-5">
          <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Tipo</span>
            <select className="rounded-[9px] border border-line bg-card px-3.5 py-3 text-[13.5px]" value={kind} onChange={(e) => setKind(e.target.value as CatalogKind)}>
              <option value="SERVICIO">Servicio</option><option value="PAQUETE">Paquete</option><option value="COMBO">Combo</option><option value="PRODUCTO">Producto</option><option value="INSUMO">Insumo operativo</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Nombre</span><input className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'INSUMO' ? 'Ej. Toallas / Papel de baño' : 'Ej. Radiofrecuencia facial'} /></label>
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1.5"><span className="text-xs font-bold text-muted">{kind === 'INSUMO' ? 'Costo (opcional)' : 'Precio (RD$)'}</span><input className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} placeholder={kind === 'INSUMO' ? '0' : '4000'} /></label>
            {stockable ? (
              <label className="flex flex-1 flex-col gap-1.5"><span className="text-xs font-bold text-muted">Unidad</span><input className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="unidad, rollo, litro…" /></label>
            ) : (
              <label className="flex flex-1 flex-col gap-1.5"><span className="text-xs font-bold text-muted">Sesiones</span><input className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" value={sessions} onChange={(e) => setSessions(e.target.value.replace(/\D/g, ''))} placeholder="1" /></label>
            )}
          </div>
          {stockable && <p className="text-[11.5px] text-faint">El stock se controla por sucursal en la pestaña <b>Inventario</b>.</p>}
        </div>
        <div className="flex gap-2.5 border-t border-line px-6 py-4">
          <button onClick={onClose} className="flex-1 rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">Cancelar</button>
          <button onClick={save} disabled={busy} className="flex-[2] rounded-[10px] bg-magenta py-3 text-[13.5px] font-bold text-white disabled:opacity-60">Guardar</button>
        </div>
      </div>
    </Overlay>
  );
}
