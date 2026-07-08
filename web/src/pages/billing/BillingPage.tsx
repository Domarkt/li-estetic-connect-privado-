import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { fmtRD, type BillingResponse, type Receipt } from '../../lib/types';
import BillModal from './BillModal';
import ReceiptModal from './ReceiptModal';

const METHOD_CHIP: Record<string, { bg: string; fg: string }> = {
  Efectivo: { bg: 'var(--ok-soft)', fg: 'var(--ok)' },
  Transferencia: { bg: 'var(--teal-soft)', fg: 'var(--teal)' },
  Tarjeta: { bg: 'var(--warn-soft)', fg: 'var(--warn)' },
  Azul: { bg: 'var(--navy-soft)', fg: 'var(--navy)' },
};

export default function BillingPage() {
  const [data, setData] = useState<BillingResponse>({ stats: [], invoices: [] });
  const [billOpen, setBillOpen] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const load = useCallback(() => {
    api.get<BillingResponse>('/invoices').then(setData).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function reprint(id: string) {
    const r = await api.get<Receipt>(`/invoices/${id}/receipt`);
    setReceipt(r);
  }

  return (
    <div className="animate-fade">
      <div className="mb-[18px] flex gap-3.5">
        {data.stats.map((s) => (
          <div key={s.label} className="flex-1 rounded-xl border border-line bg-card px-[18px] py-4 shadow-card">
            <div className="text-xs font-semibold text-muted">{s.label}</div>
            <div className="mt-0.5 text-[21px] font-extrabold">{s.label.includes('Recibos') ? s.value : fmtRD(s.value)}</div>
          </div>
        ))}
      </div>

      <div className="mb-3.5 flex items-center justify-between">
        <div className="text-base font-extrabold">Recibos recientes</div>
        <button onClick={() => setBillOpen(true)} className="flex items-center gap-1.5 rounded-[10px] bg-magenta px-[18px] py-2.5 text-[13.5px] font-bold text-white"><span className="text-base">+</span> Nuevo cobro</button>
      </div>

      <div className="overflow-hidden rounded-base border border-line bg-card shadow-card">
        <div className="grid grid-cols-[.9fr_1.6fr_2fr_1fr_1.1fr_.9fr] gap-3 border-b border-line px-5 py-3 text-[11.5px] font-bold uppercase tracking-wide text-muted">
          <div>Recibo</div><div>Paciente</div><div>Concepto</div><div>Método</div><div>Monto</div><div>Estado</div>
        </div>
        {data.invoices.length === 0 && <div className="px-5 py-10 text-center text-sm text-muted">Sin recibos.</div>}
        {data.invoices.map((i) => {
          const chip = METHOD_CHIP[i.method] ?? METHOD_CHIP.Azul;
          return (
            <div key={i.id} onClick={() => reprint(i.id)} className="grid cursor-pointer grid-cols-[.9fr_1.6fr_2fr_1fr_1.1fr_.9fr] items-center gap-3 border-b border-line-2 px-5 py-3.5 hover:bg-bg">
              <div className="text-[13px] font-bold text-magenta">{i.number}</div>
              <div><div className="text-[13px] font-semibold">{i.patient}</div><div className="text-[11.5px] text-faint">{i.date} · {i.branchName}</div></div>
              <div className="text-[13px]">{i.concept}</div>
              <div><span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: chip.bg, color: chip.fg }}>{i.method}</span></div>
              <div className="text-[13.5px] font-extrabold">{fmtRD(i.total)}</div>
              <div><span className="rounded-full bg-ok-soft px-2.5 py-1 text-[11px] font-bold text-ok">{i.status}</span></div>
            </div>
          );
        })}
      </div>

      {billOpen && <BillModal onClose={() => setBillOpen(false)} onEmitted={(r) => { setReceipt(r); load(); }} />}
      {receipt && <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}
