import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { useBranch } from '../../layout/BranchContext';
import { useToast } from '../../components/Toast';
import { Overlay, stop } from '../../components/Modal';
import AssetsPanel from './AssetsPanel';
import ViewToggle, { useViewMode } from '../../components/ViewToggle';
import { CatalogModal } from '../CatalogPage';
import { puedeGestionarCatalogo } from '../../lib/permisos';

type Kind = 'PRODUCTO' | 'INSUMO';
type TabKey = 'PRODUCTO' | 'INSUMO' | 'EQUIPO' | 'SUMINISTRO';
const TABS: { k: TabKey; label: string }[] = [
  { k: 'PRODUCTO', label: 'Productos' },
  { k: 'INSUMO', label: 'Insumos' },
  { k: 'EQUIPO', label: 'Equipos' },
  { k: 'SUMINISTRO', label: 'Suministros' },
];

interface Level { branchId: string; branch: string; qty: number; minQty: number; low: boolean }
interface Row {
  id: string; kind: Kind; name: string; unit: string | null; price: number;
  qty: number; minQty: number; low: boolean; levels?: Level[];
}
interface InvResp { scope: string; items: Row[]; branches: { id: string; name: string; code: string }[] }

export default function InventarioPage() {
  const { staff } = useAuth();
  const { activeBranch } = useBranch();
  const isAdmin = staff?.role === 'ADMIN';
  const allBranches = isAdmin && activeBranch === 'all';

  const [tab, setTab] = useState<TabKey>('PRODUCTO');
  const [data, setData] = useState<InvResp | null>(null);
  const [edit, setEdit] = useState<Row | null>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [reload, setReload] = useState(0);
  const [q, setQ] = useState('');
  const [view, setView] = useViewMode('inventario', 'lista');
  const [nuevo, setNuevo] = useState(false); // alta de producto/insumo desde aquí
  const puedeCrear = puedeGestionarCatalogo(staff);

  const isAsset = tab === 'EQUIPO' || tab === 'SUMINISTRO';
  const branchQ = activeBranch !== 'all' ? `?branch=${activeBranch}` : '';
  useEffect(() => {
    if (isAsset) return;
    api.get<InvResp>(`/inventory${branchQ}`).then(setData).catch(() => setData(null));
  }, [reload, branchQ, isAsset]);

  const texto = q.trim().toLowerCase();
  const rows = (data?.items ?? []).filter((i) => i.kind === (tab as Kind) && (!texto || i.name.toLowerCase().includes(texto)));
  const lowCount = rows.filter((r) => r.low && r.qty <= r.minQty && r.minQty > 0).length;

  return (
    <div className="animate-fade">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => {
            const on = tab === t.k;
            return (
              <button key={t.k} onClick={() => setTab(t.k)}
                className="rounded-[10px] px-4 py-2 text-[13px] font-bold transition"
                style={{ background: on ? 'var(--magenta)' : 'var(--card)', color: on ? '#fff' : 'var(--muted)', border: `1px solid ${on ? 'var(--magenta)' : 'var(--line)'}` }}>
                {t.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          {!isAsset && lowCount > 0 && (
            <span className="rounded-full bg-amber-100 px-3 py-1.5 text-[12px] font-bold text-amber-700">⚠ {lowCount} en stock bajo</span>
          )}
          {!isAsset && <ViewToggle mode={view} onChange={setView} />}
          {!isAsset && puedeCrear && (
            <button onClick={() => setNuevo(true)} className="flex items-center gap-1.5 rounded-[10px] bg-magenta px-[18px] py-2.5 text-[13.5px] font-bold text-white">
              <span className="text-base">+</span> Nuevo {tab === 'PRODUCTO' ? 'producto' : 'insumo'}
            </button>
          )}
        </div>
      </div>

      {/* Buscador: el inventario crece y la tabla se vuelve larga. */}
      {!isAsset && (
        <div className="mb-3.5 flex items-center gap-2.5 rounded-[10px] border border-line bg-card px-3.5 py-2.5">
          <span className="text-faint">🔍</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre…"
            className="w-full bg-transparent text-[13.5px] outline-none placeholder:text-faint" />
          <span className="flex-none text-[12px] font-bold text-muted">{rows.length}</span>
        </div>
      )}

      {isAsset && <AssetsPanel kind={tab as 'EQUIPO' | 'SUMINISTRO'} canManage={!!isAdmin} branchQ={branchQ} />}

      {!isAsset && <>
      {allBranches && (
        <div className="mb-3 rounded-xl border border-line bg-card px-4 py-3 text-[12.5px] text-muted">
          Viendo <b>todas las sucursales</b> (stock total y desglose). Para registrar entradas o consumo, elige una sucursal arriba.
        </div>
      )}

      {view === 'tarjetas' ? (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <div key={r.id} className="rounded-base border border-line bg-card p-4 shadow-card">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1 text-[13.5px] font-bold leading-tight">{r.name}</div>
                {r.low && r.minQty > 0 && <span className="flex-none rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-bold text-amber-700">bajo</span>}
              </div>
              <div className="mb-2 flex items-baseline gap-1.5">
                <span className="text-[26px] font-extrabold" style={{ color: r.low && r.minQty > 0 ? '#e11d48' : 'var(--navy)' }}>{r.qty}</span>
                <span className="text-[12px] text-muted">{r.unit ?? 'unidades'}</span>
              </div>
              {allBranches && r.levels && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {r.levels.map((l) => (
                    <span key={l.branchId} className="rounded-full bg-bg px-2 py-0.5 text-[11px] font-semibold" style={{ color: l.low ? '#e11d48' : 'var(--muted)' }}>
                      {l.branch}: {l.qty}
                    </span>
                  ))}
                </div>
              )}
              {!allBranches && (
                <>
                  <div className="mb-2.5 text-[11.5px] text-muted">Mínimo: {r.minQty || '—'}</div>
                  <button onClick={() => setEdit(r)} className="w-full rounded-lg bg-magenta py-2 text-[12.5px] font-bold text-white">{isAdmin ? 'Ajustar' : 'Entrada / Salida'}</button>
                </>
              )}
            </div>
          ))}
          {rows.length === 0 && <div className="col-span-full py-10 text-center text-sm text-muted">Sin resultados.</div>}
        </div>
      ) : (
      <div className="overflow-hidden rounded-base border border-line bg-card shadow-card">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[11.5px] uppercase text-faint">
              <th className="px-4 py-3 font-bold">{tab === 'PRODUCTO' ? 'Producto' : 'Insumo'}</th>
              <th className="px-4 py-3 font-bold">Unidad</th>
              <th className="px-4 py-3 text-right font-bold">Existencia</th>
              <th className="px-4 py-3 text-right font-bold">Mínimo</th>
              {!allBranches && <th className="px-4 py-3 text-right font-bold">Acción</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3">
                  <div className="font-bold">{r.name}</div>
                  {allBranches && r.levels && (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {r.levels.map((l) => (
                        <span key={l.branchId} className="rounded-full bg-bg px-2 py-0.5 text-[11px] font-semibold" style={{ color: l.low ? '#e11d48' : 'var(--muted)' }}>
                          {l.branch}: {l.qty}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-muted">{r.unit ?? '—'}</td>
                <td className="px-4 py-3 text-right">
                  <span className="text-[15px] font-extrabold" style={{ color: r.low && r.minQty > 0 ? '#e11d48' : 'var(--text)' }}>{r.qty}</span>
                </td>
                <td className="px-4 py-3 text-right text-muted">{allBranches ? '—' : r.minQty || '—'}</td>
                {!allBranches && (
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setEdit(r)} className="rounded-lg bg-magenta px-3 py-1.5 text-[12px] font-bold text-white">{isAdmin ? 'Ajustar' : 'Entrada / Salida'}</button>
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">
                No hay {tab === 'PRODUCTO' ? 'productos' : 'insumos'}.{' '}
                {puedeCrear
                  ? <>Créalos con <b>Nuevo {tab === 'PRODUCTO' ? 'producto' : 'insumo'}</b> arriba.</>
                  : <>Pídele a la administración que los cree en <b>Catálogo</b>.</>}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      )}
      </>}

      {/* Alta de producto/insumo sin salir del inventario (crea el ítem en el catálogo). */}
      {nuevo && (
        <CatalogModal mode="add" defaultKind={tab as 'PRODUCTO' | 'INSUMO'}
          onClose={() => setNuevo(false)} onSaved={() => setReload((n) => n + 1)} />
      )}

      {edit && !allBranches && (
        <AdjustModal
          row={edit}
          branchId={activeBranch !== 'all' ? activeBranch : undefined}
          modes={isAdmin ? ['ENTRADA', 'CONSUMO', 'SALIDA', 'AJUSTE'] : ['ENTRADA', 'SALIDA']}
          canSetMin={isAdmin}
          onClose={() => setEdit(null)}
          onSaved={() => setReload((n) => n + 1)}
          onDocument={setDoc}
        />
      )}

      {doc && <ComprobanteModal doc={doc} onClose={() => setDoc(null)} />}
    </div>
  );
}

interface Doc {
  code: string; typeLabel: string; item: string; qty: number; unit: string;
  branch: string; by: string; note: string | null; date: string; qtyAfter: number;
}

type Mode = 'ENTRADA' | 'CONSUMO' | 'SALIDA' | 'AJUSTE';

function AdjustModal({ row, branchId, modes, canSetMin, onClose, onSaved, onDocument }: {
  row: Row; branchId?: string; modes: Mode[]; canSetMin: boolean; onClose: () => void; onSaved: () => void; onDocument: (d: Doc) => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>(modes[0]);
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [minQty, setMinQty] = useState(String(row.minQty || ''));
  const [busy, setBusy] = useState(false);

  async function save() {
    const n = Number(qty);
    if (!n || n <= 0) { toast('Escribe una cantidad'); return; }
    // ENTRADA suma; CONSUMO / SALIDA / AJUSTE restan.
    const delta = mode === 'ENTRADA' ? n : -n;
    setBusy(true);
    try {
      const r = await api.post<{ document?: Doc }>('/inventory/adjust', { catalogItemId: row.id, branchId, delta, reason: mode, note: note.trim() || undefined });
      toast('Inventario actualizado');
      onSaved();
      onClose();
      if (r.document) onDocument(r.document);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error');
    } finally { setBusy(false); }
  }

  async function saveMin() {
    setBusy(true);
    try {
      await api.post('/inventory/min', { catalogItemId: row.id, branchId, minQty: Number(minQty) || 0 });
      toast('Umbral de alerta guardado');
      onSaved();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error');
    } finally { setBusy(false); }
  }

  const MODE_LABEL: Record<Mode, string> = {
    ENTRADA: 'Entrada (+)', CONSUMO: 'Consumo (−)', SALIDA: 'Salida (−)', AJUSTE: 'Ajuste (−)',
  };
  const modeOptions = modes.map((k) => ({ k, label: MODE_LABEL[k] }));
  const notePlaceholder = mode === 'SALIDA' ? 'Ej. Enviado a lavandería' : mode === 'ENTRADA' ? 'Ej. Compra a proveedor' : 'Ej. consumo del día';

  return (
    <Overlay onClose={onClose} z={120}>
      <div onClick={stop} className="w-[440px] max-w-full overflow-hidden rounded-2xl bg-card animate-pop" style={{ boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
        <div className="flex items-center border-b border-line px-6 py-5">
          <div className="flex-1">
            <div className="text-base font-extrabold">{row.name}</div>
            <div className="text-[12px] text-muted">Existencia actual: <b>{row.qty}</b> {row.unit ?? ''}</div>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg bg-bg text-muted">×</button>
        </div>
        <div className="flex flex-col gap-3.5 px-6 py-5">
          {modeOptions.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {modeOptions.map((m) => {
                const on = mode === m.k;
                return (
                  <button key={m.k} onClick={() => setMode(m.k)} className="flex-1 rounded-[9px] px-2 py-2.5 text-[12px] font-bold transition"
                    style={{ background: on ? 'var(--magenta)' : 'var(--bg)', color: on ? '#fff' : 'var(--muted)', border: `1px solid ${on ? 'var(--magenta)' : 'var(--line)'}` }}>
                    {m.label}
                  </button>
                );
              })}
            </div>
          )}
          {modeOptions.length === 1 && (
            <div className="rounded-[9px] bg-magenta-soft px-3 py-2.5 text-[12.5px] font-bold text-magenta">Registrar salida (p. ej. enviar a lavandería)</div>
          )}
          <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Cantidad</span><input autoFocus className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} placeholder={`Cantidad en ${row.unit ?? 'unidades'}`} /></label>
          <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Nota (opcional)</span><input className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" value={note} onChange={(e) => setNote(e.target.value)} placeholder={notePlaceholder} /></label>
        </div>
        <div className="flex gap-2.5 border-t border-line px-6 py-4">
          <button onClick={onClose} className="flex-1 rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">Cancelar</button>
          <button onClick={save} disabled={busy} className="flex-[2] rounded-[10px] bg-magenta py-3 text-[13.5px] font-bold text-white disabled:opacity-60">{modeOptions.length === 1 ? 'Registrar salida' : 'Registrar'}</button>
        </div>
        {canSetMin && (
          <div className="flex items-center gap-2.5 border-t border-line bg-bg px-6 py-3.5">
            <span className="text-[12px] font-bold text-muted">Alerta de stock bajo si baja de</span>
            <input className="w-20 rounded-[9px] border border-line px-3 py-2 text-[13px] outline-none focus:border-magenta" value={minQty} onChange={(e) => setMinQty(e.target.value.replace(/\D/g, ''))} placeholder="0" />
            <button onClick={saveMin} disabled={busy} className="ml-auto rounded-[9px] border border-line bg-card px-3 py-2 text-[12px] font-bold text-muted">Guardar mínimo</button>
          </div>
        )}
      </div>
    </Overlay>
  );
}

/** Comprobante imprimible de un movimiento de insumos hecho por recepción.
 *  El admin ya fue notificado automáticamente; aquí se puede imprimir/descargar. */
function ComprobanteModal({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  function print() {
    const w = window.open('', '_blank', 'width=460,height=640');
    if (!w) return;
    const row = (k: string, v: string) => `<tr><td style="padding:4px 0;color:#777">${k}</td><td style="padding:4px 0;text-align:right;font-weight:700">${v}</td></tr>`;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${doc.code}</title>
      <style>body{font-family:Arial,Helvetica,sans-serif;color:#222;padding:24px;max-width:380px;margin:auto}
      h1{font-size:16px;margin:0} .sub{color:#888;font-size:12px;margin:2px 0 16px}
      table{width:100%;border-collapse:collapse;font-size:13px}
      .code{background:#f4e8f1;color:#B31C86;font-weight:800;border-radius:8px;padding:8px 12px;display:inline-block;margin-bottom:14px}
      .note{margin-top:14px;font-size:12px;color:#555;border-top:1px solid #eee;padding-top:10px}</style></head>
      <body>
        <h1>Li Estetic Center</h1>
        <div class="sub">Comprobante de ${doc.typeLabel.toLowerCase()} de insumos</div>
        <div class="code">${doc.code}</div>
        <table>
          ${row('Tipo', doc.typeLabel)}
          ${row('Insumo', doc.item)}
          ${row('Cantidad', `${doc.qty} ${doc.unit}`)}
          ${row('Existencia luego', `${doc.qtyAfter} ${doc.unit}`)}
          ${row('Sucursal', doc.branch)}
          ${row('Registrado por', doc.by)}
          ${row('Fecha', doc.date)}
        </table>
        ${doc.note ? `<div class="note"><b>Nota:</b> ${doc.note}</div>` : ''}
        <div class="note">Enviado automáticamente al administrador.</div>
      </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 200);
  }

  const Line = ({ k, v }: { k: string; v: string }) => (
    <div className="flex justify-between py-1.5 text-[13px]"><span className="text-muted">{k}</span><span className="font-bold">{v}</span></div>
  );

  return (
    <Overlay onClose={onClose} z={130}>
      <div onClick={stop} className="w-[400px] max-w-full overflow-hidden rounded-2xl bg-card animate-pop" style={{ boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
        <div className="border-b border-line px-6 py-5">
          <div className="text-base font-extrabold">Comprobante generado</div>
          <div className="text-[12px] text-muted">Se envió al administrador automáticamente ✓</div>
        </div>
        <div className="px-6 py-5">
          <div className="mb-3 inline-block rounded-lg bg-magenta-soft px-3 py-1.5 text-[13px] font-extrabold text-magenta">{doc.code}</div>
          <Line k="Tipo" v={doc.typeLabel} />
          <Line k="Insumo" v={doc.item} />
          <Line k="Cantidad" v={`${doc.qty} ${doc.unit}`} />
          <Line k="Existencia luego" v={`${doc.qtyAfter} ${doc.unit}`} />
          <Line k="Sucursal" v={doc.branch} />
          <Line k="Registrado por" v={doc.by} />
          <Line k="Fecha" v={doc.date} />
          {doc.note && <Line k="Nota" v={doc.note} />}
        </div>
        <div className="flex gap-2.5 border-t border-line px-6 py-4">
          <button onClick={onClose} className="flex-1 rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">Cerrar</button>
          <button onClick={print} className="flex-[2] rounded-[10px] bg-magenta py-3 text-[13.5px] font-bold text-white">Imprimir / Descargar</button>
        </div>
      </div>
    </Overlay>
  );
}
