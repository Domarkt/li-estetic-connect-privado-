import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { useBranch } from '../../layout/BranchContext';
import { Overlay, stop } from '../../components/Modal';
import { Cargando, ErrorCarga } from '../../components/EstadoCarga';
import { fmtRD } from '../../lib/types';

/** Paquete/combo con su estado de publicación en el portal. */
interface ItemPortal {
  id: string; name: string; code: string | null; kind: string;
  price: number; sessions: number; showInPortal: boolean;
  visible: boolean; motivo: string | null;
}

interface MensajePortal {
  id: string; kind: 'OFERTA' | 'AVISO' | 'CONSEJO';
  title: string; body: string;
  ctaLabel: string | null; ctaLink: string | null;
  branchId: string | null; active: boolean;
  startsAt: string | null; endsAt: string | null;
  creado: string; vigente: boolean;
}

/** Acceso de un paciente a su portal. */
interface AccesoPortal {
  id: string; patientId: string; name: string;
  phone: string; email: string | null; branch: string;
  active: boolean; desde: string;
}

const KIND_TAG: Record<string, string> = { PAQUETE: 'Paquete', COMBO: 'Combo' };
const MSG_META: Record<string, { label: string; icon: string; color: string }> = {
  OFERTA: { label: 'Oferta', icon: '🎁', color: 'var(--magenta)' },
  AVISO: { label: 'Aviso', icon: '📣', color: 'var(--navy)' },
  CONSEJO: { label: 'Consejo', icon: '💡', color: 'var(--teal)' },
};

/**
 * Portal del paciente (administración): qué paquetes ve la paciente y qué
 * mensajes u ofertas le llegan directo, sin depender de WhatsApp ni del correo.
 */
export default function PortalAdminPage() {
  const [tab, setTab] = useState<'catalogo' | 'mensajes' | 'accesos'>('catalogo');

  return (
    <div className="animate-fade">
      <div className="mb-1 text-base font-extrabold">Portal del paciente</div>
      <div className="mb-4 text-[12.5px] text-muted">Lo que ven tus pacientes cuando entran a su portal.</div>

      <div className="mb-4 flex flex-wrap gap-2">
        {([['catalogo', '📦 Paquetes visibles'], ['mensajes', '📣 Mensajes y ofertas'], ['accesos', '🔑 Accesos de pacientes']] as const).map(([k, label]) => {
          const on = tab === k;
          return (
            <button key={k} onClick={() => setTab(k)}
              className="rounded-[10px] px-4 py-2 text-[13px] font-bold transition"
              style={{ background: on ? 'var(--magenta)' : 'var(--card)', color: on ? '#fff' : 'var(--muted)', border: `1px solid ${on ? 'var(--magenta)' : 'var(--line)'}` }}>
              {label}
            </button>
          );
        })}
      </div>

      {tab === 'catalogo' ? <PaquetesTab /> : tab === 'mensajes' ? <MensajesTab /> : <AccesosTab />}
    </div>
  );
}

