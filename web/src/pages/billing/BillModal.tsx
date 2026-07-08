import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { Overlay, stop } from '../../components/Modal';
import { fmtRD, type BillPatient, type PaymentMethod, type Receipt } from '../../lib/types';

const METHODS: PaymentMethod[] = ['EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'AZUL'];
const METHOD_LABEL: Record<PaymentMethod, string> = { EFECTIVO: 'Efectivo', TRANSFERENCIA: 'Transferencia', TARJETA: 'Tarjeta', AZUL: 'Azul' };

interface Props { preselectId?: string; onClose: () => void; onEmitted: (r: Receipt) => void }

export default function BillModal({ preselectId, onClose, onEmitted }: Props) {
  const toast = useToast();
  const [patients, setPatients] = useState<BillPatient[]>([]);
  const [selected, setSelected] = useState<string | null>(preselectId ?? null);
  const [concept, setConcept] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('EFECTIVO');
  const [chargeIds, setChargeIds] = useState<string[]>([]);
  const [treatmentId, setTreatmentId] = useState<string | null>(null);
  const [payKind, setPayKind] = useState<'TOTAL' | 'ABONO'>('TOTAL');
  const [busy, setBusy] = useState(false);

  const current = patients.find((p) => p.id === selected) ?? null;

  useEffect(() => {
    api.get<BillPatient[]>('/invoices/patients').then((ps) => {
      setPatients(ps);
      if (preselectId) applyPatient(ps.find((p) => p.id === preselectId));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyPatient(p?: BillPatient) {
    if (!p) return;
    setSelected(p.id);
    if (p.pendingCharges.length) {
      setConcept(p.pendingCharges.map((c) => c.name).join(' + '));
      setAmount(String(p.pendingTotal));
      setChargeIds(p.pendingCharges.map((c) => c.id));
      setTreatmentId(null);
      setPayKind('TOTAL');
    } else if (p.treatment && p.treatment.balance > 0) {
      // Tiene saldo pendiente del paquete → abono/pago del tratamiento
      setConcept(`Abono ${p.treatment.name}`);
      setTreatmentId(p.treatment.id);
      setPayKind('ABONO');
      setAmount(String(p.treatment.balance));
      setChargeIds([]);
    } else {
      setConcept(p.plan !== 'Sin paquete' ? `Paquete ${p.plan}` : '');
      setAmount(p.treatment ? String(p.treatment.price) : '');
      setTreatmentId(p.treatment?.id ?? null);
      setPayKind('TOTAL');
      setChargeIds([]);
    }
  }

  // Al cambiar total/abono, ajusta el monto sugerido.
  function setKind(k: 'TOTAL' | 'ABONO') {
    setPayKind(k);
    if (current?.treatment) setAmount(k === 'TOTAL' ? String(current.treatment.balance) : '');
  }

  const t = current?.treatment ?? null;
  const amt = parseInt((amount || '').replace(/[^0-9]/g, ''), 10) || 0;
  const balanceAfter = t ? Math.max(0, t.balance - amt) : 0;
  const remaining = t?.remaining ?? 0;

  async function emit() {
    if (!concept.trim() || !amt) { toast('Concepto y monto requeridos'); return; }
    setBusy(true);
    try {
      const r = await api.post<{ receipt: Receipt; message: string }>('/invoices', {
        patientId: selected ?? undefined, concept: concept.trim(), amount: amt, method,
        chargeItemIds: chargeIds.length ? chargeIds : undefined,
        treatmentId: treatmentId ?? undefined,
        paymentKind: treatmentId ? payKind : 'TOTAL',
      });
      toast(r.message);
      onEmitted(r.receipt);
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al emitir');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay onClose={onClose} z={110}>
      <div onClick={stop} className="flex max-h-[92vh] w-[480px] max-w-full flex-col overflow-hidden rounded-2xl bg-card animate-pop" style={{ boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
        <div className="flex items-center border-b border-line px-6 py-5"><div className="flex-1 text-base font-extrabold">Registrar cobro</div><button onClick={onClose} className="h-8 w-8 rounded-lg bg-bg text-muted">×</button></div>
        <div className="flex flex-col gap-3.5 overflow-y-auto px-6 py-5">
          <div>
            <span className="mb-1.5 block text-xs font-bold text-muted">Seleccionar paciente</span>
            <div className="flex max-h-[150px] flex-col gap-1.5 overflow-y-auto rounded-[11px] border border-line-2 p-2">
              {patients.map((p) => {
                const on = selected === p.id;
                const initials = p.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
                return (
                  <div key={p.id} onClick={() => applyPatient(p)} className="flex cursor-pointer items-center gap-2.5 rounded-[9px] px-2.5 py-2" style={{ background: on ? 'var(--magenta-soft)' : 'transparent' }}>
                    <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-[11.5px] font-bold text-white" style={{ background: p.avatarColor }}>{initials}</div>
                    <div className="min-w-0 flex-1"><div className="text-[13px] font-bold">{p.name}</div><div className="text-[11.5px] text-muted">{p.plan}{p.balance > 0 ? ` · saldo ${fmtRD(p.balance)}` : ''}{p.pendingTotal ? ` · ${fmtRD(p.pendingTotal)} por facturar` : ''}</div></div>
                    {on && <span className="font-extrabold text-magenta">✓</span>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tipo de pago cuando hay tratamiento con saldo */}
          {t && (
            <div className="rounded-[11px] border border-line bg-bg p-3">
              <div className="mb-2 flex items-center justify-between text-[12px]"><span className="font-bold text-navy">{t.name}</span><span className="text-muted">Saldo: <b style={{ color: t.balance > 0 ? 'var(--danger)' : 'var(--ok)' }}>{fmtRD(t.balance)}</b> de {fmtRD(t.price)}</span></div>
              <div className="flex gap-2">
                {(['TOTAL', 'ABONO'] as const).map((k) => {
                  const on = payKind === k;
                  return <button key={k} onClick={() => setKind(k)} className="flex-1 rounded-[9px] border py-2 text-[12.5px] font-bold" style={{ borderColor: on ? 'var(--magenta)' : 'var(--line)', background: on ? 'var(--magenta-soft)' : 'var(--card)', color: on ? 'var(--magenta)' : 'var(--muted)' }}>{k === 'TOTAL' ? 'Pago total' : 'Abono (parcial)'}</button>;
                })}
              </div>
              {payKind === 'ABONO' && amt > 0 && remaining > 0 && (
                <div className="mt-2 rounded-md bg-teal-soft px-2.5 py-1.5 text-[11.5px] font-semibold" style={{ color: '#1E5A82' }}>
                  Tras el abono: saldo {fmtRD(balanceAfter)} · {fmtRD(Math.round(balanceAfter / remaining))}/sesión en {remaining} sesiones restantes
                </div>
              )}
            </div>
          )}

          <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Concepto</span><input value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Servicio o paquete" className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" /></label>
          <label className="flex flex-col gap-1.5"><span className="text-xs font-bold text-muted">Monto (RD$) · ITBIS 18% incluido</span><input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="18000" className="rounded-[9px] border border-line px-3.5 py-3 text-[13.5px] font-bold outline-none focus:border-magenta" /></label>
          <div>
            <span className="mb-1.5 block text-xs font-bold text-muted">Método de pago</span>
            <div className="flex gap-2">
              {METHODS.map((m) => {
                const on = method === m;
                return <button key={m} onClick={() => setMethod(m)} className="flex-1 rounded-[9px] border py-2.5 text-[12.5px] font-bold" style={{ borderColor: on ? 'var(--magenta)' : 'var(--line)', background: on ? 'var(--magenta-soft)' : 'var(--card)', color: on ? 'var(--magenta)' : 'var(--muted)' }}>{METHOD_LABEL[m]}</button>;
              })}
            </div>
          </div>
        </div>
        <div className="flex gap-2.5 border-t border-line px-6 py-4">
          <button onClick={onClose} className="flex-1 rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">Cancelar</button>
          <button onClick={emit} disabled={busy} className="flex-[2] rounded-[10px] bg-navy py-3 text-[13.5px] font-bold text-white disabled:opacity-60">{payKind === 'ABONO' && treatmentId ? 'Registrar abono' : 'Emitir recibo'}</button>
        </div>
      </div>
    </Overlay>
  );
}
