import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAutoRefresh } from '../../lib/useAutoRefresh';
import { Cargando, ErrorCarga } from '../../components/EstadoCarga';
import { useAuth } from '../../auth/AuthContext';
import { useBranch } from '../../layout/BranchContext';
import { fmtRD, type BillingResponse, type BillPatient, type Receipt } from '../../lib/types';
import BillModal from './BillModal';
import ReceiptModal from './ReceiptModal';
import { useToast } from '../../components/Toast';

const todayISO = () => new Date().toISOString().slice(0, 10);

const METHOD_CHIP: Record<string, { bg: string; fg: string }> = {
  Efectivo: { bg: 'var(--ok-soft)', fg: 'var(--ok)' },
  Transferencia: { bg: 'var(--teal-soft)', fg: 'var(--teal)' },
  Tarjeta: { bg: 'var(--warn-soft)', fg: 'var(--warn)' },
  Azul: { bg: 'var(--navy-soft)', fg: 'var(--navy)' },
  Mixto: { bg: 'var(--magenta-soft)', fg: 'var(--magenta)' },
};

export default function BillingPage() {
  const { staff } = useAuth();
  const { activeBranch } = useBranch();
  const toast = useToast();
  const [data, setData] = useState<BillingResponse>({ stats: [], invoices: [] });
  const [porCobrar, setPorCobrar] = useState<BillPatient[]>([]); // pacientes con algo pendiente por cobrar
  const [date, setDate] = useState(todayISO());
  const [billOpen, setBillOpen] = useState(false);
  const [billFor, setBillFor] = useState<string | null>(null); // cobro preseleccionado desde la lista
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const isToday = date === todayISO();
  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('es-DO', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const branchQ = staff?.role === 'ADMIN' && activeBranch !== 'all' ? `&branch=${activeBranch}` : '';
  // Solo el administrador ve los montos (totales del día, monto por recibo). Recepción solo cobra.
  const showMoney = staff?.role === 'ADMIN';
  const gridCols = showMoney ? 'grid-cols-[.9fr_1.6fr_2fr_1fr_1.1fr_.9fr]' : 'grid-cols-[.9fr_1.6fr_2fr_1fr_.9fr]';

  const load = useCallback(() => {
    setCargando(true); setErrorCarga(null);
    api.get<BillingResponse>(`/invoices?date=${date}${branchQ}`)
      .then((r) => { setData(r); setCargando(false); })
      .catch((e) => { setErrorCarga(e instanceof Error ? e.message : 'Error'); setCargando(false); });
    // Lista "por cobrar": pacientes con cargos pendientes, saldo o servicio agendado.
    api.get<BillPatient[]>('/invoices/patients')
      .then((ps) => setPorCobrar(ps.filter((p) => p.pendingCharges.length > 0 || (p.treatmentsConSaldo ?? []).length > 0 || !!p.scheduled)))
      .catch(() => setPorCobrar([]));
  }, [date, branchQ]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);

  function shiftDate(days: number) {
    const d = new Date(date + 'T00:00:00'); d.setDate(d.getDate() + days); setDate(d.toISOString().slice(0, 10));
  }

  async function reprint(id: string) {
    const r = await api.get<Receipt>(`/invoices/${id}/receipt`);
    setReceipt(r);
  }

  async function editPending(charge: BillPatient['pendingCharges'][number]) {
    const name = window.prompt('Concepto del cobro pendiente:', charge.name);
    if (name === null) return;
    const priceText = window.prompt('Monto pendiente en RD$:', String(charge.price));
    if (priceText === null) return;
    const price = Number(priceText.replace(/,/g, ''));
    if (!name.trim() || !Number.isInteger(price) || price < 0) { toast('Escribe un concepto y un monto válido'); return; }
    try {
      const r = await api.patch<{ message: string }>(`/invoices/pending-charges/${charge.id}`, { name: name.trim(), price });
      toast(r.message); load();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo editar el cobro'); }
  }

  async function voidPending(charge: BillPatient['pendingCharges'][number]) {
    const reason = window.prompt(`Motivo para anular “${charge.name}”:`);
    if (reason === null) return;
    if (reason.trim().length < 3) { toast('Escribe un motivo de al menos 3 caracteres'); return; }
    if (!window.confirm(`¿Anular este cobro pendiente de ${fmtRD(charge.price)}? Quedará registrado en auditoría.`)) return;
    try {
      const r = await api.post<{ message: string }>(`/invoices/pending-charges/${charge.id}/void`, { reason: reason.trim() });
      toast(r.message); load();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo anular el cobro'); }
  }

  return (
    <div className="animate-fade">
      {/* Navegación por fecha (calendario) */}
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <button onClick={() => shiftDate(-1)} className="h-9 w-9 rounded-lg border border-line bg-card font-bold text-muted hover:border-magenta">‹</button>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-line bg-card px-3 py-2 text-[13px] font-semibold" />
        <button onClick={() => shiftDate(1)} className="h-9 w-9 rounded-lg border border-line bg-card font-bold text-muted hover:border-magenta">›</button>
        {!isToday && <button onClick={() => setDate(todayISO())} className="rounded-lg border border-line bg-card px-3 py-2 text-[12px] font-bold text-muted hover:border-magenta">Hoy</button>}
        <span className="ml-1 text-[13px] font-semibold capitalize text-muted">{dateLabel}</span>
      </div>

      {showMoney && (
        <div className="mb-[18px] flex flex-wrap gap-3.5">
          {data.stats.map((s) => (
            <div key={s.label} className="min-w-[140px] flex-1 rounded-xl border border-line bg-card px-[18px] py-4 shadow-card">
              <div className="text-xs font-semibold text-muted">{s.label}</div>
              <div className="mt-0.5 text-[21px] font-extrabold">{s.label.includes('Recibos') ? s.value : fmtRD(s.value)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="mb-3.5 flex items-center justify-between">
        <div className="text-base font-extrabold">{showMoney ? `Recibos ${isToday ? 'de hoy' : 'del día'}` : 'Cobro'}</div>
        <button onClick={() => setBillOpen(true)} className="flex items-center gap-1.5 rounded-[10px] bg-magenta px-[18px] py-2.5 text-[13.5px] font-bold text-white"><span className="text-base">+</span> Nuevo cobro</button>
      </div>

      {/* Por cobrar: pacientes con algo pendiente. Solo seleccionar y cobrar. */}
      {porCobrar.length > 0 && (
        <div className="mb-4 overflow-hidden rounded-base border border-line bg-card shadow-card">
          <div className="border-b border-line px-5 py-3 text-[13px] font-extrabold">Por cobrar · toca para cobrar <span className="text-muted">({porCobrar.length})</span></div>
          {porCobrar.map((p) => {
            const initials = p.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
            const saldos = p.treatmentsConSaldo ?? [];
            const resumen = p.pendingCharges.length > 0
              ? `${p.pendingCharges.map((c) => c.name).join(', ')} · ${fmtRD(p.pendingTotal)}`
              : saldos.length > 0
              ? `Saldo ${saldos.map((s) => s.name).join(', ')} · ${fmtRD(saldos.reduce((a, s) => a + s.balance, 0))}`
              : p.scheduled ? `Agendado: ${p.scheduled.name}${p.scheduled.price ? ` · ${fmtRD(p.scheduled.price)}` : ''}` : '';
            return (
              <div key={p.id}
                className="grid w-full grid-cols-[1fr_auto] items-center gap-3 border-b border-line-2 px-5 py-3 text-left hover:bg-bg">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-[12px] font-bold text-white" style={{ background: p.avatarColor }}>{initials}</div>
                  <div className="min-w-0"><div className="text-[13.5px] font-bold">{p.name}</div><div className="truncate text-[12px] text-muted">{resumen}</div></div>
                </div>
                <div className="flex flex-wrap justify-end gap-1.5">
                  {staff?.role === 'ADMIN' && p.pendingCharges.map((charge) => (
                    <span key={charge.id} className="flex gap-1">
                      <button type="button" onClick={() => editPending(charge)} className="rounded-[8px] border border-line bg-card px-2.5 py-1.5 text-[11.5px] font-bold text-muted hover:border-magenta hover:text-magenta">Editar</button>
                      <button type="button" onClick={() => voidPending(charge)} className="rounded-[8px] border border-line bg-card px-2.5 py-1.5 text-[11.5px] font-bold text-danger hover:border-danger">Anular</button>
                    </span>
                  ))}
                  <button type="button" onClick={() => setBillFor(p.id)} className="flex-none rounded-[9px] bg-magenta px-3.5 py-1.5 text-[12.5px] font-bold text-white">Cobrar →</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Recepción NO ve el listado de recibos cobrados; solo la acción de cobrar. */}
      {!showMoney && porCobrar.length === 0 && (
        <div className="rounded-base border border-line bg-card px-5 py-8 text-center text-sm text-muted shadow-card">
          No hay nada pendiente por cobrar. Pulsa <b>“Nuevo cobro”</b> para registrar un pago.
        </div>
      )}

      {showMoney && cargando && <Cargando texto="Cargando recibos del día…" />}
      {showMoney && !cargando && errorCarga && <ErrorCarga mensaje={errorCarga} onRetry={load} />}

      {showMoney && !cargando && !errorCarga && (
      <div className="overflow-x-auto rounded-base border border-line bg-card shadow-card">
        <div className="min-w-[640px]">
        <div className={`grid ${gridCols} gap-3 border-b border-line px-5 py-3 text-[11.5px] font-bold uppercase tracking-wide text-muted`}>
          <div>Recibo</div><div>Paciente</div><div>Concepto</div><div>Método</div>{showMoney && <div>Monto</div>}<div>Estado</div>
        </div>
        {data.invoices.length === 0 && <div className="px-5 py-10 text-center text-sm text-muted">No se emitieron recibos en esta fecha.</div>}
        {data.invoices.map((i) => {
          const chip = METHOD_CHIP[i.method] ?? METHOD_CHIP.Azul;
          return (
            <button key={i.id} type="button" onClick={() => reprint(i.id)}
              aria-label={`Ver recibo ${i.number} de ${i.patient}`}
              className={`grid w-full cursor-pointer ${gridCols} items-center gap-3 border-b border-line-2 px-5 py-3.5 text-left hover:bg-bg focus-visible:bg-bg`}>
              <div className="text-[13px] font-bold text-magenta">{i.number}</div>
              <div><div className="text-[13px] font-semibold">{i.patient}</div><div className="text-[11.5px] text-faint">{i.date} · {i.branchName}</div></div>
              <div className="text-[13px]">{i.concept}</div>
              <div>
                <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: chip.bg, color: chip.fg }}>{i.method}</span>
                {i.method === 'Mixto' && i.payments && (
                  <div className="mt-1.5 flex flex-col gap-0.5 text-[10.5px] leading-tight text-muted">
                    {i.payments.map((p) => <span key={p.method}>{p.method}: <b>{fmtRD(p.amount)}</b></span>)}
                  </div>
                )}
              </div>
              {showMoney && <div className="text-[13.5px] font-extrabold">{fmtRD(i.total)}</div>}
              <div><span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={i.status === 'Anulada' ? { background: 'var(--danger-soft)', color: 'var(--danger)' } : { background: 'var(--ok-soft)', color: 'var(--ok)' }}>{i.status}</span></div>
            </button>
          );
        })}
        </div>
      </div>
      )}

      {(billOpen || billFor) && <BillModal preselectId={billFor ?? undefined} onClose={() => { setBillOpen(false); setBillFor(null); }} onEmitted={(r) => { setReceipt(r); load(); }} />}
      {receipt && <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} onVoided={load} />}
    </div>
  );
}
