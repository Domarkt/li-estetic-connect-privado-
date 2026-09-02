import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/Toast';
import { Overlay, stop } from '../../components/Modal';
import { fmtRD, type CatalogItem } from '../../lib/types';

type Step = 'modo' | 'items' | 'detalle';
const KIND_TAG: Record<string, string> = { SERVICIO: 'Servicio', PAQUETE: 'Paquete', COMBO: 'Combo', PRODUCTO: 'Producto' };

/**
 * Asistente paso a paso para cargar servicios/combos a la ficha de un paciente:
 *   1) ¿Qué vas a cargar? (nuevo para cobrar  vs  plan ya pagado antes del sistema)  — solo Admin/Recepción
 *   2) Elegir el/los ítems del catálogo (con buscador)
 *   3) Detalle del plan histórico (sesiones restantes, saldo y "restan" por técnica)  — solo histórico
 * Una sola tarea por pantalla: antes todo iba apilado en un modal que se cortaba.
 */
export default function AddServicesModal({ patientId, canBillNow, onClose, onSaved, afterAdd }: { patientId: string; canBillNow?: boolean; onClose: () => void; onSaved: () => void; afterAdd?: (patientId: string) => void }) {
  const toast = useToast();
  const { staff } = useAuth();
  const canHistorical = staff?.role === 'ADMIN' || staff?.role === 'RECEPCIONISTA';

  const [items, setItems] = useState<CatalogItem[]>([]);
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'normal' | 'historico'>('normal');
  const [step, setStep] = useState<Step>(canHistorical ? 'modo' : 'items');
  const [remainingSessions, setRemainingSessions] = useState('');
  const [outstandingBalance, setOutstandingBalance] = useState('0');
  const [remainingTechniques, setRemainingTechniques] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const historical = mode === 'historico';

  useEffect(() => {
    api.get<CatalogItem[]>('/catalog').then((all) =>
      setItems(all.filter((i) => i.kind === 'PAQUETE' || i.kind === 'COMBO' || i.kind === 'SERVICIO' || i.kind === 'PRODUCTO')),
    );
  }, []);

  // Pasos activos (para el indicador "Paso X de N").
  const steps: Step[] = canHistorical ? (historical ? ['modo', 'items', 'detalle'] : ['modo', 'items']) : ['items'];
  const stepNo = steps.indexOf(step) + 1;

  const selectedItem = useMemo(() => items.find((it) => cart.has(it.id)) ?? null, [items, cart]);
  const tecnicas = selectedItem?.services ?? [];

  const visibles = items
    .filter((it) => !historical || it.kind !== 'PRODUCTO')
    .filter((it) => { const q = query.trim().toLowerCase(); return !q || it.name.toLowerCase().includes(q) || (it.code ?? '').toLowerCase().includes(q); });

  const toggle = (id: string) => {
    if (historical) { setCart((current) => (current.has(id) ? new Set() : new Set([id]))); setRemainingTechniques({}); return; }
    setCart((current) => { const n = new Set(current); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const elegirModo = (m: 'normal' | 'historico') => {
    setMode(m);
    setCart(new Set()); setQuery(''); setRemainingSessions(''); setOutstandingBalance('0'); setRemainingTechniques({});
    setStep('items');
  };

  function irADetalle() {
    if (cart.size !== 1) { toast('Elige el plan (uno solo) que ya pagó'); return; }
    setStep('detalle');
  }

  async function send() {
    if (!cart.size) { toast('Selecciona al menos un servicio o producto'); return; }
    if (historical && (!remainingSessions || Number(remainingSessions) < 1)) { toast('Indica cuántas sesiones le quedan'); return; }
    if (historical && tecnicas.length) {
      const invalid = tecnicas.some((service) => {
        const raw = remainingTechniques[service.id];
        const remaining = Number(raw);
        return raw === undefined || raw === '' || !Number.isInteger(remaining) || remaining < 0 || remaining > (service.qty ?? 0);
      });
      if (invalid) { toast('Indica cuánto queda de cada servicio, sin superar lo incluido'); return; }
    }
    setBusy(true);
    try {
      const r = historical
        ? await api.post<{ message: string }>(`/patients/${patientId}/historical-treatment`, {
            catalogItemId: [...cart][0], remainingSessions: Number(remainingSessions), outstandingBalance: Number(outstandingBalance) || 0,
            remainingTechniques: tecnicas.map((service) => ({ serviceId: service.id, remaining: Number(remainingTechniques[service.id]) })),
          })
        : await api.post<{ message: string }>(`/patients/${patientId}/charges`, { catalogItemIds: [...cart] });
      toast(r.message);
      onSaved();
      onClose();
      // Recepción/Admin: pasa directo a cobrar para asegurar el pago antes de que el cliente se vaya.
      if (!historical && canBillNow && afterAdd) afterAdd(patientId);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  const subtitle = step === 'modo'
    ? 'Elige qué tipo de carga vas a hacer'
    : step === 'detalle'
      ? 'Ajusta lo que todavía le queda del plan ya pagado'
      : historical
        ? 'Elige el plan que el paciente ya pagó (uno solo)'
        : canBillNow ? 'Selecciona lo que eligió el paciente · pasarás a cobrar de inmediato' : 'Selecciona lo que eligió el paciente · se enviará a recepción para facturar';

  return (
    <Overlay onClose={onClose} z={120}>
      <div onClick={stop} className="flex max-h-[92vh] w-[480px] max-w-full flex-col overflow-hidden rounded-2xl bg-card animate-pop" style={{ boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
        {/* Encabezado + progreso */}
        <div className="flex-none border-b border-line px-6 py-5">
          <div className="flex items-center gap-2">
            <div className="flex-1 text-base font-extrabold">Agregar servicios / productos</div>
            {steps.length > 1 && <div className="flex-none text-[11.5px] font-bold text-muted">Paso {stepNo} de {steps.length}</div>}
          </div>
          <div className="mt-0.5 text-[12.5px] text-muted">{subtitle}</div>
          {steps.length > 1 && (
            <div className="mt-3 flex gap-1.5">
              {steps.map((s, i) => (
                <span key={s} className="h-1.5 flex-1 rounded-full transition-colors" style={{ background: i < stepNo ? 'var(--magenta)' : 'var(--line)' }} />
              ))}
            </div>
          )}
        </div>

        {/* PASO 1 — ¿Qué vas a cargar? */}
        {step === 'modo' && (
          <div className="flex flex-col gap-3 px-6 py-6">
            <button onClick={() => elegirModo('normal')}
              className="flex items-start gap-3 rounded-xl border px-4 py-4 text-left transition hover:border-magenta"
              style={{ borderColor: 'var(--line)', background: 'var(--card)' }}>
              <span className="mt-0.5 text-[20px]">🛒</span>
              <span><span className="block text-[14px] font-extrabold text-navy">Servicio o combo nuevo</span><span className="mt-0.5 block text-[12px] leading-normal text-muted">Lo que el paciente va a comprar ahora. {canBillNow ? 'Pasarás a cobrarlo de inmediato.' : 'Se envía a recepción para facturar.'}</span></span>
            </button>
            <button onClick={() => elegirModo('historico')}
              className="flex items-start gap-3 rounded-xl border px-4 py-4 text-left transition hover:border-magenta"
              style={{ borderColor: 'var(--line)', background: 'var(--card)' }}>
              <span className="mt-0.5 text-[20px]">🗂️</span>
              <span><span className="block text-[14px] font-extrabold text-navy">Plan ya pagado antes del sistema</span><span className="mt-0.5 block text-[12px] leading-normal text-muted">Carga sus sesiones y el saldo que todavía debe. No crea una venta histórica ni comisión.</span></span>
            </button>
          </div>
        )}

        {/* PASO 2 — Elegir ítems (con buscador) */}
        {step === 'items' && (
          <>
            <div className="flex-none px-6 pt-4">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔍 Buscar servicio, combo o paquete…"
                className="w-full rounded-[10px] border border-line px-3.5 py-2.5 text-[13px] outline-none focus:border-magenta" />
            </div>
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-6 py-4">
              {visibles.map((it) => {
                const on = cart.has(it.id);
                return (
                  <div key={it.id} onClick={() => toggle(it.id)}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3"
                    style={{ borderColor: on ? 'var(--magenta)' : 'var(--line)', background: on ? 'var(--magenta-soft)' : 'var(--card)' }}>
                    <span className="flex h-5 w-5 flex-none items-center justify-center rounded-md text-[11px] font-extrabold text-white" style={{ background: on ? 'var(--magenta)' : 'var(--line)' }}>✓</span>
                    <div className="min-w-0 flex-1"><div className="truncate text-[13.5px] font-bold">{it.name}</div><div className="text-[11.5px] text-muted">{KIND_TAG[it.kind] ?? it.kind}</div></div>
                    <div className="flex-none text-[13.5px] font-extrabold text-magenta">{it.price ? fmtRD(it.price) : <span className="text-[12px] text-muted">Sin precio</span>}</div>
                  </div>
                );
              })}
              {visibles.length === 0 && <div className="py-8 text-center text-[12.5px] text-muted">{items.length === 0 ? 'Cargando catálogo…' : 'Sin coincidencias.'}</div>}
            </div>
          </>
        )}

        {/* PASO 3 — Detalle del plan histórico */}
        {step === 'detalle' && (
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
            <div className="rounded-[10px] border border-magenta bg-magenta-soft px-3.5 py-2.5 text-[12.5px] font-semibold" style={{ color: 'var(--magenta-d)' }}>
              {selectedItem?.name}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Sesiones que le quedan</span><input value={remainingSessions} onChange={(e) => setRemainingSessions(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="Ej. 6" className="rounded-[9px] border border-line bg-card px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" /></label>
              <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Saldo pendiente actual</span><input value={outstandingBalance} onChange={(e) => setOutstandingBalance(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="0 = pagado" className="rounded-[9px] border border-line bg-card px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" /></label>
            </div>
            {tecnicas.length > 0 && (
              <div className="rounded-[10px] border border-line bg-bg p-3.5">
                <div className="mb-1 text-[12.5px] font-extrabold">Servicios que todavía le quedan</div>
                <div className="mb-3 text-[11.5px] text-muted">Escribe la cantidad real restante de cada técnica. Usa 0 si ya la consumió completa.</div>
                <div className="flex flex-col gap-2.5">
                  {tecnicas.map((service) => (
                    <label key={service.id} className="grid grid-cols-[1fr_95px] items-center gap-3">
                      <span className="text-[12.5px] font-semibold">{service.name} <span className="text-[11px] font-normal text-faint">de {service.qty ?? 0}</span></span>
                      <input value={remainingTechniques[service.id] ?? ''} onChange={(e) => setRemainingTechniques((current) => ({ ...current, [service.id]: e.target.value.replace(/\D/g, '') }))} inputMode="numeric" placeholder="Restan" className="rounded-[8px] border border-line bg-card px-2.5 py-2 text-center text-[13px] font-bold outline-none focus:border-magenta" />
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="text-[11.5px] font-semibold text-ok">RD$0 significa pagado. Un saldo mayor aparecerá listo para recibir abonos, sin registrar una venta anterior.</div>
          </div>
        )}

        {/* Pie: navegación del asistente */}
        <div className="flex flex-none items-center gap-2.5 border-t border-line px-6 py-4">
          {step === 'items' && !historical && <div className="flex-1 text-[12.5px] font-semibold text-muted">{cart.size} seleccionado(s)</div>}
          {(step === 'items' || step === 'detalle') && canHistorical ? (
            <button onClick={() => setStep(step === 'detalle' ? 'items' : 'modo')} className="rounded-[10px] border border-line bg-card px-4 py-3 text-[13.5px] font-bold text-muted">← Atrás</button>
          ) : (
            <button onClick={onClose} className="rounded-[10px] border border-line bg-card px-4 py-3 text-[13.5px] font-bold text-muted">Cancelar</button>
          )}
          {step === 'modo' && <div className="flex-1" />}
          {step === 'items' && historical && (
            <button onClick={irADetalle} disabled={cart.size !== 1} className="rounded-[10px] bg-magenta px-[18px] py-3 text-[13.5px] font-bold text-white disabled:opacity-60">Siguiente →</button>
          )}
          {step === 'items' && !historical && (
            <button onClick={send} disabled={busy || cart.size === 0} className="rounded-[10px] bg-magenta px-[18px] py-3 text-[13.5px] font-bold text-white disabled:opacity-60">{canBillNow ? 'Agregar y cobrar →' : 'Enviar a recepción →'}</button>
          )}
          {step === 'detalle' && (
            <button onClick={send} disabled={busy} className="rounded-[10px] bg-magenta px-[18px] py-3 text-[13.5px] font-bold text-white disabled:opacity-60">{busy ? 'Guardando…' : 'Guardar saldo anterior'}</button>
          )}
        </div>
      </div>
    </Overlay>
  );
}
