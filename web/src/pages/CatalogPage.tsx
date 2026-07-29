import { useEffect, useState } from 'react';
import ViewToggle, { useViewMode } from '../components/ViewToggle';
import { puedeGestionarCatalogo } from '../lib/permisos';
import { api } from '../lib/api';
import { Cargando, ErrorCarga } from '../components/EstadoCarga';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Overlay, stop } from '../components/Modal';
import { fmtRD, type CatalogItem, type CatalogKind } from '../lib/types';

const TABS: { key: CatalogKind; label: string }[] = [
  { key: 'SERVICIO', label: 'Servicios' },
  { key: 'PAQUETE', label: 'Ofertas/Paquetes' },
  { key: 'COMBO', label: 'Combos' },
  { key: 'PRODUCTO', label: 'Productos' },
  { key: 'INSUMO', label: 'Insumos' },
];

const STOCKABLE = (k: CatalogKind) => k === 'PRODUCTO' || k === 'INSUMO';

// Inicial del código automático por tipo (debe coincidir con el servidor).
const PREFIJO_CODIGO: Record<CatalogKind, string> = {
  COMBO: 'C', SERVICIO: 'S', PAQUETE: 'P', PRODUCTO: 'R', INSUMO: 'I',
};

// Áreas por familia, para elegir las que trae el combo por defecto al crearlo.
export default function CatalogPage() {
  const { staff } = useAuth();
  const isAdmin = puedeGestionarCatalogo(staff);
  const [tab, setTab] = useState<CatalogKind>('SERVICIO');
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [modal, setModal] = useState<{ mode: 'add' | 'edit'; item?: CatalogItem } | null>(null);
  const [reload, setReload] = useState(0);
  const [q, setQ] = useState('');
  const [view, setView] = useViewMode('catalogo');

  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [numerando, setNumerando] = useState(false);
  const toast = useToast();

  /** Asigna código a los ítems cargados antes de que la numeración fuera automática. */
  async function generarCodigos() {
    setNumerando(true);
    try {
      const r = await api.post<{ message: string }>('/catalog/generar-codigos', {});
      toast(r.message);
      setReload((x) => x + 1);
    } catch (e) { toast(e instanceof Error ? e.message : 'Error'); } finally { setNumerando(false); }
  }

  const cargar = () => {
    setCargando(true); setErrorCarga(null);
    api.get<CatalogItem[]>('/catalog')
      .then((r) => { setItems(r); setCargando(false); })
      .catch((e) => { setErrorCarga(e instanceof Error ? e.message : 'Error'); setCargando(false); });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(cargar, [reload]);

  const texto = q.trim().toLowerCase();
  const shown = items.filter((i) => i.kind === tab && (!texto || i.name.toLowerCase().includes(texto) || (i.code ?? '').toLowerCase().includes(texto)));
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
        <div className="flex items-center gap-2">
          <ViewToggle mode={view} onChange={setView} />
          {/* Numera de una vez lo que se cargó antes de que el código fuera automático. */}
          {isAdmin && items.some((i) => !i.code) && (
            <button onClick={generarCodigos} disabled={numerando}
              className="rounded-[10px] border border-line bg-card px-3.5 py-2.5 text-[12.5px] font-bold text-navy hover:border-magenta disabled:opacity-60">
              {numerando ? 'Numerando…' : `# Numerar ${items.filter((i) => !i.code).length} sin código`}
            </button>
          )}
          {isAdmin && (
            <button onClick={() => setModal({ mode: 'add' })} className="flex items-center gap-1.5 rounded-[10px] bg-magenta px-[18px] py-2.5 text-[13.5px] font-bold text-white"><span className="text-base">+</span> Agregar</button>
          )}
        </div>
      </div>

      {/* Buscador: imprescindible cuando el catálogo crece. */}
      <div className="mb-3.5 flex items-center gap-2.5 rounded-[10px] border border-line bg-card px-3.5 py-2.5">
        <span className="text-faint">🔍</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre…"
          className="w-full bg-transparent text-[13.5px] outline-none placeholder:text-faint" />
        <span className="flex-none text-[12px] font-bold text-muted">{shown.length}</span>
      </div>

      {cargando ? <Cargando texto="Cargando catálogo…" /> : errorCarga ? <ErrorCarga mensaje={errorCarga} onRetry={cargar} /> : view === 'lista' ? (
        <div className="overflow-x-auto rounded-base border border-line bg-card shadow-card">
          <div className="min-w-[620px]">
            <div className="grid grid-cols-[2.4fr_1.2fr_1fr_auto] gap-3 border-b border-line px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-muted">
              <div>Nombre</div><div>Detalle</div><div>Precio</div><div className="w-[130px]" />
            </div>
            {shown.map((it) => (
              <div key={it.id} className="grid grid-cols-[2.4fr_1.2fr_1fr_auto] items-center gap-3 border-b border-line-2 px-4 py-2.5 hover:bg-bg">
                <div className="flex min-w-0 items-center gap-2.5">
                  {it.imageUrl
                    ? <img src={it.imageUrl} alt="" className="h-10 w-10 flex-none rounded-[8px] border border-line object-cover" />
                    : it.kind !== 'INSUMO' && <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[8px] bg-magenta-soft text-magenta">✦</span>}
                  <div className="min-w-0">
                    {it.code && <div className="font-mono text-[10.5px] font-bold text-faint">{it.code}</div>}
                    <div className="truncate text-[13px] font-bold">{it.name}</div>
                  </div>
                </div>
                <div className="truncate text-[12px] text-muted">
                  {STOCKABLE(it.kind) ? (it.unit ? `Por ${it.unit}` : 'Inventariable') : it.sessions > 1 ? `${it.sessions} sesiones` : it.category ?? it.tag ?? '1 sesión'}
                  {it.validUntil && <VenceChip iso={it.validUntil} inline />}
                </div>
                <div className="text-[13px] font-extrabold text-magenta">{!it.price ? <span className="text-[12px] font-bold text-muted">Sin precio</span> : fmtRD(it.price)}</div>
                <div className="flex w-[130px] justify-end gap-1.5">
                  {isAdmin && (
                    <>
                      <button onClick={() => setModal({ mode: 'edit', item: it })} className="rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[11.5px] font-bold text-muted hover:text-magenta">Editar</button>
                      <DeleteButton item={it} onDone={refresh} />
                    </>
                  )}
                </div>
              </div>
            ))}
            {shown.length === 0 && <div className="py-10 text-center text-sm text-muted">Sin ítems en esta categoría.</div>}
          </div>
        </div>
      ) : (
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((it) => (
          <div key={it.id} className="group relative rounded-base border border-line bg-card p-[18px] shadow-card">
            {/* Foto arriba: se muestra COMPLETA (sin recortar) para que el personal
                vea toda la promo. object-contain + fondo para el espacio sobrante. */}
            {it.imageUrl ? (
              <img src={it.imageUrl} alt={it.name} className="mb-3 max-h-56 w-full rounded-[11px] border border-line bg-bg object-contain" />
            ) : null}
            <div className="mb-3 flex items-start justify-between gap-2.5">
              {!it.imageUrl && <div className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[11px] bg-magenta-soft text-lg text-magenta">✦</div>}
              <span className="ml-auto rounded-full bg-bg px-2.5 py-1 text-[11px] font-bold text-muted">
                {STOCKABLE(it.kind) ? (it.unit ? `Por ${it.unit}` : 'Inventariable') : it.category ?? it.tag ?? `${it.sessions} ses`}
              </span>
            </div>
            {it.code && <div className="mb-0.5 font-mono text-[10.5px] font-bold text-faint">{it.code}</div>}
            <div className="mb-1.5 text-sm font-bold leading-tight">{it.name}</div>
            <div className="mb-3 text-xs text-faint">{it.kind === 'INSUMO' ? 'Insumo operativo' : it.sessions > 1 ? `${it.sessions} sesiones` : it.tag || '1 sesión'}</div>
            {it.validUntil && <VenceChip iso={it.validUntil} />}
            <div className="text-[19px] font-extrabold text-magenta">{!it.price ? <span className="text-[13px] font-bold text-muted">Sin precio</span> : fmtRD(it.price)}</div>

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
      )}

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

/** Etiqueta de vencimiento de una oferta/combo. Rojo si ya venció. */
function VenceChip({ iso, inline }: { iso: string; inline?: boolean }) {
  const d = new Date(iso);
  const vencido = d.getTime() < Date.now();
  const txt = d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' });
  return (
    <span className={inline ? 'ml-1.5 rounded-full px-1.5 py-0.5 text-[10.5px] font-bold' : 'inline-block rounded-full px-2 py-0.5 text-[10.5px] font-bold'}
      style={vencido ? { background: 'var(--danger-soft)', color: 'var(--danger)' } : { background: 'var(--warn-soft)', color: '#7A5A12' }}>
      {vencido ? `Vencida ${txt}` : `Vence ${txt}`}
    </span>
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

/** Alta/edición de un ítem del catálogo. Se reutiliza desde Inventario. */
export function CatalogModal({ mode, item, defaultKind, onClose, onSaved }: {
  mode: 'add' | 'edit';
  item?: CatalogItem;
  defaultKind: CatalogKind;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [kind, setKind] = useState<CatalogKind>(item?.kind ?? defaultKind);
  const [code, setCode] = useState(item?.code ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [price, setPrice] = useState(item?.price != null ? String(item.price) : '');
  const [sessions, setSessions] = useState(item?.sessions ? String(item.sessions) : '1');
  const [unit, setUnit] = useState(item?.unit ?? '');
  const [showInPortal, setShowInPortal] = useState(item?.showInPortal ?? true);
  const [imageUrl, setImageUrl] = useState<string | null>(item?.imageUrl ?? null);
  const [validUntil, setValidUntil] = useState(item?.validUntil ? item.validUntil.slice(0, 10) : '');
  const [busy, setBusy] = useState(false);

  // Comprime la foto a ~900px JPEG para que se vea bien sin engordar la base.
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const lector = new FileReader();
    lector.onload = () => {
      const img = new Image();
      img.onload = () => {
        const MAX = 900; const escala = Math.min(1, MAX / img.width);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * escala); c.height = Math.round(img.height * escala);
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        setImageUrl(c.toDataURL('image/jpeg', 0.82));
      };
      img.src = String(lector.result);
    };
    lector.readAsDataURL(file);
  }
  const stockable = STOCKABLE(kind);
  // Un combo/paquete incluye varias técnicas; la esteticista marca cuáles aplica por sesión.
  const componible = kind === 'COMBO' || kind === 'PAQUETE';
  const [servicios, setServicios] = useState<CatalogItem[]>([]);
  const [serviceIds, setServiceIds] = useState<string[]>((item?.services ?? []).map((s) => s.id));
  // Cantidad incluida de cada técnica (ej. 18 cavitaciones, 3 lipoláser).
  const [serviceQty, setServiceQty] = useState<Record<string, number>>(
    Object.fromEntries((item?.services ?? []).map((s) => [s.id, s.qty ?? 1])),
  );
  // Familia de áreas: define qué grupo se muestra al asignar áreas al paciente.
  const [areaGroup, setAreaGroup] = useState<'' | 'CORPORAL' | 'LASER'>(item?.areaGroup ?? '');
  const [areas, setAreas] = useState<string[]>(item?.defaultAreas ?? []);
  const toggleArea = (k: string) => setAreas((a) => (a.includes(k) ? a.filter((x) => x !== k) : [...a, k]));

  // Áreas administrables (incluye las que la admin agregue en Configuración).
  const [areaOpts, setAreaOpts] = useState<{ key: string; label: string; grupo: string }[]>([]);
  useEffect(() => {
    if (!componible) return;
    api.get<CatalogItem[]>('/catalog?kind=SERVICIO').then(setServicios).catch(() => setServicios([]));
    api.get<{ key: string; label: string; grupo: string }[]>('/catalog/body-areas').then(setAreaOpts).catch(() => setAreaOpts([]));
  }, [componible]);

  const toggleServicio = (id: string) =>
    setServiceIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function save() {
    if (!name.trim()) { toast('El nombre es requerido'); return; }
    // El precio es opcional: la directora crea combos a diario y define el monto al cobrar.
    setBusy(true);
    const payload = {
      kind, name: name.trim(),
      code: code.trim() || undefined,
      ...(componible ? { showInPortal } : {}),
      price: Number(price) || 0,
      sessions: Number(sessions) || 1,
      unit: stockable ? (unit.trim() || undefined) : undefined,
      // Foto (para catálogo y portal) y vencimiento de la oferta/combo.
      imageUrl: kind !== 'INSUMO' ? imageUrl : null,
      validUntil: componible ? (validUntil || null) : null,
      // Solo se envían cuando aplica, para no borrar las técnicas de otros tipos.
      ...(componible ? { services: serviceIds.map((id) => ({ id, qty: serviceQty[id] || 1 })), areaGroup: areaGroup || null, defaultAreas: areaGroup ? areas : [] } : {}),
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
              <option value="SERVICIO">Servicio</option><option value="PAQUETE">Oferta/Paquete</option><option value="COMBO">Combo</option><option value="PRODUCTO">Producto</option><option value="INSUMO">Insumo operativo</option>
            </select>
          </label>
          <div className="flex gap-3">
            {/* El código se asigna solo al guardar (C-001 combos, S-001 servicios…).
                En edición se puede corregir; al crear no hay nada que escribir. */}
            <label className="flex w-[130px] flex-none flex-col gap-1.5">
              <span className="text-xs font-bold text-muted">Código</span>
              {mode === 'edit' ? (
                <input className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] uppercase outline-none focus:border-magenta"
                  value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Ej. C-001" />
              ) : (
                <div className="flex items-center rounded-[9px] border border-dashed border-line bg-bg px-3.5 py-3 text-[12.5px] font-bold text-faint">
                  {PREFIJO_CODIGO[kind]}-… <span className="ml-1 font-semibold">auto</span>
                </div>
              )}
            </label>
            <label className="flex flex-1 flex-col gap-1.5"><span className="text-xs font-bold text-muted">Nombre</span><input className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'INSUMO' ? 'Ej. Toallas / Papel de baño' : 'Ej. Radiofrecuencia facial'} /></label>
          </div>
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1.5"><span className="text-xs font-bold text-muted">{kind === 'INSUMO' ? 'Costo (opcional)' : 'Precio RD$ (opcional)'}</span><input className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} placeholder="Dejar vacío = sin precio" /></label>
            {stockable ? (
              <label className="flex flex-1 flex-col gap-1.5"><span className="text-xs font-bold text-muted">Unidad</span><input className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="unidad, rollo, litro…" /></label>
            ) : (
              <label className="flex flex-1 flex-col gap-1.5"><span className="text-xs font-bold text-muted">Sesiones</span><input className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" value={sessions} onChange={(e) => setSessions(e.target.value.replace(/\D/g, ''))} placeholder="1" /></label>
            )}
          </div>
          {stockable && <p className="text-[11.5px] text-faint">El stock se controla por sucursal en la pestaña <b>Inventario</b>.</p>}

          {/* Foto: se ve en el catálogo (más visual para el personal) y en el portal. */}
          {kind !== 'INSUMO' && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-muted">Foto {kind === 'PRODUCTO' ? 'del producto' : 'de la oferta/combo'} <span className="font-semibold text-faint">(opcional)</span></span>
              {imageUrl ? (
                <div className="relative">
                  <img src={imageUrl} alt="" className="h-36 w-full rounded-[10px] border border-line object-cover" />
                  <button type="button" onClick={() => setImageUrl(null)} className="absolute right-2 top-2 rounded-md bg-card px-2 py-1 text-[11px] font-bold text-danger shadow">Quitar</button>
                </div>
              ) : (
                <input type="file" accept="image/*" onChange={onFile} className="text-[12px]" />
              )}
            </div>
          )}

          {/* Vencimiento de la oferta/combo (opcional). */}
          {componible && (
            <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Vence el <span className="font-semibold text-faint">(opcional · deja vacío si no vence)</span></span>
              <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="rounded-[9px] border border-line bg-card px-3.5 py-3 text-[13.5px]" />
            </label>
          )}

          {/* Curaduría del portal: la admin decide si el paciente ve este combo/paquete. */}
          {componible && (
            <button type="button" onClick={() => setShowInPortal((v) => !v)}
              className="flex items-center justify-between rounded-[9px] border border-line bg-bg px-3.5 py-3 text-left">
              <span className="flex flex-col">
                <span className="text-[13px] font-bold">Mostrar en el portal del paciente</span>
                <span className="text-[11px] text-faint">{showInPortal ? 'Los pacientes lo ven en la tienda del portal.' : 'Oculto: solo se vende desde recepción.'}</span>
              </span>
              <span className="relative flex h-6 w-11 flex-none items-center rounded-full transition" style={{ background: showInPortal ? 'var(--magenta)' : 'var(--line)' }}>
                <span className="absolute h-5 w-5 rounded-full bg-white transition-all" style={{ left: showInPortal ? 22 : 2 }} />
              </span>
            </button>
          )}

          {/* Tipo de áreas del combo: define qué grupo se ofrece al asignar áreas al paciente. */}
          {componible && (
            <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Tipo de áreas</span>
              <select className="rounded-[9px] border border-line bg-card px-3.5 py-3 text-[13.5px]" value={areaGroup} onChange={(e) => { setAreaGroup(e.target.value as '' | 'CORPORAL' | 'LASER'); setAreas([]); }}>
                <option value="">Sin áreas (no aplica)</option>
                <option value="CORPORAL">Corporal (abdomen, espalda, lateral)</option>
                <option value="LASER">Láser (piernas, axilas, cara…)</option>
              </select>
            </label>
          )}

          {/* Áreas que trae el combo por defecto: se cargan al venderlo al paciente. */}
          {componible && areaGroup && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-muted">Áreas del combo <span className="font-semibold text-faint">({areas.length} elegidas · {areas.length ? Math.floor((Number(sessions) || 1) / areas.length) : 0} sesiones c/u)</span></span>
              <div className="flex flex-wrap gap-1.5">
                {areaOpts.filter((a) => a.grupo === areaGroup).map((a) => {
                  const on = areas.includes(a.key);
                  return (
                    <button key={a.key} type="button" onClick={() => toggleArea(a.key)}
                      className="rounded-full border px-3 py-1.5 text-[12px] font-bold"
                      style={{ borderColor: on ? 'var(--magenta)' : 'var(--line)', background: on ? 'var(--magenta-soft)' : 'var(--card)', color: on ? 'var(--magenta)' : 'var(--muted)' }}>
                      {on ? '✓ ' : ''}{a.label}
                    </button>
                  );
                })}
              </div>
              <span className="text-[11px] text-faint">Vienen cargadas al vender el combo. En la ficha del paciente se pueden ajustar.</span>
            </div>
          )}

          {/* Técnicas del combo/paquete: se marca cuáles incluye y CUÁNTAS de cada una (18 cavitaciones, 3 lipoláser). */}
          {componible && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-muted">¿Qué incluye y cuántas? <span className="font-semibold text-faint">({serviceIds.length} técnicas)</span></span>
              {servicios.length === 0 ? (
                <div className="rounded-[9px] bg-bg px-3.5 py-3 text-[12px] text-muted">
                  Primero crea los servicios (vacumterapia, cavitación, radiofrecuencia…) en la pestaña <b>Servicios</b>.
                </div>
              ) : (
                <div className="flex max-h-[220px] flex-col gap-1 overflow-y-auto rounded-[9px] border border-line p-2">
                  {servicios.map((s) => {
                    const on = serviceIds.includes(s.id);
                    return (
                      <div key={s.id} className="flex items-center gap-2.5 rounded-[8px] px-2.5 py-1.5" style={{ background: on ? 'var(--magenta-soft)' : 'transparent' }}>
                        <button type="button" onClick={() => toggleServicio(s.id)} className="flex flex-1 items-center gap-2.5 text-left">
                          <span className="flex flex-none items-center justify-center rounded-[5px] text-[10px] font-extrabold text-white"
                            style={{ background: on ? 'var(--magenta)' : 'var(--line)', height: 18, width: 18 }}>✓</span>
                          <span className="text-[13px] font-semibold">{s.name}</span>
                        </button>
                        {on && (
                          <div className="flex flex-none items-center gap-1 rounded-[7px] border border-line bg-card">
                            <button type="button" onClick={() => setServiceQty((q) => ({ ...q, [s.id]: Math.max(1, (q[s.id] || 1) - 1) }))} className="px-2 py-1 text-[14px] font-bold text-muted">−</button>
                            <input value={String(serviceQty[s.id] || 1)} onChange={(e) => setServiceQty((q) => ({ ...q, [s.id]: Math.max(1, parseInt(e.target.value.replace(/\D/g, ''), 10) || 1) }))} inputMode="numeric"
                              className="w-9 bg-transparent text-center text-[13px] font-bold outline-none" />
                            <button type="button" onClick={() => setServiceQty((q) => ({ ...q, [s.id]: (q[s.id] || 1) + 1 }))} className="px-2 py-1 text-[14px] font-bold text-muted">+</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <span className="text-[11px] text-faint">La esteticista marcará en cada sesión cuáles le aplicó al paciente.</span>
            </div>
          )}
        </div>
        <div className="flex gap-2.5 border-t border-line px-6 py-4">
          <button onClick={onClose} className="flex-1 rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">Cancelar</button>
          <button onClick={save} disabled={busy} className="flex-[2] rounded-[10px] bg-magenta py-3 text-[13.5px] font-bold text-white disabled:opacity-60">Guardar</button>
        </div>
      </div>
    </Overlay>
  );
}
