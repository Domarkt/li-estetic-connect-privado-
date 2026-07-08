import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { Overlay, stop } from '../../components/Modal';
import { fmtRD, type CatalogItem } from '../../lib/types';

export default function AddServicesModal({ patientId, onClose, onSaved }: { patientId: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [cart, setCart] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<CatalogItem[]>('/catalog').then((all) =>
      setItems(all.filter((i) => i.kind === 'PAQUETE' || i.kind === 'COMBO' || i.kind === 'SERVICIO')),
    );
  }, []);

  const toggle = (id: string) => { const n = new Set(cart); n.has(id) ? n.delete(id) : n.add(id); setCart(n); };

  async function send() {
    if (!cart.size) { toast('Selecciona al menos un servicio'); return; }
    setBusy(true);
    try {
      const r = await api.post<{ message: string }>(`/patients/${patientId}/charges`, { catalogItemIds: [...cart] });
      toast(r.message);
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
      <div onClick={stop} className="flex max-h-[92vh] w-[480px] max-w-full flex-col overflow-hidden rounded-2xl bg-card animate-pop" style={{ boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
        <div className="border-b border-line px-6 py-5">
          <div className="text-base font-extrabold">Agregar paquetes / combos</div>
          <div className="mt-0.5 text-[12.5px] text-muted">Selecciona lo que eligió el paciente · se enviará a recepción para facturar</div>
        </div>
        <div className="flex flex-col gap-2 overflow-y-auto px-6 py-4">
          {items.map((it) => {
            const on = cart.has(it.id);
            return (
              <div key={it.id} onClick={() => toggle(it.id)}
                className="flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3"
                style={{ borderColor: on ? 'var(--magenta)' : 'var(--line)', background: on ? 'var(--magenta-soft)' : 'var(--card)' }}>
                <span className="flex h-5 w-5 items-center justify-center rounded-md text-[11px] font-extrabold text-white" style={{ background: on ? 'var(--magenta)' : 'var(--line)' }}>✓</span>
                <div className="flex-1"><div className="text-[13.5px] font-bold">{it.name}</div><div className="text-[11.5px] capitalize text-muted">{it.kind.toLowerCase()}</div></div>
                <div className="text-[13.5px] font-extrabold text-magenta">{fmtRD(it.price)}</div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-2.5 border-t border-line px-6 py-4">
          <div className="flex-1 text-[12.5px] font-semibold text-muted">{cart.size} seleccionado(s)</div>
          <button onClick={onClose} className="rounded-[10px] border border-line bg-card px-4 py-3 text-[13.5px] font-bold text-muted">Cancelar</button>
          <button onClick={send} disabled={busy} className="rounded-[10px] bg-magenta px-[18px] py-3 text-[13.5px] font-bold text-white disabled:opacity-60">Enviar a recepción →</button>
        </div>
      </div>
    </Overlay>
  );
}
