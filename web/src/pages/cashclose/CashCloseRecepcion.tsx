import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { fmtRD, type CashCloseToday } from '../../lib/types';

export default function CashCloseRecepcion() {
  const toast = useToast();
  const [denoms, setDenoms] = useState<number[]>([]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [vouchers, setVouchers] = useState<string[]>(['']);
  const [transfer, setTransfer] = useState('');
  const [azul, setAzul] = useState('');
  const [expenses, setExpenses] = useState<{ amount: string; note: string }[]>([]); // egresos del día
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<CashCloseToday>('/cashclose/today').then((d) => {
      setDenoms(d.denominations);
      setStatus(d.status);
      if (d.counted) {
        const q: Record<string, string> = {};
        Object.entries(d.counted.denominations || {}).forEach(([k, v]) => { q[k] = String(v); });
        setQty(q);
        setVouchers((d.counted.cardVouchers || []).map(String).concat(''));
        setTransfer(d.counted.countedTransfer ? String(d.counted.countedTransfer) : '');
        setAzul(d.counted.countedAzul ? String(d.counted.countedAzul) : '');
        setExpenses((d.counted.expenses ?? []).map((e) => ({ amount: String(e.amount), note: e.note })));
      }
    }).catch(() => {});
  }, []);

  const n = (s: string) => parseInt((s || '').replace(/[^0-9]/g, ''), 10) || 0;
  const cashTotal = denoms.reduce((s, d) => s + d * n(qty[String(d)] || ''), 0);
  const cardTotal = vouchers.reduce((s, v) => s + n(v), 0);
  const egresosTotal = expenses.reduce((s, e) => s + n(e.amount), 0);
  const grandTotal = cashTotal + cardTotal + n(transfer) + n(azul);
  const locked = status === 'CUADRADO';

  function nuevoCuadre() {
    setQty({}); setVouchers(['']); setTransfer(''); setAzul(''); setNotes(''); setExpenses([]);
  }
  const addEgreso = () => setExpenses((x) => [...x, { amount: '', note: '' }]);
  const setEgreso = (i: number, patch: Partial<{ amount: string; note: string }>) => setExpenses((x) => x.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const delEgreso = (i: number) => setExpenses((x) => x.filter((_, j) => j !== i));

  async function submit() {
    setBusy(true);
    try {
      const denominations: Record<string, number> = {};
      denoms.forEach((d) => { const q = n(qty[String(d)] || ''); if (q > 0) denominations[String(d)] = q; });
      const cardVouchers = vouchers.map(n).filter((v) => v > 0);
      const egresos = expenses.map((e) => ({ amount: n(e.amount), note: e.note.trim() })).filter((e) => e.amount > 0 && e.note);
      const r = await api.post<{ message: string }>('/cashclose', {
        denominations, cardVouchers, countedTransfer: n(transfer), countedAzul: n(azul), expenses: egresos, notes: notes || undefined,
      });
      toast(r.message);
      setStatus('ENVIADO');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al enviar');
    } finally { setBusy(false); }
  }

  return (
    <div className="animate-fade">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex-1 rounded-base border px-4 py-3 text-[12.5px]" style={{ background: 'var(--warn-soft)', borderColor: '#F0D9A8', color: '#7A5A12' }}>
          🔒 <b>Conteo ciego:</b> ingresa lo que hay físicamente en caja. No verás el total esperado; administración validará faltantes o sobrantes.
        </div>
        <button onClick={nuevoCuadre} disabled={locked} className="flex-none rounded-[10px] border border-line bg-card px-4 py-3 text-[13px] font-bold text-navy hover:border-magenta disabled:opacity-50">↻ Nuevo cuadre</button>
      </div>

      {status && (
        <div className="mb-4 rounded-base border px-4 py-3 text-[13px] font-bold" style={{ background: locked ? 'var(--ok-soft)' : 'var(--teal-soft)', borderColor: locked ? '#CDEBDD' : '#CFE2F0', color: locked ? '#1F7A54' : '#1E5A82' }}>
          {locked ? '✓ Cierre cuadrado por administración (bloqueado)' : '● Enviado a administración · puedes reenviar si corriges algo'}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
        {/* Efectivo por denominación */}
        <div className="rounded-base border border-line bg-card p-5 shadow-card">
          <div className="mb-3 text-[15px] font-extrabold">Efectivo · denominaciones (RD$)</div>
          <div className="flex flex-col gap-2">
            {denoms.map((d) => {
              const sub = d * n(qty[String(d)] || '');
              return (
                <div key={d} className="flex items-center gap-3">
                  <div className="w-[70px] text-right text-[13px] font-bold">{fmtRD(d)}</div>
                  <span className="text-muted">×</span>
                  <input disabled={locked} value={qty[String(d)] || ''} onChange={(e) => setQty({ ...qty, [String(d)]: e.target.value })} placeholder="0" className="w-20 rounded-[9px] border border-line px-3 py-2 text-[13px] outline-none focus:border-magenta disabled:opacity-60" />
                  <div className="flex-1 text-right text-[13px] font-semibold text-muted">{sub ? fmtRD(sub) : '—'}</div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex justify-between border-t border-line-2 pt-3 text-[14px] font-extrabold"><span>Total efectivo contado</span><span className="text-magenta">{fmtRD(cashTotal)}</span></div>
        </div>

        {/* Tarjetas + otros */}
        <div className="flex flex-col gap-4">
          <div className="rounded-base border border-line bg-card p-5 shadow-card">
            <div className="mb-3 text-[15px] font-extrabold">Vouchers de tarjeta (RD$)</div>
            <div className="flex flex-col gap-2">
              {vouchers.map((v, i) => (
                <input key={i} disabled={locked} value={v}
                  onChange={(e) => {
                    const next = [...vouchers]; next[i] = e.target.value;
                    // añade una fila vacía al final si se llenó la última
                    if (i === vouchers.length - 1 && e.target.value) next.push('');
                    setVouchers(next);
                  }}
                  placeholder="Monto del voucher" className="rounded-[9px] border border-line px-3 py-2 text-[13px] outline-none focus:border-magenta disabled:opacity-60" />
              ))}
            </div>
            <div className="mt-3 flex justify-between border-t border-line-2 pt-3 text-[14px] font-extrabold"><span>Total tarjetas</span><span className="text-magenta">{fmtRD(cardTotal)}</span></div>
          </div>
          <div className="rounded-base border border-line bg-card p-5 shadow-card">
            <label className="mb-2.5 block"><span className="mb-1 block text-[11.5px] font-bold text-muted">Transferencias (total)</span><input disabled={locked} value={transfer} onChange={(e) => setTransfer(e.target.value)} placeholder="0" className="w-full rounded-[9px] border border-line px-3 py-2 text-[13px] disabled:opacity-60" /></label>
            <label className="block"><span className="mb-1 block text-[11.5px] font-bold text-muted">Azul (total)</span><input disabled={locked} value={azul} onChange={(e) => setAzul(e.target.value)} placeholder="0" className="w-full rounded-[9px] border border-line px-3 py-2 text-[13px] disabled:opacity-60" /></label>
          </div>
        </div>
      </div>

      {/* Egresos / compras menores del día: salidas de efectivo, cada una con su nota. */}
      <div className="mt-4 rounded-base border border-line bg-card p-5 shadow-card">
        <div className="mb-1 flex items-center justify-between">
          <div className="text-[15px] font-extrabold">Egresos / compras menores</div>
          <button onClick={addEgreso} disabled={locked} className="rounded-[9px] border border-line bg-bg px-3 py-1.5 text-[12px] font-bold text-magenta disabled:opacity-50">+ Agregar egreso</button>
        </div>
        <div className="mb-3 text-[11.5px] text-muted">Salidas de efectivo de la caja (compras menores, mandados, etc.). Cada una con su nota; se descuentan del efectivo esperado.</div>
        <div className="flex flex-col gap-2">
          {expenses.map((e, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="flex items-center rounded-[9px] border border-line bg-card px-2">
                <span className="text-[11px] font-bold text-faint">RD$</span>
                <input disabled={locked} value={e.amount} onChange={(ev) => setEgreso(i, { amount: ev.target.value.replace(/[^0-9]/g, '') })} inputMode="numeric" placeholder="0" className="w-20 bg-transparent px-1 py-2 text-right text-[13px] font-bold outline-none disabled:opacity-60" />
              </div>
              <input disabled={locked} value={e.note} onChange={(ev) => setEgreso(i, { note: ev.target.value })} placeholder="¿En qué se usó? (ej. papel de baño, taxi de insumos)" className="flex-1 rounded-[9px] border border-line px-3 py-2 text-[13px] outline-none focus:border-magenta disabled:opacity-60" />
              <button onClick={() => delEgreso(i)} disabled={locked} className="flex-none rounded-md px-2 text-[15px] font-bold text-muted hover:text-danger disabled:opacity-50">×</button>
            </div>
          ))}
          {expenses.length === 0 && <div className="rounded-[9px] bg-bg px-3 py-2.5 text-[12.5px] text-muted">Sin egresos. Si sacaste efectivo para una compra menor, agrégalo aquí con su nota.</div>}
        </div>
        {egresosTotal > 0 && <div className="mt-3 flex justify-between border-t border-line-2 pt-3 text-[14px] font-extrabold"><span>Total egresos</span><span className="text-danger">− {fmtRD(egresosTotal)}</span></div>}
      </div>

      <div className="mt-4 flex items-center gap-4 rounded-base border border-line bg-card p-5 shadow-card">
        <label className="flex-1"><span className="mb-1 block text-[11.5px] font-bold text-muted">Notas (opcional)</span><input disabled={locked} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observaciones del cierre" className="w-full rounded-[9px] border border-line px-3 py-2 text-[13px] disabled:opacity-60" /></label>
        <div className="text-right"><div className="text-[11.5px] font-semibold text-muted">Total contado (todos los métodos)</div><div className="text-[20px] font-extrabold">{fmtRD(grandTotal)}</div></div>
        <button onClick={submit} disabled={busy || locked} className="rounded-[10px] bg-magenta px-6 py-3 text-[13.5px] font-bold text-white disabled:opacity-50">{busy ? 'Enviando…' : 'Enviar cierre'}</button>
      </div>
    </div>
  );
}
