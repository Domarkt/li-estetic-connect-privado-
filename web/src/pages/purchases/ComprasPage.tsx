import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAutoRefresh } from '../../lib/useAutoRefresh';
import { Cargando, ErrorCarga } from '../../components/EstadoCarga';
import { useAuth } from '../../auth/AuthContext';
import { useBranch } from '../../layout/BranchContext';
import { useToast } from '../../components/Toast';
import { Overlay, stop } from '../../components/Modal';
import { fmtRD } from '../../lib/types';

interface Purchase {
  id: string; branchId: string; branch: string;
  supplier: string; concept: string; category: string | null;
  amount: number; ncf: string | null; date: string; purchasedAt: string;
  hasInvoice: boolean; notes: string | null;
}
interface ComprasResponse { month: string; total: number; branches: { id: string; name: string }[]; purchases: Purchase[] }

const CATEGORIAS = ['Insumos', 'Equipos', 'Servicios', 'Alquiler', 'Publicidad', 'Otros'];
const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function ComprasPage() {
  const { staff } = useAuth();
  const { activeBranch } = useBranch();
  const toast = useToast();
  const [data, setData] = useState<ComprasResponse>({ month: thisMonth(), total: 0, branches: [], purchases: [] });
  const [month, setMonth] = useState(thisMonth());
  const [nuevo, setNuevo] = useState(false);
  const [verFactura, setVerFactura] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const isAdmin = staff?.role === 'ADMIN';
  const branchQ = isAdmin && activeBranch !== 'all' ? `&branch=${activeBranch}` : '';
  const monthLabel = new Date(month + '-01T00:00:00').toLocaleDateString('es-DO', { month: 'long', year: 'numeric' });

  const load = useCallback(() => {
    setCargando(true); setErrorCarga(null);
    api.get<ComprasResponse>(`/purchases?month=${month}${branchQ}`)
      .then((r) => { setData(r); setCargando(false); })
      .catch((e) => { setErrorCarga(e instanceof Error ? e.message : 'Error'); setCargando(false); });
  }, [month, branchQ]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);

  function shiftMonth(n: number) {
    const d = new Date(month + '-01T00:00:00'); d.setMonth(d.getMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
  }

  async function eliminar(p: Purchase) {
    if (!window.confirm(`¿Eliminar la compra de ${p.supplier} (${fmtRD(p.amount)})? No se puede deshacer.`)) return;
    try { const r = await api.del<{ message: string }>(`/purchases/${p.id}`); toast(r.message); load(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Error'); }
  }

  return (
    <div className="animate-fade">
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <button onClick={() => shiftMonth(-1)} className="h-9 w-9 rounded-lg border border-line bg-card font-bold text-muted hover:border-magenta">‹</button>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-line bg-card px-3 py-2 text-[13px] font-semibold" />
        <button onClick={() => shiftMonth(1)} className="h-9 w-9 rounded-lg border border-line bg-card font-bold text-muted hover:border-magenta">›</button>
        <span className="ml-1 text-[13px] font-semibold capitalize text-muted">{monthLabel}</span>
        <div className="flex-1" />
        <button onClick={() => setNuevo(true)} className="flex items-center gap-1.5 rounded-[10px] bg-magenta px-[18px] py-2.5 text-[13.5px] font-bold text-white"><span className="text-base">+</span> Nueva compra</button>
      </div>

      <div className="mb-[18px] rounded-xl border border-line bg-card px-[18px] py-4 shadow-card">
        <div className="text-xs font-semibold text-muted">Total de compras del mes</div>
        <div className="mt-0.5 text-[21px] font-extrabold">{fmtRD(data.total)}</div>
      </div>

      {cargando ? <Cargando texto="Cargando compras…" /> : errorCarga ? <ErrorCarga mensaje={errorCarga} onRetry={load} /> : (
        <div className="overflow-x-auto rounded-base border border-line bg-card shadow-card">
          <div className="min-w-[820px]">
            <div className="grid grid-cols-[1.4fr_1.8fr_1fr_1fr_1fr_1.1fr] gap-3 border-b border-line px-5 py-3 text-[11.5px] font-bold uppercase tracking-wide text-muted">
              <div>Proveedor</div><div>Concepto</div><div>Categoría</div><div>Fecha</div><div>Monto</div><div>Factura</div>
            </div>
            {data.purchases.length === 0 && <div className="px-5 py-10 text-center text-sm text-muted">No hay compras registradas en {monthLabel}.</div>}
            {data.purchases.map((p) => (
              <div key={p.id} className="grid grid-cols-[1.4fr_1.8fr_1fr_1fr_1fr_1.1fr] items-center gap-3 border-b border-line-2 px-5 py-3.5 text-left">
                <div><div className="text-[13px] font-bold">{p.supplier}</div>{isAdmin && <div className="text-[11px] text-faint">{p.branch}</div>}</div>
                <div className="text-[13px]">{p.concept}{p.ncf && <span className="ml-1 text-[11px] text-faint">· NCF {p.ncf}</span>}</div>
                <div className="text-[12.5px] text-muted">{p.category ?? '—'}</div>
                <div className="text-[12.5px] text-muted">{p.date}</div>
                <div className="text-[13.5px] font-extrabold">{fmtRD(p.amount)}</div>
                <div className="flex items-center gap-2">
                  {p.hasInvoice
                    ? <button onClick={() => setVerFactura(p.id)} className="rounded-md px-2 py-1 text-[12px] font-bold text-magenta hover:underline">Ver factura</button>
                    : <span className="text-[12px] text-faint">Sin factura</span>}
                  {isAdmin && <button onClick={() => eliminar(p)} className="rounded-md px-2 py-1 text-[12px] font-bold text-muted hover:text-danger">Eliminar</button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {nuevo && <NuevaCompra branches={data.branches} isAdmin={isAdmin} onClose={() => setNuevo(false)} onSaved={() => { setNuevo(false); load(); }} />}
      {verFactura && <VerFactura id={verFactura} onClose={() => setVerFactura(null)} />}
    </div>
  );
}

function VerFactura({ id, onClose }: { id: string; onClose: () => void }) {
  const [img, setImg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.get<{ invoiceImage: string }>(`/purchases/${id}/invoice`).then((r) => setImg(r.invoiceImage)).catch((e) => setErr(e instanceof Error ? e.message : 'Error'));
  }, [id]);
  return (
    <Overlay onClose={onClose} z={120}>
      <div onClick={stop} className="flex max-h-[90vh] w-[560px] max-w-full flex-col overflow-hidden rounded-2xl bg-card animate-pop" style={{ boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
        <div className="flex items-center border-b border-line px-5 py-4"><div className="flex-1 text-[15px] font-extrabold">Factura</div><button onClick={onClose} className="h-8 w-8 rounded-lg bg-bg text-muted">×</button></div>
        <div className="overflow-y-auto p-4">
          {err ? <div className="py-8 text-center text-sm text-danger">{err}</div>
            : img ? <img src={img} alt="Factura" className="w-full rounded-lg border border-line" />
            : <div className="py-8 text-center text-sm text-muted">Cargando…</div>}
        </div>
      </div>
    </Overlay>
  );
}

function NuevaCompra({ branches, isAdmin, onClose, onSaved }: { branches: { id: string; name: string }[]; isAdmin: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [supplier, setSupplier] = useState('');
  const [concept, setConcept] = useState('');
  const [category, setCategory] = useState(CATEGORIAS[0]);
  const [amount, setAmount] = useState('');
  const [ncf, setNcf] = useState('');
  const [purchasedAt, setPurchasedAt] = useState(new Date().toISOString().slice(0, 10));
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [invoiceImage, setInvoiceImage] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  function comprimir(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const lector = new FileReader();
      lector.onerror = () => reject(new Error('No se pudo leer la imagen'));
      lector.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Imagen inválida'));
        img.onload = () => {
          const MAX = 1200; // las facturas deben quedar legibles
          const escala = Math.min(1, MAX / img.width);
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * escala);
          c.height = Math.round(img.height * escala);
          c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.8));
        };
        img.src = String(lector.result);
      };
      lector.readAsDataURL(file);
    });
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try { setInvoiceImage(await comprimir(file)); } catch { toast('No se pudo procesar la imagen'); }
  }

  async function guardar() {
    const monto = Math.round(Number(amount));
    if (!supplier.trim() || !concept.trim()) { toast('Completa proveedor y concepto'); return; }
    if (!monto || monto <= 0) { toast('Escribe un monto válido'); return; }
    if (isAdmin && !branchId) { toast('Selecciona la sucursal'); return; }
    setBusy(true);
    try {
      const r = await api.post<{ message: string }>('/purchases', {
        supplier: supplier.trim(), concept: concept.trim(), category, amount: monto,
        ncf: ncf.trim() || undefined, purchasedAt,
        branchId: isAdmin ? branchId : undefined,
        invoiceImage: invoiceImage ?? undefined, notes: notes.trim() || undefined,
      });
      toast(r.message); onSaved();
    } catch (e) { toast(e instanceof Error ? e.message : 'Error'); } finally { setBusy(false); }
  }

  const lbl = 'text-xs font-bold text-muted';
  const inp = 'rounded-[9px] border border-line px-3.5 py-2.5 text-[13px] outline-none focus:border-magenta';
  return (
    <Overlay onClose={onClose} z={120}>
      <div onClick={stop} className="flex max-h-[90vh] w-[480px] max-w-full flex-col overflow-hidden rounded-2xl bg-card animate-pop" style={{ boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
        <div className="flex items-center border-b border-line px-5 py-4"><div className="flex-1 text-[15px] font-extrabold">Nueva compra</div><button onClick={onClose} className="h-8 w-8 rounded-lg bg-bg text-muted">×</button></div>
        <div className="flex flex-col gap-3 overflow-y-auto px-5 py-4">
          {isAdmin && (
            <label className="flex flex-col gap-1"><span className={lbl}>Sucursal</span>
              <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={inp}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select></label>
          )}
          <label className="flex flex-col gap-1"><span className={lbl}>Proveedor</span>
            <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Ej. Suplidora Belleza SRL" className={inp} /></label>
          <label className="flex flex-col gap-1"><span className={lbl}>Concepto</span>
            <input value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Ej. Gel conductor, agujas, toallas…" className={inp} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1"><span className={lbl}>Categoría</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className={inp}>
                {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select></label>
            <label className="flex flex-col gap-1"><span className={lbl}>Monto (RD$)</span>
              <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="0" className={inp} /></label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1"><span className={lbl}>Fecha de la factura</span>
              <input type="date" value={purchasedAt} onChange={(e) => setPurchasedAt(e.target.value)} className={inp} /></label>
            <label className="flex flex-col gap-1"><span className={lbl}>NCF (opcional)</span>
              <input value={ncf} onChange={(e) => setNcf(e.target.value)} placeholder="B01…" className={inp} /></label>
          </div>
          <label className="flex flex-col gap-1"><span className={lbl}>Anexar factura (foto o imagen)</span>
            <input type="file" accept="image/*" onChange={onFile} className="text-[12px]" /></label>
          {invoiceImage && (
            <div className="relative">
              <img src={invoiceImage} alt="Factura" className="max-h-48 w-full rounded-lg border border-line object-contain" />
              <button onClick={() => setInvoiceImage(null)} className="absolute right-2 top-2 rounded-md bg-card px-2 py-1 text-[11px] font-bold text-danger shadow">Quitar</button>
            </div>
          )}
          <label className="flex flex-col gap-1"><span className={lbl}>Notas (opcional)</span>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={`${inp} resize-none`} /></label>
        </div>
        <div className="flex gap-2.5 border-t border-line px-5 py-4">
          <button onClick={onClose} className="flex-1 rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">Cancelar</button>
          <button onClick={guardar} disabled={busy} className="flex-[2] rounded-[10px] bg-magenta py-3 text-[13.5px] font-bold text-white disabled:opacity-60">{busy ? 'Guardando…' : 'Guardar compra'}</button>
        </div>
      </div>
    </Overlay>
  );
}
