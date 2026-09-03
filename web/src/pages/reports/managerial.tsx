import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { fmtRD } from '../../lib/types';

// Reportes gerenciales: Cartera, Pasivo de combos, Desempeño por esteticista y Descuentos.
// Se montan como pestañas dentro de Reportes. Componentes autocontenidos (con sus propios
// Stat/Card/Empty) para no acoplarse al resto de la página.

function Loading() { return <div className="py-10 text-center text-sm text-muted">Cargando…</div>; }
function Empty({ text = 'Sin datos en el período.' }: { text?: string }) {
  return <div className="py-6 text-center text-[12.5px] text-muted">{text}</div>;
}
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-[160px] flex-1 rounded-xl border border-line bg-card px-[18px] py-4 shadow-card">
      <div className="text-xs font-semibold text-muted">{label}</div>
      <div className="mt-0.5 text-[21px] font-extrabold">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-faint">{sub}</div>}
    </div>
  );
}
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-base border border-line bg-card p-5 shadow-card">
      <div className="mb-3 text-[14px] font-extrabold">{title}</div>
      {children}
    </div>
  );
}
const qp = (branchQ: string) => (branchQ ? `?${branchQ.slice(1)}` : '');

// ── Cartera (aging de saldos) ──
interface AgingRow { branch: string; cuentas: number; total: number; d0: number; d31: number; d61: number; d90: number }
interface AgingTop { paciente: string; phone: string; branch: string; plan: string; balance: number; dias: number }
export function Cartera({ branchQ }: { branchQ: string }) {
  const [d, setD] = useState<{ porSucursal: AgingRow[]; top: AgingTop[] } | null>(null);
  useEffect(() => { api.get<{ porSucursal: AgingRow[]; top: AgingTop[] }>(`/reports/aging${qp(branchQ)}`).then(setD).catch(() => setD(null)); }, [branchQ]);
  if (!d) return <Loading />;
  const total = d.porSucursal.reduce((s, r) => s + r.total, 0);
  const cuentas = d.porSucursal.reduce((s, r) => s + r.cuentas, 0);
  const v60 = d.porSucursal.reduce((s, r) => s + r.d61 + r.d90, 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3.5">
        <Stat label="Cartera total (saldos)" value={fmtRD(total)} sub={`${cuentas} cuentas por cobrar`} />
        <Stat label="Vencido +60 días" value={fmtRD(v60)} sub="prioridad de cobro" />
      </div>
      <Card title="Antigüedad por sucursal">
        <div className="overflow-x-auto"><div className="min-w-[520px]">
          <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr_1fr] gap-2 border-b border-line pb-1.5 text-[11px] font-bold uppercase text-muted"><span>Sucursal</span><span className="text-right">0–30</span><span className="text-right">31–60</span><span className="text-right">61–90</span><span className="text-right">+90</span><span className="text-right">Total</span></div>
          {d.porSucursal.length === 0 ? <Empty text="Sin saldos pendientes." /> : d.porSucursal.map((r) => (
            <div key={r.branch} className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr_1fr] gap-2 border-b border-line-2 py-1.5 text-[12.5px]"><span className="font-semibold">{r.branch}</span><span className="text-right">{fmtRD(r.d0)}</span><span className="text-right">{fmtRD(r.d31)}</span><span className="text-right" style={{ color: r.d61 > 0 ? '#C9880E' : undefined }}>{fmtRD(r.d61)}</span><span className="text-right font-bold" style={{ color: r.d90 > 0 ? 'var(--danger)' : undefined }}>{fmtRD(r.d90)}</span><span className="text-right font-extrabold">{fmtRD(r.total)}</span></div>
          ))}
        </div></div>
      </Card>
      <Card title="Mayores saldos por cobrar">
        <div className="overflow-x-auto"><div className="min-w-[560px]">
          <div className="grid grid-cols-[1.6fr_1.1fr_1fr_.8fr_.7fr] gap-2 border-b border-line pb-1.5 text-[11px] font-bold uppercase text-muted"><span>Paciente</span><span>Teléfono</span><span>Plan</span><span className="text-right">Saldo</span><span className="text-right">Días</span></div>
          {d.top.length === 0 ? <Empty text="Sin cuentas por cobrar." /> : d.top.map((r, i) => (
            <div key={i} className="grid grid-cols-[1.6fr_1.1fr_1fr_.8fr_.7fr] items-center gap-2 border-b border-line-2 py-1.5 text-[12.5px]"><span className="font-semibold">{r.paciente} <span className="font-normal text-faint">· {r.branch}</span></span><span>{r.phone}</span><span className="truncate text-muted" title={r.plan}>{r.plan}</span><span className="text-right font-bold text-danger">{fmtRD(r.balance)}</span><span className="text-right font-bold" style={{ color: r.dias > 60 ? 'var(--danger)' : r.dias > 30 ? '#C9880E' : 'var(--muted)' }}>{r.dias}</span></div>
          ))}
        </div></div>
      </Card>
    </div>
  );
}

