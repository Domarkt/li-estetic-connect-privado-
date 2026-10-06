import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../../lib/api';
import { fmtRD } from '../../lib/types';

interface ReportProps {
  branchId: string;
  branchName: string;
  date: string;
  openByDefault?: boolean;
}

interface InvoiceReportRow { status: string; total: number; number?: string; patient?: string }
interface ReceivableRow { patientName: string; monto: number; fecha: string; concept?: string }
interface PatientReportRow { fichaStatus?: string | null }
interface AppointmentReportRow { status: string; finished?: boolean }
interface DailyReportData {
  invoices: { invoices: InvoiceReportRow[] };
  receivables: { rows: ReceivableRow[]; total: number; count: number };
  patients: PatientReportRow[];
  appointments: { appointments: AppointmentReportRow[] };
}

/** Resumen operativo que acompaña la revisión del cierre, sin cambiar el cobro. */
export default function CashCloseDailyReport({ branchId, branchName, date, openByDefault = false }: ReportProps) {
  const [open, setOpen] = useState(openByDefault);
  const [data, setData] = useState<DailyReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    setOpen(openByDefault);
    setLoading(true);
    setError(false);
    setData(null);
    const qBranch = `&branch=${encodeURIComponent(branchId)}`;
    Promise.all([
      api.get<{ invoices: InvoiceReportRow[] }>(`/invoices?date=${encodeURIComponent(date)}${qBranch}`),
      api.get<{ rows: ReceivableRow[]; total: number; count: number }>(`/invoices/receivables?branch=${encodeURIComponent(branchId)}`),
      api.get<PatientReportRow[]>(`/patients?branch=${encodeURIComponent(branchId)}`),
      api.get<{ appointments: AppointmentReportRow[] }>(`/appointments?date=${encodeURIComponent(date)}${qBranch}`),
    ]).then(([invoices, receivables, patients, appointments]) => {
      setData({ invoices, receivables, patients, appointments });
    }).catch(() => setError(true)).finally(() => setLoading(false));
  }, [branchId, date, openByDefault]);

  const paid = data?.invoices.invoices.filter((i) => i.status === 'Pagada') ?? [];
  const receivedTotal = paid.reduce((sum, i) => sum + i.total, 0);
  const ficha = data?.patients.reduce((acc, p) => {
    const status = p.fichaStatus ?? 'PENDIENTE';
    if (status === 'COMPLETA') acc.completa += 1;
    else if (status === 'PASO1_OK' || status === 'EN_PROCESO') acc.proceso += 1;
    else acc.pendiente += 1;
    return acc;
  }, { pendiente: 0, proceso: 0, completa: 0 }) ?? { pendiente: 0, proceso: 0, completa: 0 };
  const appointments = data?.appointments.appointments ?? [];
  const cita = {
    confirmadas: appointments.filter((a) => a.status === 'CONFIRMADA').length,
    sinConfirmar: appointments.filter((a) => a.status === 'SIN_CONFIRMAR').length,
    atendidas: appointments.filter((a) => a.finished || a.status === 'COMPLETADA').length,
    canceladas: appointments.filter((a) => a.status === 'CANCELADA').length,
    reagendadas: appointments.filter((a) => a.status === 'REAGENDADA').length,
  };

  return (
    <section className="mt-4 rounded-base border border-line bg-card p-4 shadow-card">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between border-b border-line pb-3 text-left">
        <span className="text-[13px] font-extrabold text-magenta">📋 Informe completo del día — {branchName}</span>
        <span className="text-[12px] font-bold text-magenta">{open ? '▲ Ocultar' : '▼ Ver informe'}</span>
      </button>
      {open && (
        <div className="pt-3">
          {loading && <div className="rounded-[10px] bg-bg px-3 py-3 text-[12px] text-muted">Cargando informe…</div>}
          {error && <div className="rounded-[10px] border border-[#F0C9C4] bg-[var(--danger-soft)] px-3 py-3 text-[12px] text-danger">No se pudo cargar el informe. Puedes enviar el cierre y volver a intentarlo.</div>}
          {!loading && !error && data && (
            <div className="flex flex-col gap-2">
              <ReportBlock title="FACTURAS DE HOY" value={`${paid.length} · ${fmtRD(receivedTotal)}`}>
                {paid.length === 0 ? <EmptyReport>Sin facturas pagadas hoy.</EmptyReport> : <div className="flex flex-col gap-1">{paid.slice(0, 12).map((i) => <div key={i.number ?? `${i.patient}-${i.total}`} className="flex justify-between gap-3 text-[11.5px] text-muted"><span className="truncate">{i.patient ?? 'Cliente'}</span><b className="text-navy">{fmtRD(i.total)}</b></div>)}</div>}
              </ReportBlock>
              <ReportBlock title="CUENTAS POR COBRAR (A LA FECHA)" value={`${data.receivables.count} · ${fmtRD(data.receivables.total)}`}>
                {data.receivables.rows.length === 0 ? <EmptyReport>Sin cuentas por cobrar.</EmptyReport> : <div className="flex flex-col gap-1">{data.receivables.rows.slice(0, 12).map((r) => <div key={`${r.patientName}-${r.fecha}-${r.monto}`} className="flex justify-between gap-3 text-[11.5px] text-muted"><span className="truncate">{r.patientName}</span><b className="text-danger">{fmtRD(r.monto)}</b></div>)}</div>}
              </ReportBlock>
              <ReportBlock title={`FICHAS CLÍNICAS (${data.patients.length} PACIENTES)`}>
                <div className="flex flex-wrap gap-2 text-[11.5px]"><Badge label="Pendiente" value={ficha.pendiente} tone="warn" /><Badge label="En proceso" value={ficha.proceso} tone="navy" /><Badge label="Completa" value={ficha.completa} tone="ok" /></div>
              </ReportBlock>
              <ReportBlock title={`CITAS DE HOY (${appointments.length})`}>
                <div className="flex flex-wrap gap-2 text-[11.5px]"><Badge label="Confirmadas" value={cita.confirmadas} tone="ok" /><Badge label="Sin confirmar" value={cita.sinConfirmar} tone="warn" /><Badge label="Atendidas" value={cita.atendidas} tone="navy" /><Badge label="Canceladas" value={cita.canceladas} tone="danger" /><Badge label="Reagendadas" value={cita.reagendadas} tone="magenta" /></div>
              </ReportBlock>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ReportBlock({ title, value, children }: { title: string; value?: string; children: ReactNode }) {
  return <div className="rounded-[10px] border border-line-2 px-3 py-2.5"><div className="mb-1 flex justify-between gap-3 text-[11px] font-extrabold uppercase text-navy"><span>{title}</span>{value && <span className="text-muted">{value}</span>}</div>{children}</div>;
}
function EmptyReport({ children }: { children: ReactNode }) { return <div className="text-[11.5px] text-faint">{children}</div>; }
function Badge({ label, value, tone }: { label: string; value: number; tone: 'warn' | 'navy' | 'ok' | 'danger' | 'magenta' }) {
  const classes = { warn: 'bg-[var(--warn-soft)] text-[var(--warn)]', navy: 'bg-navy-soft text-navy', ok: 'bg-[var(--ok-soft)] text-ok', danger: 'bg-[var(--danger-soft)] text-danger', magenta: 'bg-magenta-soft text-magenta' };
  return <span className={`rounded-full px-2.5 py-1 font-bold ${classes[tone]}`}>{label}: {value}</span>;
}
