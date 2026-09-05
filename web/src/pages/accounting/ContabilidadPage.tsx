import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useBranch } from '../../layout/BranchContext';
import { useToast } from '../../components/Toast';
import { Overlay, stop } from '../../components/Modal';
import { fmtRD } from '../../lib/types';

// ─────────────────────────────────────────────────────────────
// Tipos del API de contabilidad
// ─────────────────────────────────────────────────────────────
interface Branch { id: string; name: string }
interface Category { id: string; kind: string; name: string; code: string | null; active: boolean; sortOrder: number }
interface Entry {
  id: string; date: string; dateISO: string; type: string; typeLabel: string;
  category: string; amount: number; method: string; branchId: string; branch: string;
  concept: string; ncf: string | null; supplierRnc: string | null; notes: string | null;
}
interface LedgerRow { date: string; source: string; type: string; concept: string; category: string; method: string; branch: string; amount: number; sign: 1 | -1; ref: string | null }
interface Ledger { branches: Branch[]; totals: { ingresos: number; egresos: number; neto: number; count: number }; rows: LedgerRow[] }
interface Line { label: string; amount: number }
interface Pnl {
  period: { from: string; to: string }; ingresos: Line[]; egresos: Line[];
  totalIngresos: number; totalEgresos: number; utilidad: number; margen: number;
  memo: { retiros: number; aportes: number; traslados: number; itbisCobrado: number; ventasBruto: number; recibos: number; descuentos: number };
}
interface CashFlow { entradas: Line[]; salidas: Line[]; totalEntradas: number; totalSalidas: number; neto: number }
interface Itbis { debito: number; credito: number; aPagar: number; saldoFavor: number; ventas: { base: number; itbis: number; recibos: number }; compras: { base: number; itbis: number; facturas: number } }
interface DgiiRow607 { rnc: string; tipoId: string; cliente: string; ncf: string; fecha: string; montoBase: number; itbis: number; total: number; numero: string }
interface Dgii607 { rows: DgiiRow607[]; count: number; sinNcf: number; totales: { base: number; itbis: number; total: number } }
interface DgiiRow606 { rnc: string; tipoId: string; proveedor: string; ncf: string; fecha: string; montoBase: number; itbis: number; total: number; concepto: string }
interface Dgii606 { rows: DgiiRow606[]; count: number; sinNcf: number; sinRnc: number; totales: { base: number; itbis: number; total: number } }
interface Period { id: string; period: string; branch: string; branchId: string | null; status: string; totalIngresos: number; totalEgresos: number; utilidad: number; closedAt: string; note: string | null }

type Tab = 'diario' | 'resultados' | 'flujo' | 'itbis' | 'dgii' | 'movimientos' | 'cierres' | 'cuentas';
const TABS: { key: Tab; label: string }[] = [
  { key: 'resultados', label: 'Estado de resultados' },
  { key: 'diario', label: 'Libro diario' },
  { key: 'movimientos', label: 'Movimientos' },
  { key: 'flujo', label: 'Flujo de caja' },
  { key: 'itbis', label: 'ITBIS' },
  { key: 'dgii', label: 'DGII 606/607' },
  { key: 'cierres', label: 'Cierres' },
  { key: 'cuentas', label: 'Plan de cuentas' },
];

const TYPE_LABEL: Record<string, string> = { INGRESO: 'Ingreso', EGRESO: 'Egreso / Gasto', RETIRO: 'Retiro de socia', APORTE: 'Aporte de socia', TRASLADO: 'Traslado / Depósito' };
const METHODS = [{ v: 'EFECTIVO', l: 'Efectivo' }, { v: 'TRANSFERENCIA', l: 'Transferencia' }, { v: 'TARJETA', l: 'Tarjeta' }, { v: 'OTRO', l: 'Otro' }];

const firstOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); };
const todayISO = () => new Date().toISOString().slice(0, 10);