/** Acceso de cada paciente a su portal: se puede retirar sin borrar su expediente. */
function AccesosTab() {
  const toast = useToast();
  const [rows, setRows] = useState<AccesoPortal[]>([]);
  const [q, setQ] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<AccesoPortal | null>(null);

  const cargar = useCallback(() => {
    setCargando(true); setError(null);
    api.get<AccesoPortal[]>('/portal-admin/accesos')
      .then((r) => { setRows(r); setCargando(false); })
      .catch((e) => { setError(e instanceof Error ? e.message : 'Error'); setCargando(false); });
  }, []);
  useEffect(cargar, [cargar]);

  async function cambiar(a: AccesoPortal, active: boolean) {
    try {
      const r = await api.patch<{ message: string }>(`/portal-admin/accesos/${a.id}`, { active });
      toast(r.message); cargar();
    } catch (e) { toast(e instanceof Error ? e.message : 'Error'); } finally { setConfirmar(null); }
  }

  const texto = q.trim().toLowerCase();
  const shown = rows.filter((r) => !texto || r.name.toLowerCase().includes(texto) || (r.phone ?? '').includes(texto));
  const activos = rows.filter((r) => r.active).length;

  if (cargando) return <Cargando texto="Cargando accesos…" />;
  if (error) return <ErrorCarga mensaje={error} onRetry={cargar} />;

  return (
    <>
      <div className="mb-3 rounded-[11px] border border-line bg-card px-4 py-3 text-[12.5px]">
        <b>{activos}</b> de {rows.length} pacientes pueden entrar a su portal.
        <span className="ml-1 text-muted">Retirar el acceso <b>no borra</b> el expediente ni el historial: solo impide entrar.</span>
      </div>

      <div className="mb-3 flex items-center gap-2.5 rounded-[10px] border border-line bg-card px-3.5 py-2.5">
        <span className="text-faint">🔍</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar paciente por nombre o teléfono…"
          className="w-full bg-transparent text-[13.5px] outline-none placeholder:text-faint" />
        <span className="flex-none text-[12px] font-bold text-muted">{shown.length}</span>
      </div>

      <div className="overflow-hidden rounded-base border border-line bg-card shadow-card">
        {shown.map((a) => (
          <div key={a.id} className="flex items-center gap-3 border-b border-line-2 px-4 py-3 last:border-0">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-[13.5px] font-bold">{a.name}</span>
                {!a.active && <span className="flex-none rounded-full bg-danger-soft px-2 py-0.5 text-[10.5px] font-bold text-danger">Acceso retirado</span>}
              </div>
              <div className="mt-0.5 truncate text-[11.5px] text-muted">{a.phone}{a.email ? ` · ${a.email}` : ''} · {a.branch}</div>
            </div>
            {a.active ? (
              <button onClick={() => setConfirmar(a)}
                className="flex-none rounded-lg border px-3 py-1.5 text-[11.5px] font-bold"
                style={{ borderColor: 'var(--danger)', color: 'var(--danger)', background: 'var(--danger-soft)' }}>
                Quitar acceso
              </button>
            ) : (
              <button onClick={() => cambiar(a, true)}
                className="flex-none rounded-lg bg-magenta px-3 py-1.5 text-[11.5px] font-bold text-white">
                Devolver acceso
              </button>
            )}
          </div>
        ))}
        {shown.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-muted">
            {rows.length === 0 ? 'Todavía ningún paciente tiene acceso al portal. Se activa al pagar su primer servicio.' : 'Sin coincidencias.'}
          </div>
        )}
      </div>

      {confirmar && (
        <Overlay onClose={() => setConfirmar(null)} z={120}>
          <div onClick={stop} className="w-[400px] max-w-full overflow-hidden rounded-2xl bg-card animate-pop" style={{ boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
            <div className="px-5 py-5">
              <div className="mb-1.5 text-base font-extrabold">¿Quitar el acceso de {confirmar.name}?</div>
              <div className="text-[12.5px] text-muted">
                No podrá entrar a su portal ni ver su proceso, sus citas ni su ficha. Su expediente y su historial
                <b> se mantienen intactos</b> y puedes devolverle el acceso cuando quieras.
              </div>
            </div>
            <div className="flex gap-2.5 border-t border-line px-5 py-4">
              <button onClick={() => setConfirmar(null)} className="flex-1 rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">Cancelar</button>
              <button onClick={() => cambiar(confirmar, false)} className="flex-[2] rounded-[10px] py-3 text-[13.5px] font-bold text-white" style={{ background: 'var(--danger)' }}>Sí, quitar acceso</button>
            </div>
          </div>
        </Overlay>
      )}
    </>
  );
}

/** Selección de qué paquetes/combos se muestran en el portal. */
function PaquetesTab() {
  const toast = useToast();
  const [items, setItems] = useState<ItemPortal[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    setCargando(true); setError(null);
    api.get<ItemPortal[]>('/portal-admin/catalogo')
      .then((r) => { setItems(r); setCargando(false); })
      .catch((e) => { setError(e instanceof Error ? e.message : 'Error'); setCargando(false); });
  }, []);
  useEffect(cargar, [cargar]);

  async function alternar(it: ItemPortal) {
    // Se actualiza en pantalla al instante y se revierte si el servidor falla.
    setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, showInPortal: !x.showInPortal, visible: !x.showInPortal && x.price > 0 } : x)));
    try {
      const r = await api.patch<{ message: string }>(`/portal-admin/catalogo/${it.id}`, { showInPortal: !it.showInPortal });
      toast(r.message);
      cargar();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error');
      cargar();
    }
  }

  if (cargando) return <Cargando texto="Cargando paquetes…" />;
  if (error) return <ErrorCarga mensaje={error} onRetry={cargar} />;

  const visibles = items.filter((i) => i.visible).length;

  return (
    <>
      <div className="mb-3 rounded-[11px] border border-line bg-card px-4 py-3 text-[12.5px]">
        <b>{visibles}</b> de {items.length} paquetes se están mostrando en el portal.
        <span className="ml-1 text-muted">Los que no tienen precio no se publican: al paciente no se le puede ofrecer “RD$0”.</span>
      </div>

      <div className="overflow-hidden rounded-base border border-line bg-card shadow-card">
        {items.map((it) => (
          <div key={it.id} className="flex items-center gap-3 border-b border-line-2 px-4 py-3 last:border-0">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-navy-soft px-2 py-0.5 text-[10.5px] font-bold text-navy">{KIND_TAG[it.kind] ?? it.kind}</span>
                {it.code && <span className="font-mono text-[10.5px] font-bold text-faint">{it.code}</span>}
                <span className="truncate text-[13.5px] font-bold">{it.name}</span>
              </div>
              <div className="mt-0.5 text-[11.5px] text-muted">
                {it.sessions} sesiones · {it.price > 0 ? fmtRD(it.price) : <b style={{ color: 'var(--warn)' }}>sin precio</b>}
                {it.motivo && <span className="ml-1.5" style={{ color: 'var(--warn)' }}>· {it.motivo}</span>}
              </div>
            </div>
            <button onClick={() => alternar(it)} aria-label={`${it.showInPortal ? 'Quitar del' : 'Mostrar en el'} portal: ${it.name}`}
              className="relative flex h-6 w-11 flex-none items-center rounded-full transition"
              style={{ background: it.showInPortal ? 'var(--magenta)' : 'var(--line)' }}>
              <span className="absolute h-5 w-5 rounded-full bg-white transition-all" style={{ left: it.showInPortal ? 22 : 2 }} />
            </button>
          </div>
        ))}
        {items.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted">Todavía no hay paquetes ni combos en el catálogo.</div>}
      </div>
    </>
  );
}

