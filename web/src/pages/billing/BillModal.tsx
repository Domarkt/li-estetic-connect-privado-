import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { Overlay, stop } from '../../components/Modal';
import { fmtRD, type BillPatient, type CatalogItem, type PaymentMethod, type Receipt } from '../../lib/types';

const KIND_TAG: Record<string, string> = { SERVICIO: 'Servicio', PAQUETE: 'Paquete', COMBO: 'Combo' };

// Azul se retiró: los pagos con tarjeta (incluida Azul) entran en "Tarjeta".
type Metodo = 'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA';
const METHODS: Metodo[] = ['EFECTIVO', 'TRANSFERENCIA', 'TARJETA'];
const METHOD_LABEL: Record<string, string> = { EFECTIVO: 'Efectivo', TRANSFERENCIA: 'Transferencia', TARJETA: 'Tarjeta', AZUL: 'Azul' };
const METHOD_ICON: Record<Metodo, string> = { EFECTIVO: '💵', TRANSFERENCIA: '🏦', TARJETA: '💳' };

type PayKind = 'TOTAL' | 'ABONO' | 'SALDO';
const KIND_LABEL: Record<PayKind, string> = { TOTAL: 'Pago total', ABONO: 'Abono', SALDO: 'Saldo pendiente' };

const num = (v: string) => parseInt((v || '').replace(/[^0-9]/g, ''), 10) || 0;

// Cada línea es independiente (se puede repetir el mismo servicio): tiene su cantidad.
interface CartItem { lineId: string; catalogId: string; name: string; price: number; qty: number }
interface Props { preselectId?: string; onClose: () => void; onEmitted: (r: Receipt) => void }

let lineSeq = 0;