/** Descarga un CSV en el navegador (BOM para que Excel respete los acentos). */
function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function ContabilidadPage() {
  const { activeBranch } = useBranch();
  const [tab, setTab] = useState<Tab>('resultados');
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(todayISO());
  const branchQ = activeBranch !== 'all' ? `&branch=${activeBranch}` : '';
  const q = `from=${from}&to=${to}${branchQ}`;

  return (
    <div className="animate-fade">
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-bold text-muted">Del</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-[12.5px] font-semibold" />
        <span className="text-[12px] font-bold text-muted">al</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-[12.5px] font-semibold" />
        <span className="ml-1 text-[11.5px] text-faint">Sucursal: usa el selector de arriba (Todas / E1 / E2 / E3)</span>
      </div>

      <div className="mb-4 flex flex-wrap gap-1 rounded-[10px] border border-line bg-bg p-1">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className="rounded-[7px] px-3.5 py-1.5 text-[12.5px] font-bold transition"
            style={{ background: tab === t.key ? 'var(--magenta)' : 'transparent', color: tab === t.key ? '#fff' : 'var(--muted)' }}>{t.label}</button>
        ))}
      </div>

      {tab === 'resultados' && <Resultados q={q} />}
      {tab === 'diario' && <Diario q={q} />}
      {tab === 'movimientos' && <Movimientos q={q} activeBranch={activeBranch} />}
      {tab === 'flujo' && <Flujo q={q} />}
      {tab === 'itbis' && <ItbisPanel q={q} />}
      {tab === 'dgii' && <Dgii q={q} from={from} to={to} />}
      {tab === 'cierres' && <Cierres activeBranch={activeBranch} />}
      {tab === 'cuentas' && <Cuentas />}
    </div>
  );
}

// ── UI compartida ──
function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'ok' | 'bad' }) {
  return (
    <div className="min-w-[150px] flex-1 rounded-xl border border-line bg-card px-[18px] py-4 shadow-card">
      <div className="text-xs font-semibold text-muted">{label}</div>
      <div className="mt-0.5 text-[21px] font-extrabold" style={{ color: tone === 'ok' ? 'var(--ok, #1F9D6B)' : tone === 'bad' ? 'var(--danger)' : undefined }}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-faint">{sub}</div>}
    </div>
  );
}
function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-base border border-line bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2"><div className="text-[14px] font-extrabold">{title}</div>{right}</div>
      {children}
    </div>
  );
}
function Bar({ label, value, max, right, color }: { label: string; value: number; max: number; right: string; color?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="mb-2">
      <div className="mb-1 flex justify-between text-[12.5px]"><span className="font-semibold">{label}</span><span className="font-bold">{right}</span></div>
      <div className="h-2.5 overflow-hidden rounded-md" style={{ background: 'var(--navy-soft)' }}><div className="h-full rounded-md" style={{ width: `${pct}%`, background: color ?? 'linear-gradient(90deg,#B31C86,#D4419E)' }} /></div>
    </div>
  );
}
function Empty({ text = 'Sin datos en el período.' }: { text?: string }) { return <div className="py-6 text-center text-[12.5px] text-muted">{text}</div>; }
function Loading() { return <div className="py-10 text-center text-sm text-muted">Cargando…</div>; }

