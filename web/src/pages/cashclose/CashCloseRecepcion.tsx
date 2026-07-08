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
      }
    }).catch(() => {});
  }, []);

  const n = (s: string) => parseInt((s || '').replace(/[^0-9]/g, ''), 10) || 0;
  const cashTotal = denoms.reduce((s, d) => s + d * n(qty[String(d)] || ''), 0);
  const cardTotal = vouchers.reduce((s, v) => s + n(v), 0);
  const grandTotal = cashTotal + cardTotal + n(transfer) + n(azul);
  const locked = status === 'CUADRADO';

  async function submit() {
    setBusy(true);
    try {
      const denominations: Record<string, number> = {};
      denoms.forEach((d) => { const q = n(qty[String(d)] || ''); if (q > 0) denominations[String(d)] = q; });
      const cardVouchers = vouchers.map(n).filter((v) => v > 0);
      const r = await api.post<{ message: string }>('/cashclose', {
        denominations, cardVouchers, countedTransfer: n(transfer), countedAzul: n(azul), notes: notes || undefined,
      });
      toast(r.message);
      setStatus('ENVIADO');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al enviar');
    } finally { setBusy(false); }
  }

  return (
    <div className="animate-fade">
      <div className="mb-4 rounded-base border px-4 py-3 text-[12.5px]" style={{ background: 'var(--warn-soft)', borderColor: '#F0D9A8', color: '#7A5A12' }}>
        🔒 <b>Conteo ciego:</b> ingresa lo que hay físicamente en caja. No verás el total esperado; administración validará faltantes o sobrantes.
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

      <div className="mt-4 flex items-center gap-4 rounded-base border border-line bg-card p-5 shadow-card">
        <label className="flex-1"><span className="mb-1 block text-[11.5px] font-bold text-muted">Notas (opcional)</span><input disabled={locked} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observaciones del cierre" className="w-full rounded-[9px] border border-line px-3 py-2 text-[13px] disabled:opacity-60" /></label>
        <div className="text-right"><div className="text-[11.5px] font-semibold text-muted">Total contado (todos los métodos)</div><div className="text-[20px] font-extrabold">{fmtRD(grandTotal)}</div></div>
        <button onClick={submit} disabled={busy || locked} className="rounded-[10px] bg-magenta px-6 py-3 text-[13.5px] font-bold text-white disabled:opacity-50">{busy ? 'Enviando…' : 'Enviar cierre'}</button>
      </div>
    </div>
  );
}