/** Mensajes y ofertas que llegan directo al portal de la paciente. */
function MensajesTab() {
  const toast = useToast();
  const [rows, setRows] = useState<MensajePortal[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ item?: MensajePortal } | null>(null);

  const cargar = useCallback(() => {
    setCargando(true); setError(null);
    api.get<MensajePortal[]>('/portal-admin/mensajes')
      .then((r) => { setRows(r); setCargando(false); })
      .catch((e) => { setError(e instanceof Error ? e.message : 'Error'); setCargando(false); });
  }, []);
  useEffect(cargar, [cargar]);

  async function alternarActivo(m: MensajePortal) {
    try {
      const r = await api.patch<{ message: string }>(`/portal-admin/mensajes/${m.id}`, { active: !m.active });
      toast(r.message); cargar();
    } catch (e) { toast(e instanceof Error ? e.message : 'Error'); }
  }

  async function borrar(m: MensajePortal) {
    try {
      const r = await api.del<{ message: string }>(`/portal-admin/mensajes/${m.id}`);
      toast(r.message); cargar();
    } catch (e) { toast(e instanceof Error ? e.message : 'Error'); }
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-[12.5px] text-muted">Aparecen en <b>Proceso</b>, dentro del portal de la paciente.</div>
        <button onClick={() => setModal({})} className="flex-none rounded-[10px] bg-magenta px-[18px] py-2.5 text-[13.5px] font-bold text-white">+ Publicar</button>
      </div>

      {cargando ? <Cargando texto="Cargando mensajes…" /> : error ? <ErrorCarga mensaje={error} onRetry={cargar} /> : (
        <div className="flex flex-col gap-2.5">
          {rows.map((m) => {
            const meta = MSG_META[m.kind] ?? MSG_META.AVISO;
            return (
              <div key={m.id} className="rounded-base border border-line bg-card p-4 shadow-card">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="rounded-full px-2.5 py-0.5 text-[10.5px] font-bold text-white" style={{ background: meta.color }}>{meta.icon} {meta.label}</span>
                  {m.vigente
                    ? <span className="rounded-full bg-ok-soft px-2.5 py-0.5 text-[10.5px] font-bold text-ok">● Visible ahora</span>
                    : <span className="rounded-full bg-bg px-2.5 py-0.5 text-[10.5px] font-bold text-muted">○ {m.active ? 'Fuera de fecha' : 'Oculto'}</span>}
                  {!m.branchId && <span className="text-[10.5px] font-bold text-faint">Todas las sucursales</span>}
                  <span className="ml-auto text-[10.5px] text-faint">{m.creado}</span>
                </div>
                <div className="text-[13.5px] font-bold">{m.title}</div>
                <div className="mt-0.5 text-[12.5px] text-muted">{m.body}</div>
                {(m.startsAt || m.endsAt) && (
                  <div className="mt-1 text-[11px] text-faint">Vigencia: {m.startsAt ?? 'desde ya'} → {m.endsAt ?? 'sin fin'}</div>
                )}
                <div className="mt-2.5 flex flex-wrap gap-2 border-t border-line pt-2.5">
                  <button onClick={() => setModal({ item: m })} className="rounded-lg border border-line bg-bg px-3 py-1.5 text-[11.5px] font-bold text-muted hover:text-magenta">Editar</button>
                  <button onClick={() => alternarActivo(m)} className="rounded-lg border border-line bg-bg px-3 py-1.5 text-[11.5px] font-bold text-muted hover:text-magenta">
                    {m.active ? 'Ocultar del portal' : 'Mostrar en el portal'}
                  </button>
                  <button onClick={() => borrar(m)} className="rounded-lg border border-line bg-bg px-3 py-1.5 text-[11.5px] font-bold text-rose-500">Eliminar</button>
                </div>
              </div>
            );
          })}
          {rows.length === 0 && (
            <div className="rounded-base border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
              Todavía no has publicado nada. Toca <b>+ Publicar</b> para enviar una oferta o un aviso a tus pacientes.
            </div>
          )}
        </div>
      )}

      {modal && <MensajeModal item={modal.item} onClose={() => setModal(null)} onSaved={cargar} />}
    </>
  );
}

