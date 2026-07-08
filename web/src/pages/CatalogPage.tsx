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
];

export default function CatalogPage() {
  const { staff } = useAuth();
  const [tab, setTab] = useState<CatalogKind>('SERVICIO');
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    api.get<CatalogItem[]>('/catalog').then(setItems).catch(() => setItems([]));
  }, [reload]);

  const shown = items.filter((i) => i.kind === tab);

  return (
    <div className="animate-fade">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex gap-2">
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
        {staff?.role === 'ADMIN' && (
          <button onClick={() => setAddOpen(true)} className="flex items-center gap-1.5 rounded-[10px] bg-magenta px-[18px] py-2.5 text-[13.5px] font-bold text-white"><span className="text-base">+</span> Agregar</button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((it) => (
          <div key={it.id} className="rounded-base border border-line bg-card p-[18px] shadow-card">
            <div className="mb-3 flex items-start justify-between gap-2.5">
              <div className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[11px] bg-magenta-soft text-lg text-magenta">✦</div>
              <span className="rounded-full bg-bg px-2.5 py-1 text-[11px] font-bold text-muted">{it.category ?? it.tag ?? (it.stock != null ? `Stock ${it.stock}` : `${it.sessions} ses`)}</span>
            </div>
            <div className="mb-1.5 text-sm font-bold leading-tight">{it.name}</div>
            <div className="mb-3 text-xs text-faint">{it.sessions > 1 ? `${it.sessions} sesiones` : it.tag || '1 sesión'}</div>
            <div className="text-[19px] font-extrabold text-magenta">{fmtRD(it.price)}</div>
          </div>
        ))}
        {shown.length === 0 && <div className="col-span-full py-10 text-center text-sm text-muted">Sin ítems en esta categoría.</div>}
      </div>

      {addOpen && <AddCatalogModal onClose={() => setAddOpen(false)} onSaved={() => setReload((r) => r + 1)} />}
    </div>
  );
}

function AddCatalogModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<CatalogKind>('SERVICIO');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [sessions, setSessions] = useState('1');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim() || !price) { toast('Nombre y precio requeridos'); return; }
    setBusy(true);
    try {
      await api.post('/catalog', { kind, name: name.trim(), price: Number(price), sessions: Number(sessions) || 1 });
      toast('Elemento agregado al catálogo');
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
        <div className="flex items-center border-b border-line px-6 py-5"><div className="flex-1 text-base font-extrabold">Agregar al catálogo</div><button onClick={onClose} className="h-8 w-8 rounded-lg bg-bg text-muted">×</button></div>
        <div className="flex flex-col gap-3.5 px-6 py-5">
          <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Tipo</span>
            <select className="rounded-[9px] border border-line bg-card px-3.5 py-3 text-[13.5px]" value={kind} onChange={(e) => setKind(e.target.value as CatalogKind)}>
              <option value="SERVICIO">Servicio</option><option value="PAQUETE">Paquete</option><option value="COMBO">Combo</option><option value="PRODUCTO">Producto</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Nombre</span><input className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Radiofrecuencia facial" /></label>
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1.5"><span className="text-xs font-bold text-muted">Precio (RD$)</span><input className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="4000" /></label>
            <label className="flex flex-1 flex-col gap-1.5"><span className="text-xs font-bold text-muted">Sesiones</span><input className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" value={sessions} onChange={(e) => setSessions(e.target.value)} placeholder="1" /></label>
          </div>
        </div>
        <div className="flex gap-2.5 border-t border-line px-6 py-4">
          <button onClick={onClose} className="flex-1 rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">Cancelar</button>
          <button onClick={save} disabled={busy} className="flex-[2] rounded-[10px] bg-magenta py-3 text-[13.5px] font-bold text-white disabled:opacity-60">Guardar</button>
        </div>
      </div>
    </Overlay>
  );
}
