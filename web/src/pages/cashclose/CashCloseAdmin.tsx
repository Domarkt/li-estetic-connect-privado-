import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useBranch } from '../../layout/BranchContext';
import { useToast } from '../../components/Toast';
import { fmtRD, type CashCloseAdminView } from '../../lib/types';

const METHOD_LABEL: Record<string, string> = { EFECTIVO: 'Efectivo', TARJETA: 'Tarjeta', TRANSFERENCIA: 'Transferencia', AZUL: 'Azul' };
const todayISO = () => new Date().toISOString().slice(0, 10);

const STATUS_META: Record<string, { label: string; bg: string; fg: string }> = {
  PENDIENTE: { label: 'Sin enviar', bg: 'var(--navy-soft)', fg: 'var(--muted)' },
  ENVIADO: { label: 'Enviado · por cuadrar', bg: 'var(--warn-soft)', fg: 'var(--warn)' },
  CUADRADO: { label: 'Cuadrado ✓', bg: 'var(--ok-soft)', fg: 'var(--ok)' },
};

type ExpectedEdits = Record<string, Record<string, string>>; // branchId -> method -> value

export default function CashCloseAdmin() {
  const { activeBranch } = useBranch();
  const toast = useToast();
  const [date, setDate] = useState(todayISO());
  const [data, setData] = useState<CashCloseAdminView | null>(null);
  const [edits, setEdits] = useState<ExpectedEdits>({});

  const load = useCallback(() => {
    const b = activeBranch !== 'all' ? `&branch=${activeBranch}` : '';
    api.get<CashCloseAdminView>(`/cashclose/admin?date=${date}${b}`).then((d) => {
      setData(d);
      // Precarga el esperado del sistema en los campos editables.
      const e: ExpectedEdits = {};
      d.branches.forEach((br) => { e[br.branchId] = {}; br.methods.forEach((m) => { e[br.branchId][m.method] = String(m.expected); }); });
      setEdits(e);
    }).catch(() => {});
  }, [date, activeBranch]);
  useEffect(() => { load(); }, [load]);

  const num = (s: string) => parseInt((s || '').replace(/[^0-9]/g, ''), 10) || 0;
  const expOf = (branchId: string, method: string) => num(edits[branchId]?.[method] ?? '');

  async function reconcile(closeId: string, branchId: string, branchName: string) {
    try {
      const r = await api.patch<{ message: string }>(`/cashclose/${closeId}/reconcile`, {
        expectedCash: expOf(branchId, 'EFECTIVO'),
        expectedCard: expOf(branchId, 'TARJETA'),
        expectedTransfer: expOf(branchId, 'TRANSFERENCIA'),
        expectedAzul: expOf(branchId, 'AZUL'),
      });
      toast(`${branchName}: ${r.message}`); load();
    } catch (e) { toast(e instanceof Error ? e.message : 'Error'); }
  }

  const diffColor = (d: number | null) => d == null ? 'var(--muted)' : d === 0 ? 'var(--ok)' : d > 0 ? 'var(--warn)' : 'var(--danger)';
  const diffLabel = (d: number | null) => d == null ? '—' : d === 0 ? 'Cuadra' : d > 0 ? `Sobrante ${fmtRD(d)}` : `Faltante ${fmtRD(Math.abs(d))}`;

  return (
    <div className="animate-fade">
      <div className="mb-4 flex items-center gap-3">
        <span className="text-[12.5px] font-bold text-muted">Fecha</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-line bg-card px-3 py-2 text-[13px]" />
        <span className="text-[12px] text-faint">Ingresa el total del sistema por método y valida contra lo que envió la sucursal (conteo ciego).</span>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {data?.branches.map((b) => {
          const st = STATUS_META[b.status];
          const locked = b.status === 'CUADRADO';
          const totalExpectedEdit = b.methods.reduce((s, m) => s + expOf(b.branchId, m.method), 0);
          const totalDiff = b.totalCounted == null ? null : b.totalCounted - totalExpectedEdit;
          return (
            <div key={b.branchId} className="rounded-base border border-line bg-card p-5 shadow-card">
              <div className="mb-4 flex items-center gap-2.5">
                <span className="h-3 w-3 rounded-full" style={{ background: b.dotColor }} />
                <div className="flex-1 text-base font-extrabold">{b.branchName}</div>
                <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
              </div>

              <div className="overflow-hidden rounded-[11px] border border-line-2">
                <div className="grid grid-cols-[1.1fr_1.1fr_1fr_1.1fr] gap-2 bg-navy-soft px-3 py-2 text-[11px] font-bold uppercase text-navy">
                  <div>Método</div><div className="text-right">Sistema</div><div className="text-right">Contado</div><div className="text-right">Diferencia</div>
                </div>
                {b.methods.map((m) => {
                  const exp = expOf(b.branchId, m.method);
                  const diff = m.counted == null ? null : m.counted - exp;
                  return (
                    <div key={m.method} className="grid grid-cols-[1.1fr_1.1fr_1fr_1.1fr] items-center gap-2 border-t border-line-2 px-3 py-1.5 text-[12.5px]">
                      <div className="font-semibold">{METHOD_LABEL[m.method]}</div>
                      <div>
                        <input disabled={locked} value={edits[b.branchId]?.[m.method] ?? ''}
                          onChange={(e) => setEdits((prev) => ({ ...prev, [b.branchId]: { ...prev[b.branchId], [m.method]: e.target.value } }))}
                          className="w-full rounded-md border border-line px-2 py-1 text-right text-[12.5px] outline-none focus:border-magenta disabled:opacity-60" />
                      </div>
                      <div className="text-right">{m.counted == null ? '—' : fmtRD(m.counted)}</div>
                      <div className="text-right font-bold" style={{ color: diffColor(diff) }}>{diff == null ? '—' : (diff === 0 ? '✓' : (diff > 0 ? '+' : '') + fmtRD(diff))}</div>
                    </div>
                  );
                })}
                <div className="grid grid-cols-[1.1fr_1.1fr_1fr_1.1fr] gap-2 border-t-2 border-line bg-bg px-3 py-2 text-[13px] font-extrabold">
                  <div>Total</div>
                  <div className="text-right">{fmtRD(totalExpectedEdit)}</div>
                  <div className="text-right">{b.totalCounted == null ? '—' : fmtRD(b.totalCounted)}</div>
                  <div className="text-right" style={{ color: diffColor(totalDiff) }}>{diffLabel(totalDiff)}</div>
                </div>
              </div>

              {b.cardVouchers && b.cardVouchers.length > 0 && (
                <div className="mt-2 text-[11.5px] text-muted">Vouchers recibidos: {b.cardVouchers.map((v) => fmtRD(v)).join(' · ')}</div>
              )}
              {b.notes && <div className="mt-1 text-[11.5px] text-muted">Nota: {b.notes}</div>}

              <div className="mt-4 flex items-center justify-between">
                {locked
                  ? <span className="text-[12.5px] font-bold text-ok">Cuadrada ✓</span>
                  : <span className="text-[12.5px] text-muted">{b.status === 'PENDIENTE' ? 'Recepción aún no envía el cierre' : 'Ingresa el sistema y valida'}</span>}
                <button disabled={b.status !== 'ENVIADO' || !b.closeId} onClick={() => b.closeId && reconcile(b.closeId, b.branchId, b.branchName)}
                  className="rounded-[10px] bg-navy px-5 py-2.5 text-[13px] font-bold text-white disabled:opacity-40">
                  Validar y cuadrar
                </button>
              </div>
            </div>
          );
        })}
        {data && data.branches.length === 0 && <div className="text-sm text-muted">Sin sucursales.</div>}
      </div>
    </div>
  );
}