// ── Estado de resultados (P&L) ──
function Resultados({ q }: { q: string }) {
  const [d, setD] = useState<Pnl | null>(null);
  useEffect(() => { setD(null); api.get<Pnl>(`/accounting/pnl?${q}`).then(setD).catch(() => setD(null)); }, [q]);
  if (!d) return <Loading />;
  const maxIn = Math.max(1, ...d.ingresos.map((l) => l.amount));
  const maxEg = Math.max(1, ...d.egresos.map((l) => l.amount));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3.5">
        <Stat label="Ingresos operativos" value={fmtRD(d.totalIngresos)} sub={`${d.memo.recibos} recibos`} />
        <Stat label="Egresos operativos" value={fmtRD(d.totalEgresos)} />
        <Stat label="Utilidad del período" value={fmtRD(d.utilidad)} sub={`Margen ${d.margen}%`} tone={d.utilidad >= 0 ? 'ok' : 'bad'} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Ingresos por cuenta">
          {d.ingresos.length === 0 ? <Empty /> : d.ingresos.map((l) => <Bar key={l.label} label={l.label} value={l.amount} max={maxIn} right={fmtRD(l.amount)} color="linear-gradient(90deg,#1F9D6B,#37C08A)" />)}
        </Card>
        <Card title="Egresos por cuenta">
          {d.egresos.length === 0 ? <Empty /> : d.egresos.map((l) => <Bar key={l.label} label={l.label} value={l.amount} max={maxEg} right={fmtRD(l.amount)} color="linear-gradient(90deg,#C0392B,#E05747)" />)}
        </Card>
      </div>
      <Card title="Memorandos (no afectan la utilidad)">
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-3">
          <Memo label="ITBIS cobrado (ventas)" value={fmtRD(d.memo.itbisCobrado)} />
          <Memo label="Ventas brutas (con ITBIS)" value={fmtRD(d.memo.ventasBruto)} />
          <Memo label="Descuentos otorgados" value={fmtRD(d.memo.descuentos)} />
          <Memo label="Retiros de socia" value={fmtRD(d.memo.retiros)} />
          <Memo label="Aportes de socia" value={fmtRD(d.memo.aportes)} />
          <Memo label="Depósitos / traslados" value={fmtRD(d.memo.traslados)} />
        </div>
      </Card>
    </div>
  );
}
function Memo({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between border-b border-line-2 py-1"><span className="text-muted">{label}</span><span className="font-bold">{value}</span></div>;
}

// ── Libro diario ──
function Diario({ q }: { q: string }) {
  const [d, setD] = useState<Ledger | null>(null);
  const [type, setType] = useState('');
  const [source, setSource] = useState('');
  const qq = `${q}${type ? `&type=${type}` : ''}${source ? `&source=${source}` : ''}`;
  useEffect(() => { setD(null); api.get<Ledger>(`/accounting/ledger?${qq}`).then(setD).catch(() => setD(null)); }, [qq]);
  const sel = 'rounded-lg border border-line bg-card px-2.5 py-1.5 text-[12.5px] font-semibold';
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={source} onChange={(e) => setSource(e.target.value)} className={sel}>
          <option value="">Todo origen</option><option value="venta">Ventas</option><option value="compra">Compras</option><option value="manual">Movimientos</option>
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className={sel}>
          <option value="">Todo tipo</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {!d ? <Loading /> : (
        <>
          <div className="flex flex-wrap gap-3.5">
            <Stat label="Ingresos" value={fmtRD(d.totals.ingresos)} tone="ok" />
            <Stat label="Egresos" value={fmtRD(d.totals.egresos)} tone="bad" />
            <Stat label="Neto de caja" value={fmtRD(d.totals.neto)} sub={`${d.totals.count} movimientos`} tone={d.totals.neto >= 0 ? 'ok' : 'bad'} />
          </div>
          <div className="overflow-x-auto rounded-base border border-line bg-card shadow-card">
            <div className="min-w-[860px]">
              <div className="grid grid-cols-[90px_1fr_1.1fr_1fr_0.9fr_1fr] gap-3 border-b border-line px-5 py-3 text-[11.5px] font-bold uppercase tracking-wide text-muted">
                <div>Fecha</div><div>Concepto</div><div>Cuenta</div><div>Método</div><div>Origen</div><div className="text-right">Monto</div>
              </div>
              {d.rows.length === 0 && <Empty />}
              {d.rows.map((r, i) => (
                <div key={i} className="grid grid-cols-[90px_1fr_1.1fr_1fr_0.9fr_1fr] items-center gap-3 border-b border-line-2 px-5 py-2.5 text-[12.5px]">
                  <div className="text-muted">{r.date}</div>
                  <div className="truncate font-semibold" title={r.concept}>{r.concept}{r.ref && <span className="ml-1 text-[11px] text-faint">· {r.ref}</span>}</div>
                  <div className="text-muted">{r.category}</div>
                  <div className="text-muted">{r.method}</div>
                  <div><SourceTag s={r.source} /></div>
                  <div className="text-right font-extrabold" style={{ color: r.sign > 0 ? 'var(--ok,#1F9D6B)' : 'var(--danger)' }}>{r.sign > 0 ? '+' : '−'}{fmtRD(r.amount)}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
function SourceTag({ s }: { s: string }) {
  const map: Record<string, { l: string; bg: string; c: string }> = {
    venta: { l: 'Venta', bg: '#E7F6EF', c: '#1F9D6B' },
    compra: { l: 'Compra', bg: '#FDECEA', c: '#C0392B' },
    manual: { l: 'Manual', bg: '#EEF0F7', c: '#4A5170' },
  };
  const m = map[s] ?? map.manual;
  return <span className="rounded-full px-2 py-0.5 text-[10.5px] font-bold" style={{ background: m.bg, color: m.c }}>{m.l}</span>;
}

// ── Flujo de caja ──
function Flujo({ q }: { q: string }) {
  const [d, setD] = useState<CashFlow | null>(null);
  useEffect(() => { setD(null); api.get<CashFlow>(`/accounting/cashflow?${q}`).then(setD).catch(() => setD(null)); }, [q]);
  if (!d) return <Loading />;
  const maxIn = Math.max(1, ...d.entradas.map((l) => l.amount));
  const maxOut = Math.max(1, ...d.salidas.map((l) => l.amount));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3.5">
        <Stat label="Entradas de caja" value={fmtRD(d.totalEntradas)} tone="ok" />
        <Stat label="Salidas de caja" value={fmtRD(d.totalSalidas)} tone="bad" />
        <Stat label="Flujo neto" value={fmtRD(d.neto)} tone={d.neto >= 0 ? 'ok' : 'bad'} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Entradas por método de pago">
          {d.entradas.length === 0 ? <Empty /> : d.entradas.map((l) => <Bar key={l.label} label={l.label} value={l.amount} max={maxIn} right={fmtRD(l.amount)} color="linear-gradient(90deg,#1F9D6B,#37C08A)" />)}
        </Card>
        <Card title="Salidas por concepto">
          {d.salidas.length === 0 ? <Empty /> : d.salidas.map((l) => <Bar key={l.label} label={l.label} value={l.amount} max={maxOut} right={fmtRD(l.amount)} color="linear-gradient(90deg,#C0392B,#E05747)" />)}
        </Card>
      </div>
    </div>
  );
}

// ── ITBIS ──
function ItbisPanel({ q }: { q: string }) {
  const [d, setD] = useState<Itbis | null>(null);
  useEffect(() => { setD(null); api.get<Itbis>(`/accounting/itbis?${q}`).then(setD).catch(() => setD(null)); }, [q]);
  if (!d) return <Loading />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3.5">
        <Stat label="ITBIS débito (ventas)" value={fmtRD(d.debito)} sub={`${d.ventas.recibos} recibos`} />
        <Stat label="ITBIS crédito (compras)" value={fmtRD(d.credito)} sub={`${d.compras.facturas} facturas`} />
        {d.aPagar > 0
          ? <Stat label="ITBIS a pagar (DGII)" value={fmtRD(d.aPagar)} tone="bad" />
          : <Stat label="Saldo a favor" value={fmtRD(d.saldoFavor)} tone="ok" />}
      </div>
      <Card title="Detalle">
        <div className="grid gap-2 text-[13px]">
          <div className="flex justify-between border-b border-line-2 py-1.5"><span>Base gravada de ventas</span><span className="font-bold">{fmtRD(d.ventas.base)}</span></div>
          <div className="flex justify-between border-b border-line-2 py-1.5"><span>ITBIS cobrado (18%)</span><span className="font-bold">{fmtRD(d.ventas.itbis)}</span></div>
          <div className="flex justify-between border-b border-line-2 py-1.5"><span>Base de compras con ITBIS</span><span className="font-bold">{fmtRD(d.compras.base)}</span></div>
          <div className="flex justify-between border-b border-line-2 py-1.5"><span>ITBIS pagado en compras</span><span className="font-bold">{fmtRD(d.compras.itbis)}</span></div>
          <div className="mt-1 flex justify-between py-1.5 text-[14px] font-extrabold"><span>{d.aPagar > 0 ? 'ITBIS a pagar' : 'Saldo a favor'}</span><span>{fmtRD(d.aPagar > 0 ? d.aPagar : d.saldoFavor)}</span></div>
        </div>
        <p className="mt-3 text-[11.5px] text-faint">El ITBIS crédito de compras se calcula con el campo “ITBIS de la factura” que se captura al registrar cada compra. Los servicios sin ITBIS no suman al débito.</p>
      </Card>
    </div>
  );
}

// ── DGII 606/607 ──
function Dgii({ q, from, to }: { q: string; from: string; to: string }) {
  const [sub, setSub] = useState<'607' | '606'>('607');
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 rounded-[10px] border border-line bg-bg p-1" style={{ width: 'fit-content' }}>
        {(['607', '606'] as const).map((s) => (
          <button key={s} onClick={() => setSub(s)} className="rounded-[7px] px-4 py-1.5 text-[12.5px] font-bold transition"
            style={{ background: sub === s ? 'var(--navy)' : 'transparent', color: sub === s ? '#fff' : 'var(--muted)' }}>
            {s === '607' ? '607 · Ventas' : '606 · Compras'}
          </button>
        ))}
      </div>
      {sub === '607' ? <Dgii607View q={q} from={from} to={to} /> : <Dgii606View q={q} from={from} to={to} />}
    </div>
  );
}
function Dgii607View({ q, from, to }: { q: string; from: string; to: string }) {
  const [d, setD] = useState<Dgii607 | null>(null);
  useEffect(() => { setD(null); api.get<Dgii607>(`/accounting/dgii/607?${q}`).then(setD).catch(() => setD(null)); }, [q]);
  if (!d) return <Loading />;
  const exportar = () => downloadCSV(`607_${from}_${to}.csv`,
    ['RNC/Cédula', 'Tipo Id', 'NCF', 'Fecha', 'Monto facturado', 'ITBIS facturado', 'Total'],
    d.rows.map((r) => [r.rnc, r.tipoId, r.ncf, r.fecha, r.montoBase, r.itbis, r.total]));
  return (
    <>
      <div className="flex flex-wrap gap-3.5">
        <Stat label="Comprobantes" value={String(d.count)} sub={d.sinNcf ? `${d.sinNcf} ventas sin NCF (excluidas)` : undefined} />
        <Stat label="Monto facturado" value={fmtRD(d.totales.base)} />
        <Stat label="ITBIS" value={fmtRD(d.totales.itbis)} />
      </div>
      <Card title="Formato 607 · Ventas" right={<button onClick={exportar} disabled={!d.count} className="rounded-lg bg-navy px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">Exportar CSV</button>}>
        <div className="overflow-x-auto"><div className="min-w-[760px]">
          <div className="grid grid-cols-[1.3fr_.6fr_1.4fr_.9fr_1fr_.9fr_1fr] gap-2 border-b border-line pb-1.5 text-[11px] font-bold uppercase text-muted"><span>RNC/Cédula</span><span>Tipo</span><span>NCF</span><span>Fecha</span><span className="text-right">Monto</span><span className="text-right">ITBIS</span><span className="text-right">Total</span></div>
          {d.rows.length === 0 && <Empty />}
          {d.rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1.3fr_.6fr_1.4fr_.9fr_1fr_.9fr_1fr] items-center gap-2 border-b border-line-2 py-1.5 text-[12px]">
              <span className="font-semibold">{r.rnc || '—'}</span><span>{r.tipoId || '—'}</span><span>{r.ncf}</span><span className="text-muted">{r.fecha}</span>
              <span className="text-right">{fmtRD(r.montoBase)}</span><span className="text-right">{fmtRD(r.itbis)}</span><span className="text-right font-bold">{fmtRD(r.total)}</span>
            </div>
          ))}
        </div></div>
      </Card>
    </>
  );
}
function Dgii606View({ q, from, to }: { q: string; from: string; to: string }) {
  const [d, setD] = useState<Dgii606 | null>(null);
  useEffect(() => { setD(null); api.get<Dgii606>(`/accounting/dgii/606?${q}`).then(setD).catch(() => setD(null)); }, [q]);
  if (!d) return <Loading />;
  const exportar = () => downloadCSV(`606_${from}_${to}.csv`,
    ['RNC/Cédula', 'Tipo Id', 'NCF', 'Fecha', 'Monto facturado', 'ITBIS facturado', 'Total'],
    d.rows.map((r) => [r.rnc, r.tipoId, r.ncf, r.fecha, r.montoBase, r.itbis, r.total]));
  return (
    <>
      <div className="flex flex-wrap gap-3.5">
        <Stat label="Comprobantes" value={String(d.count)} sub={d.sinNcf ? `${d.sinNcf} compras sin NCF (excluidas)` : undefined} />
        <Stat label="Monto facturado" value={fmtRD(d.totales.base)} />
        <Stat label="ITBIS" value={fmtRD(d.totales.itbis)} />
      </div>
      {d.sinRnc > 0 && <div className="rounded-lg border border-[#F0C36D] bg-[#FCF3E0] px-4 py-2 text-[12px] font-semibold text-[#8A6D3B]">⚠ {d.sinRnc} comprobante(s) sin RNC del proveedor. Complétalo en la compra para que el 606 quede válido.</div>}
      <Card title="Formato 606 · Compras y gastos" right={<button onClick={exportar} disabled={!d.count} className="rounded-lg bg-navy px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">Exportar CSV</button>}>
        <div className="overflow-x-auto"><div className="min-w-[760px]">
          <div className="grid grid-cols-[1.3fr_.6fr_1.4fr_.9fr_1fr_.9fr_1fr] gap-2 border-b border-line pb-1.5 text-[11px] font-bold uppercase text-muted"><span>RNC/Cédula</span><span>Tipo</span><span>NCF</span><span>Fecha</span><span className="text-right">Monto</span><span className="text-right">ITBIS</span><span className="text-right">Total</span></div>
          {d.rows.length === 0 && <Empty />}
          {d.rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1.3fr_.6fr_1.4fr_.9fr_1fr_.9fr_1fr] items-center gap-2 border-b border-line-2 py-1.5 text-[12px]">
              <span className="font-semibold">{r.rnc || '—'}</span><span>{r.tipoId || '—'}</span><span>{r.ncf}</span><span className="text-muted">{r.fecha}</span>
              <span className="text-right">{fmtRD(r.montoBase)}</span><span className="text-right">{fmtRD(r.itbis)}</span><span className="text-right font-bold">{fmtRD(r.total)}</span>
            </div>
          ))}
        </div></div>
      </Card>
    </>
  );
}