/** Alta / edición de un mensaje del portal. */
function MensajeModal({ item, onClose, onSaved }: { item?: MensajePortal; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { branches } = useBranch();
  const [kind, setKind] = useState<'OFERTA' | 'AVISO' | 'CONSEJO'>(item?.kind ?? 'OFERTA');
  const [title, setTitle] = useState(item?.title ?? '');
  const [body, setBody] = useState(item?.body ?? '');
  const [ctaLabel, setCtaLabel] = useState(item?.ctaLabel ?? '');
  const [ctaLink, setCtaLink] = useState(item?.ctaLink ?? '');
  const [branchId, setBranchId] = useState(item?.branchId ?? '');
  const [startsAt, setStartsAt] = useState(item?.startsAt ?? '');
  const [endsAt, setEndsAt] = useState(item?.endsAt ?? '');
  const [busy, setBusy] = useState(false);

  async function guardar() {
    if (!title.trim()) { toast('Escribe un título'); return; }
    if (!body.trim()) { toast('Escribe el mensaje'); return; }
    setBusy(true);
    const payload = {
      kind, title: title.trim(), body: body.trim(),
      ctaLabel: ctaLabel.trim() || undefined,
      ctaLink: ctaLink.trim() || undefined,
      branchId: branchId || null,
      startsAt: startsAt || undefined,
      endsAt: endsAt || undefined,
    };
    try {
      const r = item
        ? await api.patch<{ message: string }>(`/portal-admin/mensajes/${item.id}`, payload)
        : await api.post<{ message: string }>('/portal-admin/mensajes', payload);
      toast(r.message);
      onSaved(); onClose();
    } catch (e) { toast(e instanceof Error ? e.message : 'Error'); } finally { setBusy(false); }
  }

  const inputCls = 'rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta';

  return (
    <Overlay onClose={onClose} z={120}>
      <div onClick={stop} className="w-[470px] max-w-full overflow-hidden rounded-2xl bg-card animate-pop" style={{ boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
        <div className="flex items-center border-b border-line px-4 py-4 sm:px-6">
          <div className="flex-1 text-base font-extrabold">{item ? 'Editar publicación' : 'Publicar en el portal'}</div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg bg-bg text-muted">×</button>
        </div>

        <div className="flex max-h-[70vh] flex-col gap-3.5 overflow-y-auto px-4 py-5 sm:px-6">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-bold text-muted">Tipo</span>
            <div className="grid grid-cols-3 gap-2">
              {(['OFERTA', 'AVISO', 'CONSEJO'] as const).map((k) => {
                const on = kind === k; const meta = MSG_META[k];
                return (
                  <button key={k} type="button" onClick={() => setKind(k)}
                    className="flex flex-col items-center gap-1 rounded-[10px] border py-2.5 text-[12px] font-bold"
                    style={{ borderColor: on ? 'var(--magenta)' : 'var(--line)', background: on ? 'var(--magenta-soft)' : 'var(--card)', color: on ? 'var(--magenta)' : 'var(--muted)' }}>
                    <span className="text-[16px]">{meta.icon}</span>{meta.label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Título</span>
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80}
              placeholder={kind === 'OFERTA' ? 'Ej. 20% en tu próximo combo' : 'Ej. Horario especial de fin de año'} />
          </label>

          <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Mensaje</span>
            <textarea className={`${inputCls} resize-none`} rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={500}
              placeholder="Escríbelo como se lo dirías a la paciente." />
            <span className="text-[11px] text-faint">{body.length}/500</span>
          </label>

          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="flex flex-1 flex-col gap-1.5"><span className="text-xs font-bold text-muted">Texto del botón (opcional)</span>
              <input className={inputCls} value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} maxLength={30} placeholder="Ej. Reservar ahora" />
            </label>
            <label className="flex flex-1 flex-col gap-1.5"><span className="text-xs font-bold text-muted">Enlace (opcional)</span>
              <input className={inputCls} value={ctaLink} onChange={(e) => setCtaLink(e.target.value)} placeholder="https://…" />
            </label>
          </div>

          <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">¿A qué sucursal?</span>
            <select className={`${inputCls} bg-card`} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">Todas las sucursales</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>

          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="flex flex-1 flex-col gap-1.5"><span className="text-xs font-bold text-muted">Desde (opcional)</span>
              <input type="date" className={inputCls} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </label>
            <label className="flex flex-1 flex-col gap-1.5"><span className="text-xs font-bold text-muted">Hasta (opcional)</span>
              <input type="date" className={inputCls} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </label>
          </div>

          {/* Vista previa: lo que verá la paciente en su portal. */}
          <div>
            <div className="mb-1.5 text-xs font-bold text-muted">Así lo verá la paciente</div>
            <div className="rounded-[16px] p-4"
              style={kind === 'OFERTA'
                ? { background: 'linear-gradient(135deg,#B31C86,#8E1268)', color: '#fff' }
                : { background: 'var(--magenta-soft)', border: '1px solid var(--magenta)' }}>
              <div className="mb-1 flex items-center gap-1.5">
                <span className="text-[13px]">{MSG_META[kind].icon}</span>
                <span className="text-[13.5px] font-extrabold" style={{ color: kind === 'OFERTA' ? '#fff' : 'var(--magenta)' }}>{title || 'Título del mensaje'}</span>
              </div>
              <div className="text-[12.5px] leading-normal" style={{ color: kind === 'OFERTA' ? 'rgba(255,255,255,.92)' : 'var(--muted)' }}>{body || 'Aquí va el mensaje que leerá la paciente.'}</div>
              {ctaLabel && (
                <div className="mt-2.5 rounded-[10px] py-2.5 text-center text-[12.5px] font-bold"
                  style={kind === 'OFERTA' ? { background: '#fff', color: 'var(--magenta)' } : { background: 'var(--magenta)', color: '#fff' }}>{ctaLabel}</div>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-2.5 border-t border-line px-4 py-4 sm:px-6">
          <button onClick={onClose} className="flex-1 rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">Cancelar</button>
          <button onClick={guardar} disabled={busy} className="flex-[2] rounded-[10px] bg-magenta py-3 text-[13.5px] font-bold text-white disabled:opacity-60">
            {busy ? 'Publicando…' : item ? 'Guardar cambios' : 'Publicar'}
          </button>
        </div>
      </div>
    </Overlay>
  );
}
