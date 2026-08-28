import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAutoRefresh } from '../../lib/useAutoRefresh';
import { Cargando, ErrorCarga } from '../../components/EstadoCarga';
import { fmtRD } from '../../lib/types';

interface Row {
  id: string; patientId: string; patientName: string; phone: string; branch: string;
  concept: string; tipo: string; monto: number; fecha: string; at: string; wa: string | null;
}
interface Data { rows: Row[]; total: number; count: number }

/**
 * Relación de CUENTAS POR COBRAR: todo lo pendiente de pago (saldos de planes + cargos
 * pendientes), con su monto y la fecha en que se generó. Para recepción/administración.
 */
export default function CuentasPorCobrarPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<Data | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const load = useCallback(() => {
    setCargando(true); setError(null);
    api.get<Data>('/invoices/receivables')
      .then((r) => { setData(r); setCargando(false); })
      .catch((e) => { setError(e instanceof Error ? e.message : 'Error'); setCargando(false); });
  }, []);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);

  if (cargando) return <Cargando texto="Cargando cuentas por cobrar…" />;
  if (error || !data) return <ErrorCarga mensaje={error ?? 'Error'} onRetry={load} />;

  const texto = q.trim().toLowerCase();
  const rows = data.rows.filter((r) => !texto || r.patientName.toLowerCase().includes(texto) || r.concept.toLowerCase().includes(texto));
  const totalMostrado = rows.reduce((s, r) => s + r.monto, 0);

  return (
    <div className="animate-fade flex flex-col gap-4">
      {/* Resumen */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-base border border-line bg-card p-4 shadow-card">
          <div className="text-[11.5px] font-semibold text-muted">Total por cobrar</div>
          <div className="mt-0.5 text-[22px] font-extrabold text-danger">{fmtRD(data.total)}</div>
        </div>
        <div className="rounded-base border border-line bg-card p-4 shadow-card">
          <div className="text-[11.5px] font-semibold text-muted">Cuentas pendientes</div>
          <div className="mt-0.5 text-[22px] font-extrabold">{data.count}</div>
        </div>
        <div className="rounded-base border border-line bg-card p-4 shadow-card">
          <div className="text-[11.5px] font-semibold text-muted">Filtradas</div>
          <div className="mt-0.5 text-[22px] font-extrabold text-magenta">{fmtRD(totalMostrado)}</div>
        </div>
      </div>

      <div className="flex items-center gap-2.5 rounded-[10px] border border-line bg-card px-3.5 py-2.5">
        <span className="text-faint">🔍</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por paciente o concepto…"
          className="w-full bg-transparent text-[13.5px] outline-none placeholder:text-faint" />
        <span className="flex-none text-[12px] font-bold text-muted">{rows.length}</span>
      </div>

      {/* Relación */}
      <div className="overflow-x-auto rounded-base border border-line bg-card shadow-card">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-[2fr_2.4fr_1.1fr_1fr_auto] gap-3 border-b border-line px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-muted">
            <div>Paciente</div><div>Concepto</div><div className="text-right">Monto</div><div>Fecha generada</div><div className="w-[150px]" />
          </div>
          {rows.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted">Sin cuentas por cobrar. 🎉</div>}
          {rows.map((r) => (
            <div key={r.id} className="grid grid-cols-[2fr_2.4fr_1.1fr_1fr_auto] items-center gap-3 border-b border-line-2 px-4 py-2.5 hover:bg-bg">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-bold">{r.patientName}</div>
                <div className="text-[11px] text-faint">{r.branch}</div>
              </div>
              <div className="min-w-0">
                <div className="truncate text-[12.5px]">{r.concept}</div>
                <div className="text-[10.5px] font-bold uppercase tracking-wide text-faint">{r.tipo}</div>
              </div>
              <div className="text-right text-[13px] font-extrabold text-danger">{fmtRD(r.monto)}</div>
              <div className="text-[12px] text-muted">{r.fecha}</div>
              <div className="flex w-[150px] justify-end gap-1.5">
                {r.wa && (
                  <a href={r.wa} target="_blank" rel="noreferrer" className="rounded-lg px-2.5 py-1.5 text-[11.5px] font-bold text-white no-underline" style={{ background: '#25D366' }}>💬</a>
                )}
                <button onClick={() => navigate('/app/facturacion')} className="rounded-lg bg-navy px-2.5 py-1.5 text-[11.5px] font-bold text-white">Cobrar</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[11.5px] text-faint">
        Reúne los <b>saldos de planes</b> (abonos sin terminar de pagar) y los <b>cargos pendientes</b> de facturar.
        El botón 💬 abre WhatsApp con el mensaje listo para invitar a saldar; <b>Cobrar</b> te lleva a Facturación.
      </p>
    </div>
  );
}