// ── Pasivo de combos ──
interface ComboRow { branch: string; planes: number; sesionesPend: number; valorEstimado: number }
interface ComboVencer { paciente: string; branch: string; plan: string; pend: number; vence: string; dias: number }
export function ComboPasivo({ branchQ }: { branchQ: string }) {
  const [d, setD] = useState<{ porSucursal: ComboRow[]; porVencer: ComboVencer[] } | null>(null);
  useEffect(() => { api.get<{ porSucursal: ComboRow[]; porVencer: ComboVencer[] }>(`/reports/combo-liability${qp(branchQ)}`).then(setD).catch(() => setD(null)); }, [branchQ]);
  if (!d) return <Loading />;
  const sesiones = d.porSucursal.reduce((s, r) => s + r.sesionesPend, 0);
  const valor = d.porSucursal.reduce((s, r) => s + r.valorEstimado, 0);
  const planes = d.porSucursal.reduce((s, r) => s + r.planes, 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3.5">
        <Stat label="Sesiones prepagadas pendientes" value={String(sesiones)} sub={`en ${planes} planes activos`} />
        <Stat label="Valor de servicio por entregar" value={fmtRD(valor)} sub="estimado (precio ÷ sesiones)" />
      </div>
      <Card title="Pasivo por sucursal">
        <div className="grid grid-cols-[1.6fr_1fr_1fr] gap-2 border-b border-line pb-1.5 text-[11px] font-bold uppercase text-muted"><span>Sucursal</span><span className="text-right">Sesiones pend.</span><span className="text-right">Valor estimado</span></div>
        {d.porSucursal.length === 0 ? <Empty text="Sin combos con sesiones pendientes." /> : d.porSucursal.map((r) => (
          <div key={r.branch} className="grid grid-cols-[1.6fr_1fr_1fr] gap-2 border-b border-line-2 py-1.5 text-[12.5px]"><span className="font-semibold">{r.branch} <span className="font-normal text-faint">· {r.planes} planes</span></span><span className="text-right font-bold">{r.sesionesPend}</span><span className="text-right font-extrabold text-magenta">{fmtRD(r.valorEstimado)}</span></div>
        ))}
      </Card>
      <Card title="Combos por vencer (próximos 30 días)">
        {d.porVencer.length === 0 ? <Empty text="Ningún combo por vencer en 30 días." /> : (
          <div className="overflow-x-auto"><div className="min-w-[520px]">
            <div className="grid grid-cols-[1.6fr_1.4fr_.7fr_.9fr] gap-2 border-b border-line pb-1.5 text-[11px] font-bold uppercase text-muted"><span>Paciente</span><span>Combo</span><span className="text-right">Pend.</span><span className="text-right">Vence</span></div>
            {d.porVencer.map((r, i) => (
              <div key={i} className="grid grid-cols-[1.6fr_1.4fr_.7fr_.9fr] items-center gap-2 border-b border-line-2 py-1.5 text-[12.5px]"><span className="font-semibold">{r.paciente} <span className="font-normal text-faint">· {r.branch}</span></span><span className="truncate text-muted" title={r.plan}>{r.plan}</span><span className="text-right font-bold">{r.pend}</span><span className="text-right font-bold" style={{ color: r.dias <= 7 ? 'var(--danger)' : '#C9880E' }}>{r.vence}</span></div>
            ))}
          </div></div>
        )}
      </Card>
    </div>
  );
}

