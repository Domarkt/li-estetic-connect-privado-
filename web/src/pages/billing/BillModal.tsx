import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { useBranch } from '../../layout/BranchContext';
import { useToast } from '../../components/Toast';
import { Overlay, stop } from '../../components/Modal';
import CatalogChoiceCard from '../../components/CatalogChoiceCard';
import { fmtRD, type BillPatient, type CatalogItem, type PaymentMethod, type Receipt, type TherapistLite } from '../../lib/types';

// Azul se retiró: los pagos con tarjeta (incluida Azul) entran en "Tarjeta".
type Metodo = 'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA';
const METHODS: Metodo[] = ['EFECTIVO', 'TRANSFERENCIA', 'TARJETA'];
const METHOD_LABEL: Record<string, string> = { EFECTIVO: 'Efectivo', TRANSFERENCIA: 'Transferencia', TARJETA: 'Tarjeta', AZUL: 'Azul' };
const METHOD_ICON: Record<Metodo, string> = { EFECTIVO: '💵', TRANSFERENCIA: '🏦', TARJETA: '💳' };

type PayKind = 'TOTAL' | 'ABONO' | 'SALDO';
const KIND_LABEL: Record<PayKind, string> = { TOTAL: 'Pago total', ABONO: 'Abono', SALDO: 'Saldo pendiente' };

const num = (v: string) => parseInt((v || '').replace(/[^0-9]/g, ''), 10) || 0;

// Las líneas del carrito se agrupan por artículo: repetirlo aumenta la cantidad.
interface CartItem { lineId: string; catalogId: string; name: string; price: number; qty: number }
interface Props { preselectId?: string; startNewPurchase?: boolean; onClose: () => void; onEmitted: (r: Receipt) => void }

let lineSeq = 0;