// ── Movimientos manuales ──
function Movimientos({ q, activeBranch }: { q: string; activeBranch: string }) {
  const toast = useToast();
  const [d, setD] = useState<{ branches: Branch[]; categories: Category[]; entries: Entry[] } | null>(null);
  const [modal, setModal] = useState<Entry | 'new' | null>(null);
  const load = useCallback(() => { api.get<typeof d>(`/accounting/entries?${q}`).then(setD).catch(() => setD(null)); }, [q]);
  useEffect(() => { setD(null); load(); }, [load]);

  async function eliminar(e: Entry) {
    if (!window.confirm(`¿Eliminar ${e.typeLabel} · ${e.category} (${fmtRD(e.amount)})?`)) return;
    try { const r = await api.del<{ message: string }>(`/accounting/entries/${e.id}`); toast(r.message); load(); }
    catch (err) { toast(err instanceof Error ? err.message : 'Error'); }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="text-[13px] text-muted">Nómina, alquiler, servicios, retiros/aportes, depósitos y ajustes.</div>
        <button onClick={() => setModal('new')} className="flex items-center gap-1.5 rounded-[10px] bg-magenta px-[18px] py-2.5 text-[13.5px] font-bold text-white"><span className="text-base">+</span> Registrar movimiento</button>
      </div>
      {!d ? <Loading /> : (
        <div className="overflow-x-auto rounded-base border border-line bg-card shadow-card">
          <div className="min-w-[820px]">
            <div className="grid grid-cols-[90px_1fr_1.2fr_1fr_1fr_90px] gap-3 border-b border-line px-5 py-3 text-[11.5px] font-bold uppercase tracking-wide text-muted">
              <div>Fecha</div><div>Concepto</div><div>Cuenta</div><div>Método</div><div className="text-right">Monto</div><div></div>
            </div>
            {d.entries.length === 0 && <Empty text="Sin movimientos manuales en el período." />}
            {d.entries.map((e) => (
              <div key={e.id} className="grid grid-cols-[90px_1fr_1.2fr_1fr_1fr_90px] items-center gap-3 border-b border-line-2 px-5 py-2.5 text-[12.5px]">
                <div className="text-muted">{e.date}</div>
                <div className="truncate font-semibold" title={e.concept}>{e.concept || e.typeLabel}<div className="text-[10.5px] text-faint">{e.branch}{e.ncf ? ` · NCF ${e.ncf}` : ''}</div></div>
                <div className="text-muted">{e.category}</div>
                <div className="text-muted">{e.method}</div>
                <div className="text-right font-extrabold" style={{ color: e.type === 'INGRESO' || e.type === 'APORTE' ? 'var(--ok,#1F9D6B)' : 'var(--danger)' }}>{fmtRD(e.amount)}</div>
                <div className="flex justify-end gap-1">
                  <button onClick={() => setModal(e)} className="rounded-md px-2 py-1 text-[12px] font-bold text-magenta hover:underline">Editar</button>
                  <button onClick={() => eliminar(e)} className="rounded-md px-2 py-1 text-[12px] font-bold text-muted hover:text-danger">×</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {modal && d && (
        <MovimientoModal entry={modal === 'new' ? null : modal} branches={d.branches} categories={d.categories}
          defaultBranch={activeBranch !== 'all' ? activeBranch : d.branches[0]?.id ?? ''}
          onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />
      )}
    </div>
  );
}

function MovimientoModal({ entry, branches, categories, defaultBranch, onClose, onSaved }: {
  entry: Entry | null; branches: Branch[]; categories: Category[]; defaultBranch: string;
  onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [date, setDate] = useState(entry?.dateISO ?? todayISO());
  const [type, setType] = useState(entry?.type ?? 'EGRESO');
  const [amount, setAmount] = useState(entry ? String(entry.amount) : '');
  const [method, setMethod] = useState('EFECTIVO');
  const [branchId, setBranchId] = useState(entry?.branchId ?? defaultBranch);
  const [concept, setConcept] = useState(entry?.concept ?? '');
  const [ncf, setNcf] = useState(entry?.ncf ?? '');
  const [supplierRnc, setSupplierRnc] = useState(entry?.supplierRnc ?? '');
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const cats = useMemo(() => categories.filter((c) => c.kind === type), [categories, type]);
  const [categoryId, setCategoryId] = useState('');
  useEffect(() => { setCategoryId((prev) => (cats.some((c) => c.id === prev) ? prev : cats[0]?.id ?? '')); }, [cats]);
  const [busy, setBusy] = useState(false);

  async function guardar() {
    const monto = Math.round(Number(amount));
    if (!monto || monto <= 0) { toast('Escribe un monto válido'); return; }
    if (!branchId) { toast('Selecciona la sucursal'); return; }
    setBusy(true);
    const body = {
      date, type, amount: monto, method, branchId,
      categoryId: categoryId || undefined, concept: concept.trim() || undefined,
      ncf: ncf.trim() || undefined, supplierRnc: supplierRnc.trim() || undefined, notes: notes.trim() || undefined,
    };
    try {
      if (entry) await api.patch(`/accounting/entries/${entry.id}`, body);
      else await api.post('/accounting/entries', body);
      toast(entry ? 'Movimiento actualizado' : 'Movimiento registrado'); onSaved();
    } catch (e) { toast(e instanceof Error ? e.message : 'Error'); } finally { setBusy(false); }
  }

  const lbl = 'text-xs font-bold text-muted';
  const inp = 'rounded-[9px] border border-line px-3.5 py-2.5 text-[13px] outline-none focus:border-magenta';
  const isEgreso = type === 'EGRESO';
  return (
    <Overlay onClose={onClose} z={120}>
      <div onClick={stop} className="flex max-h-[90vh] w-[480px] max-w-full flex-col overflow-hidden rounded-2xl bg-card animate-pop" style={{ boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
        <div className="flex items-center border-b border-line px-5 py-4"><div className="flex-1 text-[15px] font-extrabold">{entry ? 'Editar movimiento' : 'Registrar movimiento'}</div><button onClick={onClose} className="h-8 w-8 rounded-lg bg-bg text-muted">×</button></div>
        <div className="flex flex-col gap-3 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1"><span className={lbl}>Tipo</span>
              <select value={type} onChange={(e) => setType(e.target.value)} className={inp}>
                {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></label>
            <label className="flex flex-col gap-1"><span className={lbl}>Fecha</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} /></label>
          </div>
          <label className="flex flex-col gap-1"><span className={lbl}>Cuenta</span>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inp}>
              {cats.length === 0 && <option value="">(sin cuentas de este tipo)</option>}
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1"><span className={lbl}>Monto (RD$)</span>
              <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="0" className={inp} /></label>
            <label className="flex flex-col gap-1"><span className={lbl}>Método</span>
              <select value={method} onChange={(e) => setMethod(e.target.value)} className={inp}>
                {METHODS.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
              </select></label>
          </div>
          <label className="flex flex-col gap-1"><span className={lbl}>Sucursal</span>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={inp}>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select></label>
          <label className="flex flex-col gap-1"><span className={lbl}>Concepto</span>
            <input value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Ej. Pago de alquiler septiembre" className={inp} /></label>
          {isEgreso && (
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1"><span className={lbl}>NCF (606, opcional)</span>
                <input value={ncf} onChange={(e) => setNcf(e.target.value)} placeholder="B01…" className={inp} /></label>
              <label className="flex flex-col gap-1"><span className={lbl}>RNC proveedor (opcional)</span>
                <input value={supplierRnc} onChange={(e) => setSupplierRnc(e.target.value)} placeholder="1-31-…" className={inp} /></label>
            </div>
          )}
          <label className="flex flex-col gap-1"><span className={lbl}>Notas (opcional)</span>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={`${inp} resize-none`} /></label>
        </div>
        <div className="flex gap-2.5 border-t border-line px-5 py-4">
          <button onClick={onClose} className="flex-1 rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">Cancelar</button>
          <button onClick={guardar} disabled={busy} className="flex-[2] rounded-[10px] bg-magenta py-3 text-[13.5px] font-bold text-white disabled:opacity-60">{busy ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
    </Overlay>
  );
}

// ── Cierres de período ──
function Cierres({ activeBranch }: { activeBranch: string }) {
  const toast = useToast();
  const [d, setD] = useState<{ branches: Branch[]; periods: Period[] } | null>(null);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [scope, setScope] = useState('all');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api.get<typeof d>('/accounting/periods').then(setD).catch(() => setD(null)); }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (activeBranch !== 'all') setScope(activeBranch); }, [activeBranch]);

  async function cerrar() {
    if (!window.confirm(`¿Cerrar el período ${period}? Bloqueará el registro y edición de movimientos manuales de ese mes.`)) return;
    setBusy(true);
    try { const r = await api.post<{ message: string }>('/accounting/periods/close', { period, branchId: scope === 'all' ? undefined : scope, note: note.trim() || undefined }); toast(r.message); setNote(''); load(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Error'); } finally { setBusy(false); }
  }
  async function reabrir(p: Period) {
    if (!window.confirm(`¿Reabrir el período ${p.period} (${p.branch})?`)) return;
    try { const r = await api.post<{ message: string }>('/accounting/periods/reopen', { id: p.id }); toast(r.message); load(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Error'); }
  }

  const inp = 'rounded-[9px] border border-line bg-card px-3 py-2 text-[13px] outline-none focus:border-magenta';
  return (
    <div className="flex flex-col gap-4">
      <Card title="Cerrar un mes">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1"><span className="text-xs font-bold text-muted">Período</span>
            <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className={inp} /></label>
          <label className="flex flex-col gap-1"><span className="text-xs font-bold text-muted">Alcance</span>
            <select value={scope} onChange={(e) => setScope(e.target.value)} className={inp}>
              <option value="all">Consolidado (todas)</option>
              {(d?.branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select></label>
          <label className="flex flex-1 flex-col gap-1"><span className="text-xs font-bold text-muted">Nota (opcional)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej. Revisado y conciliado con banco" className={inp} /></label>
          <button onClick={cerrar} disabled={busy} className="rounded-[10px] bg-navy px-5 py-2.5 text-[13px] font-bold text-white disabled:opacity-60">{busy ? 'Cerrando…' : 'Cerrar período'}</button>
        </div>
      </Card>
      <Card title="Períodos cerrados">
        {!d ? <Loading /> : d.periods.length === 0 ? <Empty text="Aún no hay períodos cerrados." /> : (
          <div className="overflow-x-auto"><div className="min-w-[720px]">
            <div className="grid grid-cols-[1fr_1.2fr_1fr_1fr_1fr_1fr_90px] gap-2 border-b border-line pb-1.5 text-[11px] font-bold uppercase text-muted"><span>Período</span><span>Alcance</span><span className="text-right">Ingresos</span><span className="text-right">Egresos</span><span className="text-right">Utilidad</span><span>Cerrado</span><span></span></div>
            {d.periods.map((p) => (
              <div key={p.id} className="grid grid-cols-[1fr_1.2fr_1fr_1fr_1fr_1fr_90px] items-center gap-2 border-b border-line-2 py-2 text-[12.5px]">
                <span className="font-bold">{p.period}</span><span className="text-muted">{p.branch}</span>
                <span className="text-right">{fmtRD(p.totalIngresos)}</span><span className="text-right">{fmtRD(p.totalEgresos)}</span>
                <span className="text-right font-extrabold" style={{ color: p.utilidad >= 0 ? 'var(--ok,#1F9D6B)' : 'var(--danger)' }}>{fmtRD(p.utilidad)}</span>
                <span className="text-faint">{p.closedAt}</span>
                <span className="text-right"><button onClick={() => reabrir(p)} className="rounded-md px-2 py-1 text-[12px] font-bold text-muted hover:text-magenta">Reabrir</button></span>
              </div>
            ))}
          </div></div>
        )}
      </Card>
    </div>
  );
}

// ── Plan de cuentas ──
function Cuentas() {
  const toast = useToast();
  const [cats, setCats] = useState<Category[] | null>(null);
  const [kind, setKind] = useState('EGRESO');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api.get<{ categories: Category[] }>('/accounting/categories').then((r) => setCats(r.categories)).catch(() => setCats(null)); }, []);
  useEffect(() => { load(); }, [load]);

  async function agregar() {
    if (!name.trim()) { toast('Escribe el nombre de la cuenta'); return; }
    setBusy(true);
    try { await api.post('/accounting/categories', { kind, name: name.trim() }); toast('Cuenta agregada'); setName(''); load(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Error'); } finally { setBusy(false); }
  }
  async function toggle(c: Category) {
    try { await api.patch(`/accounting/categories/${c.id}`, { active: !c.active }); load(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Error'); }
  }

  const inp = 'rounded-[9px] border border-line bg-card px-3 py-2 text-[13px] outline-none focus:border-magenta';
  const grouped = useMemo(() => {
    const m = new Map<string, Category[]>();
    for (const c of cats ?? []) { const a = m.get(c.kind) ?? []; a.push(c); m.set(c.kind, a); }
    return m;
  }, [cats]);
  return (
    <div className="flex flex-col gap-4">
      <Card title="Agregar cuenta">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1"><span className="text-xs font-bold text-muted">Grupo</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)} className={inp}>
              {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></label>
          <label className="flex flex-1 flex-col gap-1"><span className="text-xs font-bold text-muted">Nombre de la cuenta</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Seguros" className={inp} /></label>
          <button onClick={agregar} disabled={busy} className="rounded-[10px] bg-magenta px-5 py-2.5 text-[13px] font-bold text-white disabled:opacity-60">{busy ? '…' : 'Agregar'}</button>
        </div>
      </Card>
      {!cats ? <Loading /> : Object.keys(TYPE_LABEL).map((k) => {
        const list = grouped.get(k) ?? [];
        if (!list.length) return null;
        return (
          <Card key={k} title={TYPE_LABEL[k]}>
            <div className="flex flex-col gap-1">
              {list.map((c) => (
                <div key={c.id} className="flex items-center justify-between border-b border-line-2 py-1.5 text-[13px]">
                  <span className={c.active ? 'font-semibold' : 'font-semibold text-faint line-through'}>{c.name}</span>
                  <button onClick={() => toggle(c)} className="rounded-md px-2 py-1 text-[12px] font-bold" style={{ color: c.active ? 'var(--muted)' : 'var(--magenta)' }}>{c.active ? 'Desactivar' : 'Activar'}</button>
                </div>
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