// ── Desempeño por esteticista ──
interface StaffRow { therapist: string; branch: string; ventas: number; recibos: number; atendidas: number; rating: number | null; avgMin: number | null }
export function Esteticistas({ from, to, branchQ }: { from: string; to: string; branchQ: string }) {
  const [d, setD] = useState<{ rows: StaffRow[] } | null>(null);
  useEffect(() => { api.get<{ rows: StaffRow[] }>(`/reports/staff-performance?from=${from}&to=${to}${branchQ}`).then(setD).catch(() => setD(null)); }, [from, to, branchQ]);
  if (!d) return <Loading />;
  return (
    <Card title="Desempeño por esteticista (en el período)">
      <div className="overflow-x-auto"><div className="min-w-[620px]">
        <div className="grid grid-cols-[1.6fr_1fr_.9fr_.9fr_.8fr_.9fr] gap-2 border-b border-line pb-1.5 text-[11px] font-bold uppercase text-muted"><span>Esteticista</span><span className="text-right">Ventas</span><span className="text-right">Recibos</span><span className="text-right">Atendidas</span><span className="text-right">Calif.</span><span className="text-right">Tiempo prom.</span></div>
        {d.rows.length === 0 ? <Empty /> : d.rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1.6fr_1fr_.9fr_.9fr_.8fr_.9fr] items-center gap-2 border-b border-line-2 py-1.5 text-[12.5px]"><span className="font-semibold">{r.therapist} <span className="font-normal text-faint">· {r.branch}</span></span><span className="text-right font-extrabold text-magenta">{fmtRD(r.ventas)}</span><span className="text-right">{r.recibos}</span><span className="text-right font-bold">{r.atendidas}</span><span className="text-right">{r.rating != null ? `${r.rating}★` : '—'}</span><span className="text-right text-muted">{r.avgMin != null ? `${r.avgMin} min` : '—'}</span></div>
        ))}
      </div></div>
    </Card>
  );
}

// ── Descuentos ──
interface DiscRow { cajero: string; branch: string; totalDesc: number; facturas: number }
interface DiscItem { number: string; fecha: string; branch: string; cajero: string; paciente: string; descuento: number; motivo: string | null; total: number }
export function Descuentos({ from, to, branchQ }: { from: string; to: string; branchQ: string }) {
  const [d, setD] = useState<{ resumen: { totalDesc: number; facturasConDesc: number; ventas: number }; porCajero: DiscRow[]; lista: DiscItem[] } | null>(null);
  useEffect(() => { api.get<{ resumen: { totalDesc: number; facturasConDesc: number; ventas: number }; porCajero: DiscRow[]; lista: DiscItem[] }>(`/reports/discounts?from=${from}&to=${to}${branchQ}`).then(setD).catch(() => setD(null)); }, [from, to, branchQ]);
  if (!d) return <Loading />;
  const pctSobreVentas = d.resumen.ventas ? Math.round((d.resumen.totalDesc / d.resumen.ventas) * 1000) / 10 : 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3.5">
        <Stat label="Total descontado" value={fmtRD(d.resumen.totalDesc)} sub={`${d.resumen.facturasConDesc} facturas`} />
        <Stat label="% sobre ventas" value={`${pctSobreVentas}%`} sub={`ventas ${fmtRD(d.resumen.ventas)}`} />
      </div>
      <Card title="Descuentos por recepcionista / cajero">
        <div className="grid grid-cols-[1.8fr_1fr_.8fr] gap-2 border-b border-line pb-1.5 text-[11px] font-bold uppercase text-muted"><span>Cajero</span><span className="text-right">Descontado</span><span className="text-right">Facturas</span></div>
        {d.porCajero.length === 0 ? <Empty text="Sin descuentos en el período." /> : d.porCajero.map((r, i) => (
          <div key={i} className="grid grid-cols-[1.8fr_1fr_.8fr] gap-2 border-b border-line-2 py-1.5 text-[12.5px]"><span className="font-semibold">{r.cajero} <span className="font-normal text-faint">· {r.branch}</span></span><span className="text-right font-extrabold text-danger">{fmtRD(r.totalDesc)}</span><span className="text-right">{r.facturas}</span></div>
        ))}
      </Card>
      <Card title={`Facturas con descuento (${d.lista.length})`}>
        <div className="overflow-x-auto"><div className="min-w-[620px]">
          <div className="grid grid-cols-[.8fr_.9fr_1.4fr_1fr_.9fr_1.2fr] gap-2 border-b border-line pb-1.5 text-[11px] font-bold uppercase text-muted"><span>Recibo</span><span>Fecha</span><span>Paciente</span><span className="text-right">Descuento</span><span className="text-right">Total</span><span>Motivo</span></div>
          {d.lista.length === 0 ? <Empty text="Sin descuentos en el período." /> : d.lista.map((r, i) => (
            <div key={i} className="grid grid-cols-[.8fr_.9fr_1.4fr_1fr_.9fr_1.2fr] items-center gap-2 border-b border-line-2 py-1.5 text-[12px]"><span className="font-bold text-magenta">{r.number}</span><span className="text-faint">{r.fecha}</span><span className="truncate font-semibold">{r.paciente} <span className="font-normal text-faint">· {r.branch}</span></span><span className="text-right font-bold text-danger">−{fmtRD(r.descuento)}</span><span className="text-right">{fmtRD(r.total)}</span><span className="truncate text-muted" title={r.motivo ?? ''}>{r.motivo || '—'}</span></div>
          ))}
        </div></div>
      </Card>
    </div>
  );
}