export default function BillModal({ preselectId, startNewPurchase = false, onClose, onEmitted }: Props) {
  const toast = useToast();
  const { staff } = useAuth();
  const { activeBranch } = useBranch();
  // El admin cobra en la sucursal ACTIVA: los pacientes se filtran por ella (si no, se
  // mezclan clientas de otras estéticas). Recepción ya queda scopeada a la suya.
  const branchQP = staff?.role === 'ADMIN' && activeBranch !== 'all' ? `?branch=${activeBranch}` : '';
  const [patients, setPatients] = useState<BillPatient[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [selected, setSelected] = useState<string | null>(preselectId ?? null);
  const [concept, setConcept] = useState(''); // concepto derivado (tratamiento/cargos)
  const [cart, setCart] = useState<CartItem[]>([]); // varios servicios en un recibo
  const [amount, setAmount] = useState(''); // monto a abonar (solo en ABONO)
  const [chargeIds, setChargeIds] = useState<string[]>([]);
  const [treatmentId, setTreatmentId] = useState<string | null>(null);
  const [payKind, setPayKind] = useState<PayKind | null>(null);

  // Sin método preseleccionado: recepción debe confirmar cómo pagó el cliente.
  const [method, setMethod] = useState<Metodo | null>(null);
  const [splitOn, setSplitOn] = useState(false);
  const [split, setSplit] = useState<Record<Metodo, string>>({ EFECTIVO: '', TRANSFERENCIA: '', TARJETA: '' });

  // Descuento (recepción/admin): por monto RD$ o por %. Tope 20% del subtotal.
  const canDiscount = staff?.role === 'RECEPCIONISTA' || staff?.role === 'ADMIN';
  const MAX_DISCOUNT_PCT = 20; // tope; el backend lo valida también (DISCOUNT_MAX_PCT)
  const [descOn, setDescOn] = useState(false);
  const [descMode, setDescMode] = useState<'RD' | 'PCT'>('RD');
  const [descVal, setDescVal] = useState('');
  const [descReason, setDescReason] = useState('');

  // Fecha de la cita de la que se precargó el servicio (para avisarlo en pantalla).
  const [desdeAgenda, setDesdeAgenda] = useState<string | null>(null);

  // Esteticista a la que se le acredita la venta (comisión). '' = automático (según
  // quién cargó el servicio o la ficha). Recepción puede fijar/cambiar aquí.
  const [therapists, setTherapists] = useState<TherapistLite[]>([]);
  const [ventaTid, setVentaTid] = useState('');

  // ── Datos fiscales del comprobante ──
  // No todos los servicios estéticos llevan ITBIS: se decide al cobrar.
  // La mayoría de los servicios se facturan SIN ITBIS: el interruptor arranca
  // apagado y solo se enciende cuando el cobro lo requiere.
  const [conItbis, setConItbis] = useState(false);
  // "Solo registrar el ingreso": el paciente ya tiene estos servicios en su ficha
  // (plan cargado/usado). Emite el recibo sin crear/duplicar el plan.
  const [skipPlan, setSkipPlan] = useState(false);
  // B02 consumo final (lo normal) | B01 crédito fiscal (exige RNC del cliente).
  const [ncfType, setNcfType] = useState<'B02' | 'B01' | null>(null);
  const [rnc, setRnc] = useState('');
  const [razonSocial, setRazonSocial] = useState('');
  const [step, setStep] = useState<'form' | 'cart' | 'payment' | 'review'>('form');
  const [busy, setBusy] = useState(false);
  const [pQuery, setPQuery] = useState('');
  const [sQuery, setSQuery] = useState('');
  const [catalogTab, setCatalogTab] = useState<'servicios' | 'productos'>('servicios');
  const [loadingP, setLoadingP] = useState(true);
  const [errP, setErrP] = useState(false);

  /** Planes con saldo del paciente (compatibilidad si el servidor aún no los envía). */
  const saldosDe = (p: BillPatient | null) =>
    p?.treatmentsConSaldo ?? (p?.treatment && p.treatment.balance > 0 ? [p.treatment] : []);

  const current = patients.find((p) => p.id === selected) ?? null;
  const saldos = saldosDe(current);
  // El plan cuyo saldo se está cobrando (el elegido, o el primero con saldo).
  const t = saldos.find((x) => x.id === treatmentId) ?? saldos[0] ?? current?.treatment ?? null;
  const hasCharges = chargeIds.length > 0;
  // Se está cobrando el SALDO de un plan: flujo enfocado (sin carrito). En todo lo
  // demás (cargos pendientes, servicio agendado o compra suelta) el carrito está
  // activo, para que un paciente recurrente pueda AGREGAR otro producto o servicio.
  const payingSaldo = !!treatmentId;
  const cartOn = !payingSaldo;

  function loadPatients() {
    setLoadingP(true); setErrP(false);
    api.get<BillPatient[]>(`/invoices/patients${branchQP}`).then((ps) => {
      setPatients(ps); setLoadingP(false);
      if (preselectId) applyPatient(ps.find((p) => p.id === preselectId));
    }).catch(() => { setLoadingP(false); setErrP(true); });
  }
  useEffect(() => {
    loadPatients();
    api.get<CatalogItem[]>('/catalog').then((all) => setCatalog(all.filter((i) => i.kind === 'SERVICIO' || i.kind === 'PAQUETE' || i.kind === 'COMBO' || i.kind === 'PRODUCTO'))).catch(() => setCatalog([]));
    api.get<TherapistLite[]>(`/invoices/therapists${branchQP}`).then(setTherapists).catch(() => setTherapists([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Repetir el mismo artículo aumenta su cantidad; no crea líneas duplicadas.
  function addToCart(item: CatalogItem) {
    setSQuery('');
    setCart((c) => {
      const existing = c.find((line) => line.catalogId === item.id);
      if (existing) return c.map((line) => line.lineId === existing.lineId ? { ...line, qty: line.qty + 1 } : line);
      return [...c, { lineId: `l${++lineSeq}`, catalogId: item.id, name: item.name, price: item.price || 0, qty: 1 }];
    });
  }
  const patchLine = (lineId: string, patch: Partial<CartItem>) => setCart((c) => c.map((x) => (x.lineId === lineId ? { ...x, ...patch } : x)));
  const removeItem = (lineId: string) => setCart((c) => c.filter((x) => x.lineId !== lineId));

  const filteredPatients = patients.filter((p) => {
    const q = pQuery.trim().toLowerCase();
    return !q || p.name.toLowerCase().includes(q) || (p.phone ?? '').includes(q);
  });
  const filteredCatalog = catalog.filter((c) => {
    const q = sQuery.trim().toLowerCase();
    return (catalogTab === 'productos' ? c.kind === 'PRODUCTO' : c.kind !== 'PRODUCTO')
      && (!q || c.name.toLowerCase().includes(q) || (c.code ?? '').toLowerCase().includes(q)
        || (c.services ?? []).some((service) => service.name.toLowerCase().includes(q)));
  });

  function applyPatient(p?: BillPatient) {
    if (!p) return;
    setSelected(p.id); setCart([]); setSQuery('');
    if (startNewPurchase) {
      setConcept(''); setChargeIds([]); setTreatmentId(null); setAmount(''); setDesdeAgenda(null);
    } else if (p.pendingCharges.length) {
      setConcept(p.pendingCharges.map((c) => c.name).join(' + '));
      setChargeIds(p.pendingCharges.map((c) => c.id)); setTreatmentId(null); setAmount('');
    } else if (saldosDe(p).length) {
      // Se toma el primer plan con saldo; si tiene varios, se puede cambiar abajo.
      const t = saldosDe(p)[0];
      setConcept(`Saldo ${t.name}`); setTreatmentId(t.id);
      setChargeIds([]); setAmount('');
    } else {
      setConcept(''); setTreatmentId(null); setChargeIds([]); setAmount('');
      // Precarga lo que el paciente AGENDÓ: si pasaron días o hay mucho movimiento,
      // recepción no tiene por qué acordarse ni ir a buscarlo en la agenda.
      if (p.scheduled) {
        setCart([{
          lineId: `l${++lineSeq}`, catalogId: p.scheduled.catalogItemId,
          name: p.scheduled.name, price: p.scheduled.price || 0, qty: 1,
        }]);
        setDesdeAgenda(p.scheduled.fecha);
      } else {
        setDesdeAgenda(null);
      }
    }
    setSplit({ EFECTIVO: '', TRANSFERENCIA: '', TARJETA: '' });
    setMethod(null);
    setPayKind(null);
    setNcfType(null);
  }

  function setKind(k: PayKind) {
    setPayKind(k);
    if (payingSaldo && t) {
      if (k === 'SALDO') setAmount(String(t.balance));
      else if (k === 'TOTAL') setAmount(String(t.price));
      else setAmount('');
    } else {
      // Cargos + carrito: en TOTAL el monto se calcula solo; en ABONO se escribe.
      setAmount('');
    }
  }

  const cartTotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  // Solo suma los cargos MARCADOS. Antes usaba pendingTotal (todos los cargos del
  // paciente): al desmarcar la oferta de RD$3,500 y dejar el área de RD$1,500, el
  // recibo mostraba un concepto de 1,500 pero cobraba 5,000.
  const chargesTotal = hasCharges
    ? (current?.pendingCharges ?? []).filter((c) => chargeIds.includes(c.id)).reduce((s, c) => s + c.price, 0)
    : 0;
  // Subtotal de lo que se cobra cuando NO es saldo: cargos pendientes + carrito.
  const preTotal = chargesTotal + cartTotal;
  // Descuento: por % (tope 20) o por monto RD$ (no puede superar el 20% del subtotal).
  const capAmount = Math.floor((preTotal * MAX_DISCOUNT_PCT) / 100);
  const descRaw = descOn && !payingSaldo
    ? (descMode === 'PCT' ? Math.round((preTotal * Math.min(MAX_DISCOUNT_PCT, num(descVal))) / 100) : num(descVal))
    : 0;
  const descAmount = Math.max(0, Math.min(descRaw, capAmount));
  const descCapExceeded = descRaw > capAmount;
  // Total NETO a cobrar (subtotal − descuento).
  const lineasTotal = Math.max(0, preTotal - descAmount);
  // Monto a cobrar según el caso:
  const amt = payingSaldo
    ? num(amount)
    : (payKind === 'ABONO' ? num(amount) : lineasTotal);
  const fullAmt = payingSaldo ? 0 : lineasTotal;
  const freeAbono = payKind === 'ABONO' && !payingSaldo && lineasTotal > 0;
  const freePending = Math.max(0, fullAmt - amt);
  const cartNames = cart.map((c) => (c.qty > 1 ? `${c.qty}× ${c.name}` : c.name));
  const cartCount = chargeIds.length + cart.reduce((sum, item) => sum + item.qty, 0);
  const finalConcept = payingSaldo
    ? concept
    : [...(hasCharges && concept ? [concept] : []), ...cartNames].join(' + ') || concept || '';

  const splitAssigned = METHODS.reduce((s, m) => s + num(split[m]), 0);
  const assigned = splitOn ? splitAssigned : amt;
  const remaining = amt - assigned;
  const paymentsList: { method: PaymentMethod; amount: number }[] = splitOn
    ? METHODS.map((m) => ({ method: m as PaymentMethod, amount: num(split[m]) })).filter((p) => p.amount > 0)
    : (amt > 0 && method ? [{ method: method as PaymentMethod, amount: amt }] : []);
  const paymentReady = !!payKind && !!ncfType && amt > 0 && (splitOn ? assigned === amt : !!method);
  const balanceAfter = t ? Math.max(0, t.balance - amt) : 0;

  function validate(): string | null {
    if (!payingSaldo && !hasCharges && cart.length === 0) return 'Agrega al menos un servicio o producto';
    const sinPrecio = cart.find((c) => c.price <= 0);
    if (sinPrecio) return `Escribe el precio de: ${sinPrecio.name}`;
    if (!finalConcept.trim()) return 'Elige un servicio o producto';
    if (!payKind) return 'Selecciona el tipo de pago';
    if (!ncfType) return 'Selecciona el tipo de comprobante';
    if (!amt) return 'Escribe el monto a cobrar';
    if (!splitOn && !method) return 'Selecciona cómo pagó el cliente';
    if (payingSaldo && t && amt > t.balance) return `El monto no puede superar el saldo (${fmtRD(t.balance)})`;
    if (freeAbono && amt >= lineasTotal) return 'El abono debe ser menor que el total';
    if (splitOn && assigned !== amt) return `El pago dividido (${fmtRD(assigned)}) debe sumar el total (${fmtRD(amt)})`;
    // Crédito fiscal: sin identificación del comprador el comprobante no sirve
    // y después no se puede corregir.
    if (ncfType === 'B01') {
      const d = rnc.replace(/\D/g, '');
      if (d.length !== 9 && d.length !== 11) return 'Escribe el RNC (9 dígitos) o la cédula (11 dígitos) del cliente';
      if (!razonSocial.trim()) return 'Escribe el nombre o razón social de la factura';
    }
    return null;
  }

  function goReview() {
    const err = validate();
    if (err) { toast(err); return; }
    setStep('review');
  }

  function goCart() {
    if (!payingSaldo && !hasCharges && cart.length === 0) { toast('Agrega al menos un servicio o producto'); return; }
    setStep('cart');
  }

  function goPayment() {
    if (!payingSaldo && !hasCharges && cart.length === 0) { toast('El carrito está vacío'); setStep('form'); return; }
    const sinPrecio = cart.find((item) => item.price <= 0);
    if (sinPrecio) { toast(`Escribe el precio de: ${sinPrecio.name}`); return; }
    setStep('payment');
  }

  async function emit() {
    setBusy(true);
    try {
      const r = await api.post<{ receipt: Receipt; message: string; citaWhatsappUrl: string | null }>('/invoices', {
        patientId: selected ?? undefined, concept: finalConcept.trim(),
        therapistId: ventaTid || undefined,
        payments: paymentsList, treatmentId: payingSaldo ? treatmentId : undefined,
        paymentKind: (payingSaldo || freeAbono) ? payKind! : 'TOTAL',
        chargeItemIds: chargeIds.length ? chargeIds : undefined,
        items: cartOn && cart.length ? cart.map((c) => ({ name: c.name, price: c.price, qty: c.qty, catalogItemId: c.catalogId })) : undefined,
        fullAmount: freeAbono ? lineasTotal : undefined,
        discount: descAmount > 0 ? descAmount : undefined,
        discountReason: descAmount > 0 && descReason.trim() ? descReason.trim() : undefined,
        itbisApplied: conItbis,
        skipPlan: (!payingSaldo && cartOn && skipPlan) ? true : undefined,
        ncfType: ncfType!,
        ...(ncfType === 'B01' ? { clientRnc: rnc.trim(), clientName: razonSocial.trim() } : {}),
      });
      toast(r.message); onEmitted({ ...r.receipt, citaWhatsappUrl: r.citaWhatsappUrl }); onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al emitir');
    } finally { setBusy(false); }
  }

  return (
    <Overlay onClose={onClose} z={110}>
      <div onClick={stop} className={`flex max-h-[92vh] max-w-full flex-col overflow-hidden rounded-2xl bg-card animate-pop ${step === 'form' ? 'w-[520px] lg:w-[980px]' : 'w-[520px] lg:w-[680px]'}`} style={{ boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
        <div className="flex flex-none items-center border-b border-line px-4 sm:px-6 py-4">
          <div className="flex-1">
            <div className="text-base font-extrabold">{step === 'form' ? 'Elegir servicios y productos' : step === 'cart' ? 'Revisar carrito' : step === 'payment' ? 'Método de pago' : 'Confirmar cobro'}</div>
            <div className="mt-0.5 text-[11px] font-semibold text-muted">{step === 'form' ? 'Paso 1 de 4' : step === 'cart' ? 'Paso 2 de 4' : step === 'payment' ? 'Paso 3 de 4' : 'Paso 4 de 4'}</div>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg bg-bg text-muted">×</button>
        </div>

        {step === 'form' ? (
          <div className="grid min-h-0 gap-4 overflow-y-auto px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_290px] lg:overflow-hidden">
            <div className="flex min-w-0 flex-col gap-4 lg:overflow-y-auto lg:pr-1">
            {/* 1 · Paciente */}
            <div>
              <span className="mb-1.5 block text-xs font-bold text-muted">Paciente</span>
              {current ? (
                <div className="flex items-center gap-2.5 rounded-[11px] border border-magenta bg-magenta-soft px-3 py-2.5">
                  <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-[11.5px] font-bold text-white" style={{ background: current.avatarColor }}>{current.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</div>
                  <div className="min-w-0 flex-1"><div className="text-[13.5px] font-bold">{current.name}</div><div className="text-[11.5px] text-muted">{current.plan}{current.balance > 0 ? ` · saldo ${fmtRD(current.balance)}` : ''}</div></div>
                  <button onClick={() => { setSelected(null); setConcept(''); setChargeIds([]); setTreatmentId(null); setCart([]); setDesdeAgenda(null); setMethod(null); setPayKind(null); setNcfType(null); }} className="rounded-lg px-2 py-1 text-[12px] font-bold text-magenta">Cambiar</button>
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
                        <button key={p.id} type="button" onClick={() => applyPatient(p)}
                          className="flex w-full cursor-pointer items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left hover:bg-bg focus-visible:bg-bg">
                          <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-[11.5px] font-bold text-white" style={{ background: p.avatarColor }}>{initials}</div>
                          <div className="min-w-0 flex-1"><div className="text-[13px] font-bold">{p.name}</div><div className="text-[11.5px] text-muted">{p.plan}{p.balance > 0 ? ` · saldo ${fmtRD(p.balance)}` : ''}</div></div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* 2 · Servicios y productos */}
            <div>
              <span className="mb-1.5 block text-xs font-bold text-muted">Servicios y productos a cobrar</span>
              {payingSaldo ? (
                <>
                  {/* Con varios planes con saldo hay que decir cuál se está cobrando. */}
                  {saldos.length > 1 ? (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11.5px] font-bold text-muted">¿Cuál saldo cobras?</span>
                      {saldos.map((s) => {
                        const on = treatmentId === s.id;
                        return (
                          <button key={s.id} onClick={() => {
                            setTreatmentId(s.id); setConcept(`Saldo ${s.name}`);
                            setPayKind('SALDO'); setAmount(String(s.balance));
                          }}
                            className="flex items-center gap-2 rounded-[10px] border px-3 py-2.5 text-left"
                            style={{ borderColor: on ? 'var(--magenta)' : 'var(--line)', background: on ? 'var(--magenta-soft)' : 'var(--card)' }}>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-bold">{s.name}</span>
                              <span className="block text-[11.5px] text-muted">{s.done}/{s.total} sesiones</span>
                            </span>
                            <span className="flex-none text-[13px] font-extrabold text-danger">{fmtRD(s.balance)}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <>
                      <div className="rounded-[11px] border border-line-2 bg-bg px-3.5 py-3 text-[13.5px] font-semibold">{concept || '—'}</div>
                      <span className="mt-1 block text-[11px] text-faint">Se está cobrando el saldo de este plan.</span>
                    </>
                  )}
                  {/* Permite salir del cobro de saldo para hacer una compra normal. */}
                  <button onClick={() => { setTreatmentId(null); setConcept(''); setPayKind(null); setAmount(''); setMethod(null); setNcfType(null); }}
                    className="mt-2 text-[11.5px] font-bold text-magenta">+ Mejor cobrar otro servicio/producto</button>
                </>
              ) : (
                <>
                  {desdeAgenda && cart.length > 0 && (
                    <div className="mb-2 flex items-center gap-2 rounded-[9px] px-3 py-2 text-[11.5px] font-semibold"
                      style={{ background: 'var(--teal-soft)', color: '#1E5A82' }}>
                      <span>📅</span>
                      <span className="flex-1">Cargado de su cita del <b>{desdeAgenda}</b>. Puedes cambiarlo o agregar más.</span>
                    </div>
                  )}

                  {/* El mismo resumen de catálogo que se ve al abrir un paciente. */}
                  <div className="mb-2 flex gap-2" role="group" aria-label="Tipo de artículo a cobrar">
                    {([['servicios', 'Servicios, combos y paquetes'], ['productos', 'Productos']] as const).map(([key, label]) => (
                      <button key={key} type="button" onClick={() => { setCatalogTab(key); setSQuery(''); }}
                        aria-pressed={catalogTab === key}
                        className={`rounded-[9px] border px-3 py-2 text-[12px] font-bold ${catalogTab === key ? 'border-magenta bg-magenta-soft text-magenta' : 'border-line bg-card text-muted'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <input value={sQuery} onChange={(e) => setSQuery(e.target.value)} placeholder={catalogTab === 'productos' ? '🔍 Buscar producto por nombre o código…' : '🔍 Buscar servicio, combo o paquete…'}
                    className="mb-1.5 w-full rounded-[9px] border border-line px-3 py-2.5 text-[13px] outline-none focus:border-magenta" />
                  <div className="max-h-[280px] overflow-y-auto rounded-[11px] border border-line-2 p-2">
                    {catalog.length === 0 && <div className="px-2.5 py-3 text-center text-[12.5px] text-muted">No hay artículos en el catálogo. Créalos en Catálogo.</div>}
                    {catalog.length > 0 && filteredCatalog.length === 0 && <div className="px-2.5 py-3 text-center text-[12.5px] text-muted">{sQuery ? 'Sin coincidencias.' : `No hay ${catalogTab === 'productos' ? 'productos' : 'servicios'} en el catálogo.`}</div>}
                    <div className="flex flex-col gap-2">
                      {filteredCatalog.map((c) => (
                        <CatalogChoiceCard key={c.id} item={c} action="Agregar" onClick={() => addToCart(c)} />
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* 2b · Descuento (recepción/admin) — solo en ventas con líneas, no en saldo */}
            {canDiscount && !payingSaldo && (hasCharges || cart.length > 0) && (
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-bold text-muted">Descuento <span className="font-semibold text-faint">(opcional · máx {MAX_DISCOUNT_PCT}%)</span></span>
                  {!descOn
                    ? <button onClick={() => setDescOn(true)} className="text-[11.5px] font-bold text-magenta">+ Aplicar descuento</button>
                    : <button onClick={() => { setDescOn(false); setDescVal(''); setDescReason(''); }} className="text-[11.5px] font-bold text-muted">Quitar</button>}
                </div>
                {descOn && (
                  <div className="flex flex-col gap-2 rounded-[11px] border border-line-2 p-2.5">
                    <div className="flex gap-2">
                      <div className="flex flex-none overflow-hidden rounded-[9px] border border-line">
                        {(['RD', 'PCT'] as const).map((m) => {
                          const on = descMode === m;
                          return (
                            <button key={m} onClick={() => { setDescMode(m); setDescVal(''); }}
                              className="px-3.5 py-2 text-[13px] font-bold"
                              style={{ background: on ? 'var(--magenta)' : 'var(--card)', color: on ? '#fff' : 'var(--muted)' }}>{m === 'RD' ? 'RD$' : '%'}</button>
                          );
                        })}
                      </div>
                      <input value={descVal} onChange={(e) => setDescVal(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric"
                        placeholder={descMode === 'RD' ? 'Monto en RD$' : `% (máx ${MAX_DISCOUNT_PCT})`}
                        className="flex-1 rounded-[9px] border border-line px-3 py-2 text-[13.5px] outline-none focus:border-magenta" />
                    </div>
                    <input value={descReason} onChange={(e) => setDescReason(e.target.value)} placeholder="Motivo (opcional): promo, cliente frecuente…"
                      className="rounded-[9px] border border-line px-3 py-2 text-[12.5px] outline-none focus:border-magenta" />
                    {descAmount > 0 && (
                      <div className="flex justify-between rounded-[9px] bg-bg px-3 py-2 text-[13px]">
                        <span className="font-bold text-muted">Descuento</span>
                        <span className="font-extrabold text-danger">−{fmtRD(descAmount)}{descMode === 'PCT' ? ` (${Math.min(MAX_DISCOUNT_PCT, num(descVal))}%)` : ''}</span>
                      </div>
                    )}
                    {descCapExceeded && <div className="text-[11px] font-semibold text-danger">El máximo es {MAX_DISCOUNT_PCT}% ({fmtRD(capAmount)}). Se aplicará el tope.</div>}
                  </div>
                )}
              </div>
            )}

            </div>
            <aside aria-label="Carrito de compra" className="flex min-h-[190px] flex-col rounded-xl border border-line bg-bg p-3 lg:min-h-0 lg:overflow-y-auto">
              <div className="flex items-center justify-between border-b border-line pb-2"><div className="text-[14px] font-extrabold text-navy">🛒 Carrito</div><div className="rounded-full bg-magenta-soft px-2 py-0.5 text-[11px] font-bold text-magenta">{payingSaldo ? 'Saldo' : `${cartCount} ${cartCount === 1 ? 'artículo' : 'artículos'}`}</div></div>
              <div className="flex-1 space-y-2 py-3">
                {payingSaldo ? <div className="rounded-lg bg-card p-2.5 text-[12px]"><div className="font-bold">{concept}</div><div className="mt-1 text-muted">Saldo del plan: {fmtRD(t?.balance ?? 0)}</div></div> : (
                  <>
                    {cartCount === 0 && <div className="py-7 text-center text-[12px] text-muted">El carrito está vacío. Elige un combo, servicio o producto a la izquierda.</div>}
                    {(current?.pendingCharges ?? []).filter((charge) => chargeIds.includes(charge.id)).map((charge) => <div key={charge.id} className="flex items-start gap-1 rounded-lg bg-card p-2.5"><div className="min-w-0 flex-1"><div className="text-[12px] font-bold">{charge.name}</div><div className="text-[11px] text-muted">Cargo pendiente · {fmtRD(charge.price)}</div></div><button type="button" onClick={() => setChargeIds((ids) => ids.filter((id) => id !== charge.id))} aria-label={`Quitar ${charge.name} del carrito`} className="px-1 text-base text-muted hover:text-danger">×</button></div>)}
                    {cart.map((item) => <div key={item.lineId} className="flex items-start gap-1 rounded-lg bg-card p-2.5"><div className="min-w-0 flex-1"><div className="text-[12px] font-bold leading-snug">{item.name}</div><div className="mt-1 text-[11px] text-muted">{item.qty} × {fmtRD(item.price)} <span className="font-bold text-magenta">· {fmtRD(item.qty * item.price)}</span></div></div><button type="button" onClick={() => removeItem(item.lineId)} aria-label={`Quitar ${item.name} del carrito`} className="px-1 text-base text-muted hover:text-danger">×</button></div>)}
                  </>
                )}
              </div>
              <div className="border-t border-line pt-3">
                {!payingSaldo && <div className="flex justify-between text-[11px] text-muted"><span>Subtotal</span><span>{fmtRD(preTotal)}</span></div>}
                {descAmount > 0 && <div className="mt-1 flex justify-between text-[11px] text-danger"><span>Descuento</span><span>−{fmtRD(descAmount)}</span></div>}
                <div className="mt-2 flex items-center justify-between text-[15px] font-extrabold"><span>Total</span><span className="text-magenta">{fmtRD(payingSaldo ? t?.balance ?? 0 : lineasTotal)}</span></div>
              </div>
            </aside>
          </div>
        ) : step === 'cart' ? (
          <div className="flex flex-col gap-3 overflow-y-auto px-4 py-5 sm:px-6">
            <div className="rounded-xl bg-navy px-4 py-3 text-white">
              <div className="text-[11px] font-bold uppercase tracking-wide opacity-75">Carrito de compra</div>
              <div className="mt-0.5 text-[15px] font-extrabold">{current?.name ?? 'Cliente'} · {payingSaldo ? 'saldo pendiente' : `${cartCount} ${cartCount === 1 ? 'artículo' : 'artículos'}`}</div>
            </div>
            {payingSaldo ? (
              <div className="rounded-xl border border-line p-3.5"><div className="text-[13px] font-bold">{concept}</div><div className="mt-1 text-[12px] text-muted">Saldo disponible: {fmtRD(t?.balance ?? 0)}</div></div>
            ) : (
              <>
                {(current?.pendingCharges ?? []).filter((charge) => chargeIds.includes(charge.id)).map((charge) => (
                  <div key={charge.id} className="flex items-center gap-2 rounded-xl border border-line p-3">
                    <div className="min-w-0 flex-1"><div className="text-[13px] font-bold">{charge.name}</div><div className="text-[11px] text-muted">Cargo pendiente</div></div>
                    <div className="text-[13px] font-extrabold text-magenta">{fmtRD(charge.price)}</div>
                    <button type="button" onClick={() => setChargeIds((ids) => ids.filter((id) => id !== charge.id))} aria-label={`Quitar ${charge.name} del carrito`} className="rounded-md px-2 text-lg font-bold text-muted hover:text-danger">×</button>
                  </div>
                ))}
                {cart.map((item) => (
                  <div key={item.lineId} className="rounded-xl border border-line p-3">
                    <div className="flex items-start gap-2"><div className="min-w-0 flex-1 text-[13px] font-bold">{item.name}</div><button type="button" onClick={() => removeItem(item.lineId)} aria-label={`Quitar ${item.name} del carrito`} className="rounded-md px-2 text-lg font-bold text-muted hover:text-danger">×</button></div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex items-center rounded-lg border border-line"><button type="button" onClick={() => patchLine(item.lineId, { qty: Math.max(1, item.qty - 1) })} aria-label={`Restar ${item.name}`} className="px-2.5 py-1 text-lg">−</button><span className="w-6 text-center text-[13px] font-bold">{item.qty}</span><button type="button" onClick={() => patchLine(item.lineId, { qty: item.qty + 1 })} aria-label={`Sumar ${item.name}`} className="px-2.5 py-1 text-lg">+</button></div>
                      <label className="flex min-w-0 flex-1 items-center rounded-lg border border-line px-2"><span className="text-[11px] font-bold text-muted">RD$</span><input value={item.price || ''} onChange={(event) => patchLine(item.lineId, { price: num(event.target.value) })} inputMode="numeric" aria-label={`Precio de ${item.name}`} className="w-full min-w-0 px-1 py-1.5 text-right text-[13px] font-bold outline-none" /></label>
                      <div className="w-[85px] flex-none text-right text-[13px] font-extrabold text-magenta">{fmtRD(item.price * item.qty)}</div>
                    </div>
                  </div>
                ))}
              </>
            )}
            <div className="rounded-xl border border-magenta bg-magenta-soft p-4">
              {!payingSaldo && <div className="flex justify-between text-[12px] text-muted"><span>Subtotal</span><span>{fmtRD(preTotal)}</span></div>}
              {descAmount > 0 && <div className="mt-1 flex justify-between text-[12px] text-danger"><span>Descuento</span><span>−{fmtRD(descAmount)}</span></div>}
              <div className="mt-2 flex justify-between border-t border-magenta/30 pt-2 text-[16px] font-extrabold"><span>{payingSaldo ? 'Saldo del plan' : 'Total del carrito'}</span><span className="text-magenta">{fmtRD(payingSaldo ? t?.balance ?? 0 : lineasTotal)}</span></div>
            </div>
            <div className="text-[11px] text-muted">Confirma artículos, cantidades y precios. El cobro se emite solo después de revisar el método de pago.</div>
          </div>
        ) : step === 'payment' ? (
          <div className="flex flex-col gap-4 overflow-y-auto px-4 py-5 sm:px-6">
            <div className="flex items-center justify-between rounded-xl border border-line bg-bg px-4 py-3"><div><div className="text-[11px] font-bold text-muted">Carrito revisado</div><div className="text-[13px] font-bold">{payingSaldo ? concept : `${cartCount} ${cartCount === 1 ? 'artículo' : 'artículos'}`}</div></div><button type="button" onClick={() => setStep('cart')} className="text-[12px] font-bold text-magenta">Ver carrito</button></div>

            {/* 3 · Tipo de pago */}
            {selected && (payingSaldo || hasCharges || cart.length > 0) && (
              <div>
                <span className="mb-1.5 block text-xs font-bold text-muted">Tipo de pago</span>
                <div className="flex gap-2">
                  {(['TOTAL', 'ABONO', 'SALDO'] as const).map((k) => {
                    const on = payKind === k;
                    // SALDO solo cuando se está cobrando el saldo de un plan.
                    const disabled = (k === 'SALDO' && !payingSaldo) || (k === 'ABONO' && !selected);
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

            {/* 3b · Comprobante fiscal: tipo de factura e ITBIS */}
            <div>
              <span className="mb-1.5 block text-xs font-bold text-muted">Tipo de comprobante</span>
              <div className="grid grid-cols-2 gap-2">
                {([['B02', 'Consumo', 'Lo normal'], ['B01', 'Crédito fiscal', 'Requiere RNC']] as const).map(([k, label, hint]) => {
                  const on = ncfType === k;
                  return (
                    <button key={k} onClick={() => setNcfType(k)}
                      className="flex flex-col items-start rounded-[9px] border px-3 py-2 text-left"
                      style={{ borderColor: on ? 'var(--magenta)' : 'var(--line)', background: on ? 'var(--magenta-soft)' : 'var(--card)' }}>
                      <span className="text-[12.5px] font-bold" style={{ color: on ? 'var(--magenta)' : 'var(--muted)' }}>{label}</span>
                      <span className="text-[10.5px] text-faint">{hint}</span>
                    </button>
                  );
                })}
              </div>

              {/* Crédito fiscal: identificación del comprador (obligatoria). */}
              {ncfType === 'B01' && (
                <div className="mt-2 flex flex-col gap-2 rounded-[10px] border border-magenta/40 bg-magenta-soft p-2.5">
                  <div className="text-[11px] font-bold text-magenta">Datos para el crédito fiscal</div>
                  <input value={rnc} onChange={(e) => setRnc(e.target.value.replace(/[^0-9-]/g, ''))} inputMode="numeric"
                    placeholder="RNC (9 dígitos) o cédula (11 dígitos)"
                    className="rounded-[9px] border border-line bg-card px-3 py-2.5 text-[13px] outline-none focus:border-magenta" />
                  <input value={razonSocial} onChange={(e) => setRazonSocial(e.target.value)}
                    placeholder="Nombre o razón social"
                    className="rounded-[9px] border border-line bg-card px-3 py-2.5 text-[13px] outline-none focus:border-magenta" />
                  <span className="text-[10.5px] text-muted">Estos datos van impresos en la factura y no se pueden corregir después.</span>
                </div>
              )}

              {/* ITBIS a solicitud: hay servicios estéticos que no lo llevan. */}
              <button onClick={() => setConItbis((v) => !v)}
                className="mt-2 flex w-full items-center justify-between rounded-[9px] border border-line bg-card px-3 py-2.5 text-left">
                <span className="flex flex-col">
                  <span className="text-[12.5px] font-bold">Aplicar ITBIS (18%)</span>
                  <span className="text-[10.5px] text-faint">
                    {conItbis
                      ? `Incluido en el precio · ${fmtRD(amt - Math.round(amt / 1.18))} de ${fmtRD(amt || 0)}`
                      : 'Este cobro se factura sin ITBIS'}
                  </span>
                </span>
                <span className="relative flex h-6 w-11 flex-none items-center rounded-full transition" style={{ background: conItbis ? 'var(--magenta)' : 'var(--line)' }}>
                  <span className="absolute h-5 w-5 rounded-full bg-white transition-all" style={{ left: conItbis ? 22 : 2 }} />
                </span>
              </button>

              {/* Solo registrar el ingreso: cuando el paciente YA tiene estos servicios
                  en su ficha (plan cargado/usado) y solo falta dejar el cobro. Evita
                  duplicar el plan. Solo aplica a un cobro con carrito (no saldo). */}
              {!payingSaldo && cart.length > 0 && (
                <button onClick={() => setSkipPlan((v) => !v)}
                  className="mt-2 flex w-full items-center justify-between rounded-[9px] border border-line bg-card px-3 py-2.5 text-left">
                  <span className="flex flex-col">
                    <span className="text-[12.5px] font-bold">Solo registrar el ingreso (no crear plan)</span>
                    <span className="text-[10.5px] text-faint">
                      {skipPlan
                        ? 'El plan YA está en su ficha: solo se emite el recibo, sin duplicar.'
                        : 'Actívalo si el paciente ya tiene estos servicios cargados/usados en su ficha.'}
                    </span>
                  </span>
                  <span className="relative flex h-6 w-11 flex-none items-center rounded-full transition" style={{ background: skipPlan ? 'var(--magenta)' : 'var(--line)' }}>
                    <span className="absolute h-5 w-5 rounded-full bg-white transition-all" style={{ left: skipPlan ? 22 : 2 }} />
                  </span>
                </button>
              )}
            </div>

            {/* 4 · Monto: total calculado (pago total) o campo para abono/saldo */}
            {!payingSaldo && payKind === 'TOTAL' ? (
              <div className="flex items-center justify-between rounded-[11px] border-2 border-magenta bg-magenta-soft px-4 py-3">
                <span className="text-[13px] font-bold text-muted">Total a cobrar{conItbis ? ' · ITBIS incl.' : ''}</span>
                <span className="text-[22px] font-extrabold text-magenta">{fmtRD(lineasTotal)}</span>
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
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-bold text-muted">¿Cómo paga?</span>
                <span className="text-[11px] font-semibold text-faint">Selecciona una opción</span>
              </div>
              <button type="button" onClick={() => setSplitOn((v) => !v)} aria-pressed={splitOn}
                className="mb-2 flex w-full items-center justify-between rounded-[10px] border-2 px-3.5 py-2.5 text-left transition"
                style={{ borderColor: splitOn ? 'var(--magenta)' : 'var(--line)', background: splitOn ? 'var(--magenta-soft)' : 'var(--card)' }}>
                <span className="flex items-center gap-2"><span className="text-base">🧾</span><span><span className="block text-[12.5px] font-extrabold" style={{ color: splitOn ? 'var(--magenta)' : 'var(--navy)' }}>{splitOn ? 'Pago dividido activado' : 'Dividir pago'}</span><span className="block text-[10.5px] text-muted">{splitOn ? 'Distribuye el total entre varios métodos' : 'Usa efectivo, transferencia y/o tarjeta'}</span></span></span>
                <span className="text-[11.5px] font-bold text-magenta">{splitOn ? '← Un solo método' : 'Elegir'}</span>
              </button>
              {!splitOn && !method && <div className="mb-2 rounded-lg border border-dashed border-line px-3 py-2 text-[11.5px] font-semibold text-muted">Ningún método seleccionado todavía.</div>}
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
                        <button onClick={() => setSplit({ EFECTIVO: '', TRANSFERENCIA: '', TARJETA: '', [m]: String(amt) })}
                          title="Poner todo aquí" aria-label={`Asignar todo el monto a ${METHOD_LABEL[m]}`}
                          className="w-[96px] flex-none truncate rounded-[9px] border border-line bg-bg px-2 py-2 text-left text-[12px] font-bold text-navy hover:border-magenta sm:w-[130px]">{METHOD_ICON[m]} {METHOD_LABEL[m]}</button>
                        <input value={split[m]} onChange={(e) => setSplit({ ...split, [m]: e.target.value.replace(/[^0-9]/g, '') })} inputMode="numeric" placeholder="0" className="flex-1 rounded-[9px] border border-line px-3 py-2 text-[13px] outline-none focus:border-magenta" />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
           </div>
        ) : (
          <div className="flex flex-col gap-3 overflow-y-auto px-4 sm:px-6 py-5">
            <Row k="Paciente" v={current?.name ?? 'Cliente'} />
            <Row k="Tipo de pago" v={payKind ? KIND_LABEL[payKind] : 'Sin seleccionar'} />
            <Row k="Comprobante" v={ncfType === 'B01' ? 'Crédito fiscal' : ncfType === 'B02' ? 'Consumo' : 'Sin seleccionar'} />
            {ncfType === 'B01' && (
              <div className="rounded-[11px] border border-magenta/40 bg-magenta-soft p-3">
                <div className="mb-1 text-[11.5px] font-bold text-magenta">Crédito fiscal · se emite a</div>
                <div className="text-[13px] font-bold">{razonSocial.trim()}</div>
                <div className="text-[12px] text-muted">RNC/Cédula: {rnc.trim()}</div>
              </div>
            )}
            {/* Detalle del recibo */}
            <div className="rounded-[11px] border border-line-2 p-3">
              <div className="mb-1.5 text-[11.5px] font-bold text-muted">Servicios</div>
              {payingSaldo ? (
                <div className="text-[13px] font-semibold">{finalConcept}</div>
              ) : (
                <>
                  {(current?.pendingCharges ?? []).filter((c) => chargeIds.includes(c.id)).map((c) => (
                    <div key={c.id} className="flex justify-between py-0.5 text-[13px]"><span>{c.name}</span><span className="font-bold">{fmtRD(c.price)}</span></div>
                  ))}
                  {cart.map((c) => <div key={c.lineId} className="flex justify-between py-0.5 text-[13px]"><span>{c.qty > 1 ? `${c.qty}× ` : ''}{c.name}</span><span className="font-bold">{fmtRD(c.price * c.qty)}</span></div>)}
                  {descAmount > 0 && (
                    <div className="mt-1 flex justify-between border-t border-line-2 pt-1 text-[13px]"><span className="text-muted">Descuento{descReason.trim() ? ` · ${descReason.trim()}` : ''}</span><span className="font-bold text-danger">−{fmtRD(descAmount)}</span></div>
                  )}
                </>
              )}
              {freeAbono && <div className="mt-1 flex justify-between border-t border-line-2 pt-1 text-[12px] text-muted"><span>Saldo pendiente</span><span className="font-bold text-danger">{fmtRD(freePending)}</span></div>}
            </div>
            <div className="rounded-[11px] border border-line-2 p-3">
              <div className="mb-1.5 text-[11.5px] font-bold text-muted">Desglose de pago</div>
              {paymentsList.map((p) => <div key={p.method} className="flex justify-between py-0.5 text-[13px]"><span>{METHOD_LABEL[p.method]}</span><span className="font-bold">{fmtRD(p.amount)}</span></div>)}
              <div className="mt-1.5 flex justify-between border-t border-line-2 pt-1.5 text-[15px] font-extrabold"><span>Total</span><span className="text-magenta">{fmtRD(amt)}</span></div>
              <div className="mt-1 text-right text-[11px] text-faint">
                {conItbis ? `ITBIS 18% incluido (${fmtRD(amt - Math.round(amt / 1.18))})` : 'Sin ITBIS'}
              </div>
            </div>
            {t && (payKind === 'ABONO' || payKind === 'SALDO') && (
              <div className="rounded-md px-3 py-2 text-[12px] font-semibold" style={{ background: 'var(--teal-soft)', color: '#1E5A82' }}>Saldo tras el pago: {fmtRD(balanceAfter)}{balanceAfter > 0 && t.remaining > 0 ? ` · ${fmtRD(Math.round(balanceAfter / t.remaining))}/sesión` : ''}</div>
            )}
            {selected && (
              <label className="flex flex-col gap-1 rounded-[11px] border border-line-2 p-3">
                <span className="text-[11.5px] font-bold text-muted">Comisión / venta para (esteticista)</span>
                <select value={ventaTid} onChange={(e) => setVentaTid(e.target.value)} className="rounded-[9px] border border-line px-3 py-2 text-[13px] outline-none focus:border-magenta">
                  <option value="">Automático (quien cargó el servicio / la ficha)</option>
                  {therapists.map((th) => <option key={th.id} value={th.id}>{th.name}</option>)}
                </select>
                <span className="text-[10.5px] text-faint">Si lo dejas en automático, se atribuye a quien agregó el combo/servicio o, si no, a la esteticista de la ficha.</span>
              </label>
            )}
            <div className="text-[11.5px] text-faint">Revisa los datos. Al confirmar se emite el recibo y se registra en caja.</div>
          </div>
        )}

        <div className="flex flex-none gap-2.5 border-t border-line px-4 py-4 sm:px-6">
          {step === 'form' ? (
            <>
              <button onClick={onClose} className="flex-1 rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">Cancelar</button>
              <button onClick={goCart} className="flex-[2] rounded-[10px] bg-magenta py-3 text-[13.5px] font-bold text-white">🛒 Revisar carrito →</button>
            </>
          ) : step === 'cart' ? (
            <>
              <button onClick={() => setStep('form')} className="flex-1 rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">← Seguir agregando</button>
              <button onClick={goPayment} className="flex-[2] rounded-[10px] bg-magenta py-3 text-[13.5px] font-bold text-white">Método de pago →</button>
            </>
          ) : step === 'payment' ? (
            <>
              <button onClick={() => setStep('cart')} className="flex-1 rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">← Carrito</button>
              <button onClick={goReview} disabled={!paymentReady} className="flex-[2] rounded-[10px] bg-magenta py-3 text-[13.5px] font-bold text-white disabled:opacity-50">Revisar cobro →</button>
            </>
          ) : (
            <>
              <button onClick={() => setStep('payment')} className="flex-1 rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">← Editar pago</button>
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
