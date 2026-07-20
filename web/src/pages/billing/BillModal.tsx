import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { Overlay, stop } from '../../components/Modal';
import { fmtRD, type BillPatient, type CatalogItem, type PaymentMethod, type Receipt } from '../../lib/types';

const KIND_TAG: Record<string, string> = { SERVICIO: 'Servicio', PAQUETE: 'Paquete', COMBO: 'Combo' };

const METHODS: PaymentMethod[] = ['EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'AZUL'];
const METHOD_LABEL: Record<PaymentMethod, string> = { EFECTIVO: 'Efectivo', TRANSFERENCIA: 'Transferencia', TARJETA: 'Tarjeta', AZUL: 'Azul' };
type PayKind = 'TOTAL' | 'ABONO' | 'SALDO';
const KIND_LABEL: Record<PayKind, string> = { TOTAL: 'Pago factura total', ABONO: 'Abono', SALDO: 'Saldo pendiente' };

interface Props { preselectId?: string; onClose: () => void; onEmitted: (r: Receipt) => void }

export default function BillModal({ preselectId, onClose, onEmitted }: Props) {
  const toast = useToast();
  const [patients, setPatients] = useState<BillPatient[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [selected, setSelected] = useState<string | null>(preselectId ?? null);
  const [concept, setConcept] = useState('');
  const [catalogId, setCatalogId] = useState(''); // servicio/paquete elegido del catálogo
  const [amount, setAmount] = useState('');
  const [chargeIds, setChargeIds] = useState<string[]>([]);
  const [treatmentId, setTreatmentId] = useState<string | null>(null);
  const [payKind, setPayKind] = useState<PayKind>('TOTAL');
  const [fullAmount, setFullAmount] = useState(''); // precio total del combo (abono a concepto libre)
  // Pago dividido: monto por método
  const [split, setSplit] = useState<Record<PaymentMethod, string>>({ EFECTIVO: '', TRANSFERENCIA: '', TARJETA: '', AZUL: '' });
  const [step, setStep] = useState<'form' | 'review'>('form');
  const [busy, setBusy] = useState(false);
  const [pQuery, setPQuery] = useState('');
  const [loadingP, setLoadingP] = useState(true);
  const [errP, setErrP] = useState(false);

  const current = patients.find((p) => p.id === selected) ?? null;
  const t = current?.treatment ?? null;
  const hasBalance = !!t && t.balance > 0;
  const hasCharges = chargeIds.length > 0; // servicios pendientes por cobrar
  // Abono a un combo/compra "libre" (sin tratamiento ni cargos): pide el precio total.
  const freeAbono = payKind === 'ABONO' && !t && !hasCharges;

  function loadPatients() {
    setLoadingP(true); setErrP(false);
    api.get<BillPatient[]>('/invoices/patients').then((ps) => {
      setPatients(ps); setLoadingP(false);
      if (preselectId) applyPatient(ps.find((p) => p.id === preselectId));
    }).catch(() => { setLoadingP(false); setErrP(true); });
  }
  useEffect(() => {
    loadPatients();
    // Catálogo real: solo servicios, paquetes y combos (para mantener la base de datos consistente).
    api.get<CatalogItem[]>('/catalog').then((all) => setCatalog(all.filter((i) => i.kind === 'SERVICIO' || i.kind === 'PAQUETE' || i.kind === 'COMBO'))).catch(() => setCatalog([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Elegir un ítem del catálogo fija el concepto y el monto desde el precio real.
  function pickCatalog(id: string) {
    setCatalogId(id);
    const item = catalog.find((c) => c.id === id);
    if (!item) { setConcept(''); return; }
    setConcept(item.name);
    setAmountDefault(String(item.price));
  }

  const filteredPatients = patients.filter((p) => {
    const q = pQuery.trim().toLowerCase();
    return !q || p.name.toLowerCase().includes(q) || (p.phone ?? '').includes(q);
  });

  // Fija el monto y, por defecto, lo carga TODO en Efectivo (se puede repartir luego).
  function setAmountDefault(v: string) {
    setAmount(v);
    const num = parseInt((v || '').replace(/[^0-9]/g, ''), 10) || 0;
    setSplit({ EFECTIVO: num > 0 ? String(num) : '', TRANSFERENCIA: '', TARJETA: '', AZUL: '' });
  }

  function applyPatient(p?: BillPatient) {
    if (!p) return;
    setSelected(p.id);
    setCatalogId('');
    if (p.pendingCharges.length) {
      setConcept(p.pendingCharges.map((c) => c.name).join(' + '));
      setAmountDefault(String(p.pendingTotal)); setChargeIds(p.pendingCharges.map((c) => c.id));
      setTreatmentId(null); setPayKind('TOTAL');
    } else if (p.treatment && p.treatment.balance > 0) {
      setConcept(`Saldo ${p.treatment.name}`); setTreatmentId(p.treatment.id);
      setPayKind('SALDO'); setAmountDefault(String(p.treatment.balance)); setChargeIds([]);
    } else {
      setConcept(p.plan !== 'Sin paquete' ? `Paquete ${p.plan}` : '');
      setAmountDefault(p.treatment ? String(p.treatment.price) : ''); setTreatmentId(p.treatment?.id ?? null);
      setPayKind('TOTAL'); setChargeIds([]);
    }
  }

  function setKind(k: PayKind) {
    setPayKind(k);
    if (t) {
      if (k === 'SALDO') setAmountDefault(String(t.balance));
      else if (k === 'TOTAL') setAmountDefault(String(t.price));
      else setAmountDefault(''); // abono: monto libre
    } else if (hasCharges) {
      if (k === 'TOTAL') setAmountDefault(String(current?.pendingTotal ?? 0));
      else setAmountDefault(''); // abono a servicios: monto libre
    }
  }

  const amt = parseInt((amount || '').replace(/[^0-9]/g, ''), 10) || 0;
  const fullAmt = parseInt((fullAmount || '').replace(/[^0-9]/g, ''), 10) || 0;
  const freePending = Math.max(0, fullAmt - amt); // saldo que quedará pendiente
  const assigned = METHODS.reduce((s, m) => s + (parseInt(split[m].replace(/[^0-9]/g, ''), 10) || 0), 0);
  const remaining = amt - assigned;
  const paymentsList = METHODS.map((m) => ({ method: m, amount: parseInt(split[m].replace(/[^0-9]/g, ''), 10) || 0 })).filter((p) => p.amount > 0);
  const balanceAfter = t ? Math.max(0, t.balance - amt) : 0;

  function quickFill(m: PaymentMethod) {
    const s: Record<PaymentMethod, string> = { EFECTIVO: '', TRANSFERENCIA: '', TARJETA: '', AZUL: '' };
    s[m] = String(amt);
    setSplit(s);
  }

  function validate(): string | null {
    if (!concept.trim()) return 'Falta el concepto';
    if (!amt) return 'Falta el monto';
    if (freeAbono && fullAmt <= amt) return 'El precio total del combo debe ser mayor que el abono';
    if (assigned !== amt) return `El pago dividido (${fmtRD(assigned)}) debe sumar el total (${fmtRD(amt)})`;
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
        patientId: selected ?? undefined, concept: concept.trim(),
        payments: paymentsList, treatmentId: treatmentId ?? undefined,
        // Abono aplica también a un combo/compra libre (con paciente); si no, TOTAL.
        paymentKind: (treatmentId || chargeIds.length || (freeAbono && selected)) ? payKind : 'TOTAL',
        chargeItemIds: chargeIds.length ? chargeIds : undefined,
        fullAmount: freeAbono && selected ? fullAmt : undefined,
      });
      toast(r.message); onEmitted(r.receipt); onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al emitir');
    } finally { setBusy(false); }
  }

  return (
    <Overlay onClose={onClose} z={110}>
      <div onClick={stop} className="flex w-[480px] max-w-full flex-col overflow-hidden rounded-2xl bg-card animate-pop" style={{ boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
        <div className="flex items-center border-b border-line px-6 py-5">
          <div className="flex-1 text-base font-extrabold">{step === 'form' ? 'Registrar cobro' : 'Validar cobro'}</div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg bg-bg text-muted">×</button>
        </div>

        {step === 'form' ? (
          <div className="flex flex-col gap-3.5 px-6 py-5">
            <div>
              <span className="mb-1.5 block text-xs font-bold text-muted">Seleccionar paciente</span>
              <input value={pQuery} onChange={(e) => setPQuery(e.target.value)} placeholder="🔍 Buscar por nombre o teléfono…"
                className="mb-1.5 w-full rounded-[9px] border border-line px-3 py-2.5 text-[13px] outline-none focus:border-magenta" />
              <div className="flex max-h-[150px] flex-col gap-1.5 overflow-y-auto rounded-[11px] border border-line-2 p-2">
                {loadingP && <div className="px-2.5 py-3 text-center text-[12.5px] text-muted">Cargando pacientes…</div>}
                {errP && (
                  <button onClick={loadPatients} className="px-2.5 py-3 text-center text-[12.5px] font-bold text-magenta">
                    No se pudieron cargar los pacientes. Toca para reintentar.
                  </button>
                )}
                {!loadingP && !errP && filteredPatients.length === 0 && (
                  <div className="px-2.5 py-3 text-center text-[12.5px] text-muted">{patients.length === 0 ? 'No hay pacientes en esta sucursal todavía.' : 'Ningún paciente coincide con la búsqueda.'}</div>
                )}
                {filteredPatients.map((p) => {
                  const on = selected === p.id;
                  const initials = p.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
                  return (
                    <div key={p.id} onClick={() => applyPatient(p)} className="flex cursor-pointer items-center gap-2.5 rounded-[9px] px-2.5 py-2" style={{ background: on ? 'var(--magenta-soft)' : 'transparent' }}>
                      <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-[11.5px] font-bold text-white" style={{ background: p.avatarColor }}>{initials}</div>
                      <div className="min-w-0 flex-1"><div className="text-[13px] font-bold">{p.name}</div><div className="text-[11.5px] text-muted">{p.plan}{p.balance > 0 ? ` · saldo ${fmtRD(p.balance)}` : ''}</div></div>
                      {on && <span className="font-extrabold text-magenta">✓</span>}
                    </div>
                  );
                })}
              </div>
              {current && <div className="mt-1.5 text-[12px] font-semibold text-magenta">Paciente: {current.name}</div>}
            </div>

            {/* Tipo de pago */}
            <div>
              <span className="mb-1.5 block text-xs font-bold text-muted">Tipo de pago</span>
              <div className="flex gap-2">
                {(['TOTAL', 'ABONO', 'SALDO'] as const).map((k) => {
                  const on = payKind === k;
                  // Abono disponible con cualquier paciente (combo/compra o tratamiento);
                  // saldo solo cuando ya hay un tratamiento con saldo.
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
              {!t && hasCharges && payKind === 'ABONO' && (
                <div className="mt-2 rounded-md bg-bg px-2.5 py-1.5 text-[11.5px] text-muted">Total servicios: <b>{fmtRD(current?.pendingTotal ?? 0)}</b>. Abono de <b>{fmtRD(amt)}</b> · queda pendiente <b style={{ color: 'var(--danger)' }}>{fmtRD(Math.max(0, (current?.pendingTotal ?? 0) - amt))}</b>.</div>
              )}
              {freeAbono && (
                <div className="mt-2 flex flex-col gap-2">
                  <label className="flex flex-col gap-1"><span className="text-[11.5px] font-bold text-muted">Precio total del combo/compra (RD$)</span>
                    <input value={fullAmount} onChange={(e) => setFullAmount(e.target.value)} placeholder="Ej. 18000" className="rounded-[9px] border border-line px-3 py-2.5 text-[13px] outline-none focus:border-magenta" /></label>
                  {fullAmt > 0 && <div className="rounded-md bg-bg px-2.5 py-1.5 text-[11.5px] text-muted">Abono de <b>{fmtRD(amt)}</b> de <b>{fmtRD(fullAmt)}</b> · queda pendiente <b style={{ color: 'var(--danger)' }}>{fmtRD(freePending)}</b>.</div>}
                </div>
              )}
            </div>

            {/* Servicio/paquete: se elige del catálogo real para mantener la base de datos.
                Si ya hay servicios pendientes o un tratamiento, el concepto viene de esos registros. */}
            {(t || hasCharges) ? (
              <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Servicio o paquete</span>
                <div className="rounded-[9px] border border-line-2 bg-bg px-3.5 py-3 text-[13.5px] font-semibold">{concept || '—'}</div>
                <span className="text-[11px] text-faint">Tomado de los servicios/tratamiento ya registrados del paciente.</span>
              </label>
            ) : (
              <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Servicio o paquete</span>
                <select value={catalogId} onChange={(e) => pickCatalog(e.target.value)} className="rounded-[9px] border border-line bg-card px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta">
                  <option value="">Selecciona del catálogo…</option>
                  {catalog.map((c) => <option key={c.id} value={c.id}>{KIND_TAG[c.kind] ?? c.kind} · {c.name} — {fmtRD(c.price)}</option>)}
                </select>
                {catalog.length === 0 && <span className="text-[11px] text-faint">No hay servicios en el catálogo todavía. Créalos en Catálogo.</span>}
              </label>
            )}
            <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">{freeAbono ? 'Monto a abonar' : 'Monto total'} (RD$) · ITBIS 18% incluido</span><input value={amount} onChange={(e) => setAmountDefault(e.target.value)} placeholder="18000" className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] font-bold outline-none focus:border-magenta" /></label>

            {/* Pago dividido por método */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-bold text-muted">Métodos de pago (puede dividir)</span>
                <span className="text-[11.5px] font-bold" style={{ color: remaining === 0 ? 'var(--ok)' : 'var(--warn)' }}>{fmtRD(assigned)} / {fmtRD(amt)}{remaining !== 0 ? ` · falta ${fmtRD(remaining)}` : ' ✓'}</span>
              </div>
              <div className="flex flex-col gap-2">
                {METHODS.map((m) => (
                  <div key={m} className="flex items-center gap-2">
                    <button onClick={() => quickFill(m)} title="Poner todo el monto aquí" className="w-[120px] rounded-[9px] border border-line bg-bg px-2 py-2 text-left text-[12px] font-bold text-navy hover:border-magenta">{METHOD_LABEL[m]}</button>
                    <input value={split[m]} onChange={(e) => setSplit({ ...split, [m]: e.target.value })} placeholder="0" className="flex-1 rounded-[9px] border border-line px-3 py-2 text-[13px] outline-none focus:border-magenta" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          // Paso Validar: revisión antes de emitir
          <div className="flex flex-col gap-3 px-6 py-5">
            <Row k="Paciente" v={current?.name ?? 'Cliente'} />
            <Row k="Tipo de pago" v={KIND_LABEL[(treatmentId || hasCharges || freeAbono) ? payKind : 'TOTAL']} />
            <Row k="Concepto" v={concept} />
            {freeAbono && fullAmt > 0 && <Row k="Saldo pendiente" v={fmtRD(freePending)} />}
            <div className="rounded-[11px] border border-line-2 p-3">
              <div className="mb-1.5 text-[11.5px] font-bold text-muted">Desglose de pago</div>
              {paymentsList.map((p) => <div key={p.method} className="flex justify-between py-0.5 text-[13px]"><span>{METHOD_LABEL[p.method]}</span><span className="font-bold">{fmtRD(p.amount)}</span></div>)}
              <div className="mt-1.5 flex justify-between border-t border-line-2 pt-1.5 text-[14px] font-extrabold"><span>Total</span><span className="text-magenta">{fmtRD(amt)}</span></div>
            </div>
            {t && (payKind === 'ABONO' || payKind === 'SALDO') && (
              <div className="rounded-md px-3 py-2 text-[12px] font-semibold" style={{ background: 'var(--teal-soft)', color: '#1E5A82' }}>Saldo tras el pago: {fmtRD(balanceAfter)}{balanceAfter > 0 && t.remaining > 0 ? ` · ${fmtRD(Math.round(balanceAfter / t.remaining))}/sesión` : ''}</div>
            )}
            <div className="text-[11.5px] text-faint">Revisa los datos. Al confirmar se emite el recibo y se registra en caja.</div>
          </div>
        )}

        <div className="flex gap-2.5 border-t border-line px-6 py-4">
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