export default function BillModal({ preselectId, onClose, onEmitted }: Props) {
  const toast = useToast();
  const [patients, setPatients] = useState<BillPatient[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [selected, setSelected] = useState<string | null>(preselectId ?? null);
  const [concept, setConcept] = useState(''); // concepto derivado (tratamiento/cargos)
  const [cart, setCart] = useState<CartItem[]>([]); // varios servicios en un recibo
  const [amount, setAmount] = useState(''); // monto a abonar (solo en ABONO)
  const [chargeIds, setChargeIds] = useState<string[]>([]);
  const [treatmentId, setTreatmentId] = useState<string | null>(null);
  const [payKind, setPayKind] = useState<PayKind>('TOTAL');

  const [method, setMethod] = useState<Metodo>('EFECTIVO');
  const [splitOn, setSplitOn] = useState(false);
  const [split, setSplit] = useState<Record<Metodo, string>>({ EFECTIVO: '', TRANSFERENCIA: '', TARJETA: '' });

  const [step, setStep] = useState<'form' | 'review'>('form');
  const [busy, setBusy] = useState(false);
  const [pQuery, setPQuery] = useState('');
  const [sQuery, setSQuery] = useState('');
  const [loadingP, setLoadingP] = useState(true);
  const [errP, setErrP] = useState(false);

  const current = patients.find((p) => p.id === selected) ?? null;
  const t = current?.treatment ?? null;
  const hasBalance = !!t && t.balance > 0;
  const hasCharges = chargeIds.length > 0;
  const derivado = !!(t || hasCharges); // concepto tomado de registros del paciente
  const usingCart = !derivado && cart.length > 0;

  function loadPatients() {
    setLoadingP(true); setErrP(false);
    api.get<BillPatient[]>('/invoices/patients').then((ps) => {
      setPatients(ps); setLoadingP(false);
      if (preselectId) applyPatient(ps.find((p) => p.id === preselectId));
    }).catch(() => { setLoadingP(false); setErrP(true); });
  }
  useEffect(() => {
    loadPatients();
    api.get<CatalogItem[]>('/catalog').then((all) => setCatalog(all.filter((i) => i.kind === 'SERVICIO' || i.kind === 'PAQUETE' || i.kind === 'COMBO'))).catch(() => setCatalog([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Agregar un servicio al carrito. Se permite repetir (una para ella, otra para su pareja).
  function addToCart(item: CatalogItem) {
    setSQuery('');
    setCart((c) => [...c, { lineId: `l${++lineSeq}`, catalogId: item.id, name: item.name, price: item.price || 0, qty: 1 }]);
  }
  const patchLine = (lineId: string, patch: Partial<CartItem>) => setCart((c) => c.map((x) => (x.lineId === lineId ? { ...x, ...patch } : x)));
  const removeItem = (lineId: string) => setCart((c) => c.filter((x) => x.lineId !== lineId));

  const filteredPatients = patients.filter((p) => {
    const q = pQuery.trim().toLowerCase();
    return !q || p.name.toLowerCase().includes(q) || (p.phone ?? '').includes(q);
  });
  const filteredCatalog = catalog.filter((c) => {
    const q = sQuery.trim().toLowerCase();
    return !q || c.name.toLowerCase().includes(q);
  });

  function applyPatient(p?: BillPatient) {
    if (!p) return;
    setSelected(p.id); setCart([]); setSQuery('');
    if (p.pendingCharges.length) {
      setConcept(p.pendingCharges.map((c) => c.name).join(' + '));
      setChargeIds(p.pendingCharges.map((c) => c.id)); setTreatmentId(null); setPayKind('TOTAL'); setAmount('');
    } else if (p.treatment && p.treatment.balance > 0) {
      setConcept(`Saldo ${p.treatment.name}`); setTreatmentId(p.treatment.id);
      setPayKind('SALDO'); setChargeIds([]); setAmount(String(p.treatment.balance));
    } else {
      setConcept(''); setTreatmentId(null); setPayKind('TOTAL'); setChargeIds([]); setAmount('');
    }
    setSplit({ EFECTIVO: '', TRANSFERENCIA: '', TARJETA: '' });
  }

  function setKind(k: PayKind) {
    setPayKind(k);
    if (t) {
      if (k === 'SALDO') setAmount(String(t.balance));
      else if (k === 'TOTAL') setAmount(String(t.price));
      else setAmount('');
    } else if (hasCharges) {
      if (k === 'TOTAL') setAmount(String(current?.pendingTotal ?? 0));
      else setAmount('');
    } else {
      setAmount(''); // carrito: en TOTAL el monto es el total del carrito
    }
  }

  const cartTotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  // Monto a cobrar según el caso:
  const amt = usingCart
    ? (payKind === 'ABONO' ? num(amount) : cartTotal)
    : num(amount);
  const fullAmt = usingCart ? cartTotal : 0;
  const freeAbono = payKind === 'ABONO' && usingCart;
  const freePending = Math.max(0, fullAmt - amt);
  const finalConcept = derivado ? concept : cart.map((c) => (c.qty > 1 ? `${c.qty}× ${c.name}` : c.name)).join(' + ');

  const splitAssigned = METHODS.reduce((s, m) => s + num(split[m]), 0);
  const assigned = splitOn ? splitAssigned : amt;
  const remaining = amt - assigned;
  const paymentsList: { method: PaymentMethod; amount: number }[] = splitOn
    ? METHODS.map((m) => ({ method: m as PaymentMethod, amount: num(split[m]) })).filter((p) => p.amount > 0)
    : (amt > 0 ? [{ method: method as PaymentMethod, amount: amt }] : []);
  const balanceAfter = t ? Math.max(0, t.balance - amt) : 0;

  function validate(): string | null {
    if (!derivado && cart.length === 0) return 'Agrega al menos un servicio';
    const sinPrecio = cart.find((c) => c.price <= 0);
    if (sinPrecio) return `Escribe el precio de: ${sinPrecio.name}`;
    if (!finalConcept.trim()) return 'Elige un servicio o paquete';
    if (!amt) return 'Escribe el monto a cobrar';
    if (freeAbono && amt >= cartTotal) return 'El abono debe ser menor que el total del carrito';
    if (splitOn && assigned !== amt) return `El pago dividido (${fmtRD(assigned)}) debe sumar el total (${fmtRD(amt)})`;
    return null;
  }

  function goReview() {
    const err = validate();
    if (err) { toast(err); return; }
    setStep('review');
  }

  async function emit() {
    setBusy(true);
    try {
      const r = await api.post<{ receipt: Receipt; message: string }>('/invoices', {
        patientId: selected ?? undefined, concept: finalConcept.trim(),
        payments: paymentsList, treatmentId: treatmentId ?? undefined,
        paymentKind: (treatmentId || chargeIds.length || freeAbono) ? payKind : 'TOTAL',
        chargeItemIds: chargeIds.length ? chargeIds : undefined,
        items: usingCart ? cart.map((c) => ({ name: c.name, price: c.price, qty: c.qty, catalogItemId: c.catalogId })) : undefined,
        fullAmount: freeAbono ? cartTotal : undefined,
      });
      toast(r.message); onEmitted(r.receipt); onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al emitir');
    } finally { setBusy(false); }
  }

  return (
    <Overlay onClose={onClose} z={110}>
      <div onClick={stop} className="flex max-h-[92vh] w-[480px] max-w-full flex-col overflow-hidden rounded-2xl bg-card animate-pop" style={{ boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
        <div className="flex flex-none items-center border-b border-line px-6 py-4">
          <div className="flex-1 text-base font-extrabold">{step === 'form' ? 'Registrar cobro' : 'Confirmar cobro'}</div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg bg-bg text-muted">×</button>
        </div>

        {step === 'form' ? (
          <div className="flex flex-col gap-4 overflow-y-auto px-6 py-5">
            {/* 1 · Paciente */}
            <div>
              <span className="mb-1.5 block text-xs font-bold text-muted">Paciente</span>
              {current ? (
                <div className="flex items-center gap-2.5 rounded-[11px] border border-magenta bg-magenta-soft px-3 py-2.5">
                  <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-[11.5px] font-bold text-white" style={{ background: current.avatarColor }}>{current.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</div>
                  <div className="min-w-0 flex-1"><div className="text-[13.5px] font-bold">{current.name}</div><div className="text-[11.5px] text-muted">{current.plan}{current.balance > 0 ? ` · saldo ${fmtRD(current.balance)}` : ''}</div></div>
                  <button onClick={() => { setSelected(null); setConcept(''); setChargeIds([]); setTreatmentId(null); setCart([]); }} className="rounded-lg px-2 py-1 text-[12px] font-bold text-magenta">Cambiar</button>
                </div>
              ) : (
                <>
                  <input value={pQuery} onChange={(e) => setPQuery(e.target.value)} placeholder="🔍 Buscar por nombre o teléfono…"
                    className="mb-1.5 w-full rounded-[9px] border border-line px-3 py-2.5 text-[13px] outline-none focus:border-magenta" />
                  <div className="flex max-h-[130px] flex-col gap-1.5 overflow-y-auto rounded-[11px] border border-line-2 p-2">
                    {loadingP && <div className="px-2.5 py-3 text-center text-[12.5px] text-muted">Cargando pacientes…</div>}
                    {errP && <button onClick={loadPatients} className="px-2.5 py-3 text-center text-[12.5px] font-bold text-magenta">No se pudieron cargar. Toca para reintentar.</button>}
                    {!loadingP && !errP && filteredPatients.length === 0 && (
                      <div className="px-2.5 py-3 text-center text-[12.5px] text-muted">{patients.length === 0 ? 'No hay pacientes en esta sucursal todavía.' : 'Sin coincidencias.'}</div>
                    )}
                    {filteredPatients.map((p) => {
                      const initials = p.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
                      return (
                        <div key={p.id} onClick={() => applyPatient(p)} className="flex cursor-pointer items-center gap-2.5 rounded-[9px] px-2.5 py-2 hover:bg-bg">
                          <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-[11.5px] font-bold text-white" style={{ background: p.avatarColor }}>{initials}</div>
                          <div className="min-w-0 flex-1"><div className="text-[13px] font-bold">{p.name}</div><div className="text-[11.5px] text-muted">{p.plan}{p.balance > 0 ? ` · saldo ${fmtRD(p.balance)}` : ''}</div></div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* 2 · Servicios */}
            <div>
              <span className="mb-1.5 block text-xs font-bold text-muted">Servicios a cobrar</span>
              {derivado ? (
                <>
                  <div className="rounded-[11px] border border-line-2 bg-bg px-3.5 py-3 text-[13.5px] font-semibold">{concept || '—'}</div>
                  <span className="mt-1 block text-[11px] text-faint">Tomado de los servicios/tratamiento ya registrados del paciente.</span>
                </>
              ) : (
                <>
                  {/* Carrito: uno o varios servicios en el mismo recibo */}
                  {cart.length > 0 && (
                    <div className="mb-2 flex flex-col gap-2 rounded-[11px] border border-line-2 p-2">
                      {cart.map((it) => (
                        <div key={it.lineId} className="flex flex-col gap-1.5 rounded-[9px] bg-bg p-2">
                          <div className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-[13px] font-bold">{it.name}</span>
                            <button onClick={() => removeItem(it.lineId)} className="flex-none rounded-md px-1.5 text-[15px] font-bold text-muted hover:text-danger">×</button>
                          </div>
                          <div className="flex items-center gap-2">
                            {/* Cantidad */}
                            <div className="flex items-center rounded-[8px] border border-line bg-card">
                              <button onClick={() => patchLine(it.lineId, { qty: Math.max(1, it.qty - 1) })} className="px-2.5 py-1 text-[15px] font-bold text-muted">−</button>
                              <span className="w-6 text-center text-[13px] font-bold">{it.qty}</span>
                              <button onClick={() => patchLine(it.lineId, { qty: it.qty + 1 })} className="px-2.5 py-1 text-[15px] font-bold text-muted">+</button>
                            </div>
                            {/* Precio unitario */}
                            <div className="flex flex-1 items-center rounded-[8px] border border-line bg-card px-2">
                              <span className="text-[11px] font-bold text-faint">RD$</span>
                              <input value={it.price ? String(it.price) : ''} onChange={(e) => patchLine(it.lineId, { price: num(e.target.value) })} inputMode="numeric" placeholder="precio"
                                className="w-full bg-transparent px-1 py-1.5 text-right text-[13px] font-bold outline-none" />
                            </div>
                            {it.qty > 1 && <span className="flex-none text-[12px] font-bold text-magenta">{fmtRD(it.price * it.qty)}</span>}
                          </div>
                        </div>
                      ))}
                      <div className="flex justify-between border-t border-line-2 pt-1.5 text-[13px]"><span className="font-bold text-muted">Total</span><span className="font-extrabold text-magenta">{fmtRD(cartTotal)}</span></div>
                    </div>
                  )}
                  <input value={sQuery} onChange={(e) => setSQuery(e.target.value)} placeholder="🔍 Buscar y agregar servicio…"
                    className="mb-1.5 w-full rounded-[9px] border border-line px-3 py-2.5 text-[13px] outline-none focus:border-magenta" />
                  {(sQuery || cart.length === 0) && (
                    <div className="flex max-h-[150px] flex-col gap-1 overflow-y-auto rounded-[11px] border border-line-2 p-2">
                      {catalog.length === 0 && <div className="px-2.5 py-3 text-center text-[12.5px] text-muted">No hay servicios en el catálogo. Créalos en Catálogo.</div>}
                      {catalog.length > 0 && filteredCatalog.length === 0 && <div className="px-2.5 py-3 text-center text-[12.5px] text-muted">Sin coincidencias.</div>}
                      {filteredCatalog.map((c) => (
                        <button key={c.id} onClick={() => addToCart(c)} className="flex items-center gap-2 rounded-[9px] px-2.5 py-2 text-left hover:bg-bg">
                          <span className="rounded-full bg-navy-soft px-2 py-0.5 text-[10.5px] font-bold text-navy">{KIND_TAG[c.kind] ?? c.kind}</span>
                          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{c.name}</span>
                          <span className="flex-none text-[12.5px] font-bold text-magenta">{c.price ? fmtRD(c.price) : 'sin precio'}</span>
                          <span className="flex-none text-[15px] font-bold text-magenta">+</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* 3 · Tipo de pago */}
            {(selected || derivado) && (usingCart || derivado) && (
              <div>
                <span className="mb-1.5 block text-xs font-bold text-muted">Tipo de pago</span>
                <div className="flex gap-2">
                  {(['TOTAL', 'ABONO', 'SALDO'] as const).map((k) => {
                    const on = payKind === k;
                    const disabled = (k === 'SALDO' && !hasBalance) || (k === 'ABONO' && !selected);
                    return (
                      <button key={k} onClick={() => !disabled && setKind(k)} disabled={disabled}
                        className="flex-1 rounded-[9px] border py-2 text-[11.5px] font-bold disabled:opacity-40"
                        style={{ borderColor: on ? 'var(--magenta)' : 'var(--line)', background: on ? 'var(--magenta-soft)' : 'var(--card)', color: on ? 'var(--magenta)' : 'var(--muted)' }}>
                        {KIND_LABEL[k]}
                      </button>
                    );
                  })}
                </div>
                {t && (payKind === 'ABONO' || payKind === 'SALDO') && (
                  <div className="mt-2 rounded-md bg-bg px-2.5 py-1.5 text-[11.5px] text-muted">Saldo actual: <b style={{ color: 'var(--danger)' }}>{fmtRD(t.balance)}</b> de {fmtRD(t.price)}. Tras el pago quedaría <b>{fmtRD(balanceAfter)}</b>.</div>
                )}
                {freeAbono && amt > 0 && (
                  <div className="mt-2 rounded-md bg-bg px-2.5 py-1.5 text-[11.5px] text-muted">Abono de <b>{fmtRD(amt)}</b> de <b>{fmtRD(cartTotal)}</b> · queda pendiente <b style={{ color: 'var(--danger)' }}>{fmtRD(freePending)}</b>.</div>
                )}
              </div>
            )}

            {/* 4 · Monto: total del carrito (TOTAL) o campo de abono/derivado */}
            {usingCart && payKind === 'TOTAL' ? (
              <div className="flex items-center justify-between rounded-[11px] border-2 border-magenta bg-magenta-soft px-4 py-3">
                <span className="text-[13px] font-bold text-muted">Total a cobrar · ITBIS incl.</span>
                <span className="text-[22px] font-extrabold text-magenta">{fmtRD(cartTotal)}</span>
              </div>
            ) : (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-muted">{freeAbono ? 'Monto a abonar' : 'Monto a cobrar'} <span className="font-semibold text-faint">· ITBIS 18% incluido</span></span>
                <div className="flex items-center rounded-[11px] border-2 border-line px-3.5 focus-within:border-magenta">
                  <span className="text-[15px] font-bold text-muted">RD$</span>
                  <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="0"
                    className="w-full bg-transparent px-2 py-3 text-[20px] font-extrabold outline-none placeholder:text-faint" />
                </div>
              </label>
            )}

            {/* 5 · Forma de pago */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-bold text-muted">¿Cómo paga?</span>
                <button onClick={() => setSplitOn((v) => !v)} className="text-[11.5px] font-bold text-magenta">{splitOn ? '← Un solo método' : 'Dividir pago'}</button>
              </div>
              {!splitOn ? (
                <div className="grid grid-cols-3 gap-2">
                  {METHODS.map((m) => {
                    const on = method === m;
                    return (
                      <button key={m} onClick={() => setMethod(m)}
                        className="flex flex-col items-center gap-1 rounded-[11px] border py-2.5 text-[12px] font-bold"
                        style={{ borderColor: on ? 'var(--magenta)' : 'var(--line)', background: on ? 'var(--magenta-soft)' : 'var(--card)', color: on ? 'var(--magenta)' : 'var(--muted)' }}>
                        <span className="text-[18px]">{METHOD_ICON[m]}</span>{METHOD_LABEL[m]}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <>
                  <div className="mb-1.5 text-right text-[11.5px] font-bold" style={{ color: remaining === 0 ? 'var(--ok)' : 'var(--warn)' }}>{fmtRD(assigned)} / {fmtRD(amt)}{remaining !== 0 ? ` · falta ${fmtRD(remaining)}` : ' ✓'}</div>
                  <div className="flex flex-col gap-2">
                    {METHODS.map((m) => (
                      <div key={m} className="flex items-center gap-2">
                        <button onClick={() => setSplit({ EFECTIVO: '', TRANSFERENCIA: '', TARJETA: '', [m]: String(amt) })} title="Poner todo aquí" className="w-[130px] rounded-[9px] border border-line bg-bg px-2 py-2 text-left text-[12px] font-bold text-navy hover:border-magenta">{METHOD_ICON[m]} {METHOD_LABEL[m]}</button>
                        <input value={split[m]} onChange={(e) => setSplit({ ...split, [m]: e.target.value.replace(/[^0-9]/g, '') })} inputMode="numeric" placeholder="0" className="flex-1 rounded-[9px] border border-line px-3 py-2 text-[13px] outline-none focus:border-magenta" />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 overflow-y-auto px-6 py-5">
            <Row k="Paciente" v={current?.name ?? 'Cliente'} />
            <Row k="Tipo de pago" v={KIND_LABEL[(treatmentId || hasCharges || freeAbono) ? payKind : 'TOTAL']} />
            {/* Detalle del recibo */}
            <div className="rounded-[11px] border border-line-2 p-3">
              <div className="mb-1.5 text-[11.5px] font-bold text-muted">Servicios</div>
              {usingCart
                ? cart.map((c) => <div key={c.lineId} className="flex justify-between py-0.5 text-[13px]"><span>{c.qty > 1 ? `${c.qty}× ` : ''}{c.name}</span><span className="font-bold">{fmtRD(c.price * c.qty)}</span></div>)
                : <div className="text-[13px] font-semibold">{finalConcept}</div>}
              {freeAbono && <div className="mt-1 flex justify-between border-t border-line-2 pt-1 text-[12px] text-muted"><span>Saldo pendiente</span><span className="font-bold text-danger">{fmtRD(freePending)}</span></div>}
            </div>
            <div className="rounded-[11px] border border-line-2 p-3">
              <div className="mb-1.5 text-[11.5px] font-bold text-muted">Desglose de pago</div>
              {paymentsList.map((p) => <div key={p.method} className="flex justify-between py-0.5 text-[13px]"><span>{METHOD_LABEL[p.method]}</span><span className="font-bold">{fmtRD(p.amount)}</span></div>)}
              <div className="mt-1.5 flex justify-between border-t border-line-2 pt-1.5 text-[15px] font-extrabold"><span>Total</span><span className="text-magenta">{fmtRD(amt)}</span></div>
            </div>
            {t && (payKind === 'ABONO' || payKind === 'SALDO') && (
              <div className="rounded-md px-3 py-2 text-[12px] font-semibold" style={{ background: 'var(--teal-soft)', color: '#1E5A82' }}>Saldo tras el pago: {fmtRD(balanceAfter)}{balanceAfter > 0 && t.remaining > 0 ? ` · ${fmtRD(Math.round(balanceAfter / t.remaining))}/sesión` : ''}</div>
            )}
            <div className="text-[11.5px] text-faint">Revisa los datos. Al confirmar se emite el recibo y se registra en caja.</div>
          </div>
        )}

        <div className="flex flex-none gap-2.5 border-t border-line px-6 py-4">
          {step === 'form' ? (
            <>
              <button onClick={onClose} className="flex-1 rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">Cancelar</button>
              <button onClick={goReview} className="flex-[2] rounded-[10px] bg-magenta py-3 text-[13.5px] font-bold text-white">Validar →</button>
            </>
          ) : (
            <>
              <button onClick={() => setStep('form')} className="flex-1 rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">← Editar</button>
              <button onClick={emit} disabled={busy} className="flex-[2] rounded-[10px] bg-navy py-3 text-[13.5px] font-bold text-white disabled:opacity-60">{busy ? 'Emitiendo…' : 'Confirmar y emitir'}</button>
            </>
          )}
        </div>
      </div>
    </Overlay>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between text-[13px]"><span className="text-muted">{k}</span><span className="font-bold">{v}</span></div>;
}
