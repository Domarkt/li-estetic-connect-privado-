import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useBranch } from '../../layout/BranchContext';
import { useToast } from '../../components/Toast';
import { fmtRD } from '../../lib/types';

// ── Tipos del reporte ──
interface Overview {
  period: { from: string; to: string };
  sales: {
    total: number; count: number; avgTicket: number;
    byBranch: { name: string; total: number; count: number }[];
    byMethod: { method: string; total: number }[];
    topItems: { name: string; total: number; qty: number }[];
    daily: { date: string; total: number }[];
  };
  operations: {
    total: number; attended: number; cancelled: number;
    byStatus: Record<string, number>;
    cancelBy: Record<string, number>;
    cancelReasons: { reason: string; count: number }[];
    newVsRecurrent: { nuevos: number; recurrentes: number };
    avgRating: number | null; ratedCount: number; lowRatings: number;
  };
  team: {
    pointsRanking: { name: string; branch: string; role: string; points: number }[];
    performance: { name: string; attended: number; avgRating: number | null }[];
  };
}
interface Campaign {
  count: number; bySex: { F: number; M: number; ND: number }; byAge: Record<string, number>;
  patients: { id: string; name: string; phone: string; email: string | null; sex: string | null; age: number | null; branch: string; type: string; motivos: string[]; treatment: string | null }[];
}

type Tab = 'ventas' | 'operacion' | 'equipo' | 'campanas';
const firstOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); };
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function ReportsPage() {
  const { activeBranch } = useBranch();
  const [tab, setTab] = useState<Tab>('ventas');
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(todayISO());
  const [d, setD] = useState<Overview | null>(null);

  const branchQ = activeBranch !== 'all' ? `&branch=${activeBranch}` : '';
  const load = useCallback(() => {
    api.get<Overview>(`/reports/overview?from=${from}&to=${to}${branchQ}`).then(setD).catch(() => setD(null));
  }, [from, to, branchQ]);
  useEffect(() => { load(); }, [load]);

  const TABS: { key: Tab; label: string }[] = [
    { key: 'ventas', label: 'Ventas' }, { key: 'operacion', label: 'Operación' },
    { key: 'equipo', label: 'Equipo' }, { key: 'campanas', label: 'Campañas' },
  ];

  return (
    <div className="animate-fade">
      {/* Filtros */}
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-bold text-muted">Del</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-[12.5px] font-semibold" />
        <span className="text-[12px] font-bold text-muted">al</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-[12.5px] font-semibold" />
        <span className="ml-1 text-[11.5px] text-faint">Sucursal: usa el selector de arriba (Todas / E1 / E2 / E3)</span>
      </div>

      <div className="mb-4 flex gap-1 rounded-[10px] border border-line bg-bg p-1">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className="rounded-[7px] px-3.5 py-1.5 text-[12.5px] font-bold transition"
            style={{ background: tab === t.key ? 'var(--magenta)' : 'transparent', color: tab === t.key ? '#fff' : 'var(--muted)' }}>{t.label}</button>
        ))}
      </div>

      {!d ? <div className="py-10 text-center text-sm text-muted">Cargando…</div> : (
        <>
          {tab === 'ventas' && <Ventas s={d.sales} />}
          {tab === 'operacion' && <Operacion o={d.operations} />}
          {tab === 'equipo' && <Equipo t={d.team} />}
          {tab === 'campanas' && <Campanas branchQ={branchQ} />}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-[150px] flex-1 rounded-xl border border-line bg-card px-[18px] py-4 shadow-card">
      <div className="text-xs font-semibold text-muted">{label}</div>
      <div className="mt-0.5 text-[21px] font-extrabold">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

function Bar({ label, value, max, right }: { label: string; value: number; max: number; right: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="mb-2">
      <div className="mb-1 flex justify-between text-[12.5px]"><span className="font-semibold">{label}</span><span className="font-bold">{right}</span></div>
      <div className="h-2.5 overflow-hidden rounded-md" style={{ background: 'var(--navy-soft)' }}><div className="h-full rounded-md" style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#B31C86,#D4419E)' }} /></div>
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

function Ventas({ s }: { s: Overview['sales'] }) {
  const maxItem = Math.max(1, ...s.topItems.map((i) => i.total));
  const maxDay = Math.max(1, ...s.daily.map((x) => x.total));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3.5">
        <Stat label="Ventas del período" value={fmtRD(s.total)} sub={`${s.count} recibos`} />
        <Stat label="Ticket promedio" value={fmtRD(s.avgTicket)} />
        <Stat label="Recibos" value={String(s.count)} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Ventas por sucursal">
          {s.byBranch.length === 0 ? <Empty /> : s.byBranch.map((b) => <Bar key={b.name} label={b.name} value={b.total} max={Math.max(1, ...s.byBranch.map((x) => x.total))} right={`${fmtRD(b.total)} · ${b.count}`} />)}
        </Card>
        <Card title="Ventas por método de pago">
          {s.byMethod.length === 0 ? <Empty /> : s.byMethod.map((m) => <Bar key={m.method} label={m.method} value={m.total} max={Math.max(1, ...s.byMethod.map((x) => x.total))} right={fmtRD(m.total)} />)}
        </Card>
      </div>
      <Card title="Servicios / paquetes más vendidos">
        {s.topItems.length === 0 ? <Empty /> : s.topItems.map((i) => <Bar key={i.name} label={`${i.name} (${i.qty})`} value={i.total} max={maxItem} right={fmtRD(i.total)} />)}
      </Card>
      <Card title="Ventas por día">
        {s.daily.length === 0 ? <Empty /> : (
          <div className="flex items-end gap-1.5 overflow-x-auto pb-1" style={{ height: 130 }}>
            {s.daily.map((x) => (
              <div key={x.date} className="flex min-w-[26px] flex-col items-center gap-1" title={`${x.date}: ${fmtRD(x.total)}`}>
                <div className="w-full rounded-t" style={{ height: `${Math.max(4, (x.total / maxDay) * 100)}px`, background: 'linear-gradient(180deg,#D4419E,#B31C86)' }} />
                <span className="text-[9px] text-faint">{x.date.slice(8)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Operacion({ o }: { o: Overview['operations'] }) {
  const STATUS_LABEL: Record<string, string> = { SIN_CONFIRMAR: 'Sin confirmar', CONFIRMADA: 'Confirmada', COMPLETADA: 'Completada', CANCELADA: 'Cancelada', REAGENDADA: 'Reagendada' };
  const totalNR = o.newVsRecurrent.nuevos + o.newVsRecurrent.recurrentes || 1;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3.5">
        <Stat label="Citas del período" value={String(o.total)} />
        <Stat label="Atendidas" value={String(o.attended)} sub={`${o.total ? Math.round((o.attended / o.total) * 100) : 0}%`} />
        <Stat label="Canceladas" value={String(o.cancelled)} sub={`${o.total ? Math.round((o.cancelled / o.total) * 100) : 0}%`} />
        <Stat label="Calificación promedio" value={o.avgRating != null ? `${o.avgRating} ★` : '—'} sub={`${o.ratedCount} calificadas`} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Citas por estado">
          {Object.keys(o.byStatus).length === 0 ? <Empty /> : Object.entries(o.byStatus).map(([k, v]) => <Bar key={k} label={STATUS_LABEL[k] ?? k} value={v} max={Math.max(1, ...Object.values(o.byStatus))} right={String(v)} />)}
        </Card>
        <Card title="Nuevos vs. recurrentes">
          <Bar label="Clientes nuevos" value={o.newVsRecurrent.nuevos} max={totalNR} right={String(o.newVsRecurrent.nuevos)} />
          <Bar label="Recurrentes" value={o.newVsRecurrent.recurrentes} max={totalNR} right={String(o.newVsRecurrent.recurrentes)} />
          <div className="mt-3 text-[12px] text-muted">Cancelaron: <b>{o.cancelBy.PATIENT ?? 0}</b> pacientes · <b>{o.cancelBy.STAFF ?? 0}</b> recepción</div>
          {o.lowRatings > 0 && <div className="mt-1 text-[12px] font-semibold text-danger">⚠ {o.lowRatings} calificaciones menores a 5★</div>}
        </Card>
      </div>
      <Card title="Motivos de cancelación">
        {o.cancelReasons.length === 0 ? <Empty text="Sin cancelaciones en el período." /> : o.cancelReasons.map((r) => (
          <div key={r.reason} className="flex justify-between border-b border-line-2 py-1.5 text-[12.5px]"><span>{r.reason}</span><span className="font-bold">{r.count}</span></div>
        ))}
      </Card>
    </div>
  );
}

function Equipo({ t }: { t: Overview['team'] }) {
  const maxP = Math.max(1, ...t.pointsRanking.map((r) => r.points));
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Ranking de puntos · Líderes LI">
        {t.pointsRanking.length === 0 ? <Empty /> : t.pointsRanking.map((r, i) => (
          <div key={r.name} className="mb-2">
            <div className="mb-1 flex justify-between text-[12.5px]"><span className="font-semibold">{i + 1}. {r.name} <span className="text-faint">· {r.branch}</span></span><span className="font-bold text-magenta">{r.points} pts</span></div>
            <div className="h-2 overflow-hidden rounded-md" style={{ background: 'var(--navy-soft)' }}><div className="h-full rounded-md" style={{ width: `${Math.max(0, (r.points / maxP) * 100)}%`, background: 'linear-gradient(90deg,#B31C86,#D4419E)' }} /></div>
          </div>
        ))}
      </Card>
      <Card title="Desempeño de esteticistas">
        {t.performance.length === 0 ? <Empty /> : (
          <div className="flex flex-col gap-1">
            <div className="grid grid-cols-[2fr_1fr_1fr] gap-2 border-b border-line pb-1.5 text-[11px] font-bold uppercase text-muted"><span>Esteticista</span><span className="text-center">Atendidas</span><span className="text-center">Calif.</span></div>
            {t.performance.map((p) => (
              <div key={p.name} className="grid grid-cols-[2fr_1fr_1fr] gap-2 border-b border-line-2 py-1.5 text-[12.5px]"><span className="font-semibold">{p.name}</span><span className="text-center font-bold">{p.attended}</span><span className="text-center">{p.avgRating != null ? `${p.avgRating}★` : '—'}</span></div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Campanas({ branchQ }: { branchQ: string }) {
  const toast = useToast();
  const [sex, setSex] = useState('');
  const [minAge, setMinAge] = useState('');
  const [maxAge, setMaxAge] = useState('');
  const [motivo, setMotivo] = useState('');
  const [c, setC] = useState<Campaign | null>(null);

  const run = useCallback(() => {
    const p = new URLSearchParams();
    if (sex) p.set('sex', sex);
    if (minAge) p.set('minAge', minAge);
    if (maxAge) p.set('maxAge', maxAge);
    if (motivo.trim()) p.set('motivo', motivo.trim());
    api.get<Campaign>(`/reports/patients?${p.toString()}${branchQ}`).then(setC).catch(() => setC(null));
  }, [sex, minAge, maxAge, motivo, branchQ]);
  useEffect(() => { run(); }, [run]);

  function copy(kind: 'phone' | 'email') {
    if (!c) return;
    const list = c.patients.map((x) => (kind === 'phone' ? x.phone : x.email)).filter(Boolean).join(', ');
    navigator.clipboard?.writeText(list).then(() => toast(`${kind === 'phone' ? 'Teléfonos' : 'Correos'} copiados (${list.split(', ').filter(Boolean).length})`)).catch(() => toast('No se pudo copiar'));
  }

  const inp = 'rounded-lg border border-line bg-card px-2.5 py-1.5 text-[12.5px]';
  return (
    <div className="flex flex-col gap-4">
      <Card title="Filtro de pacientes para campaña">
        <div className="flex flex-wrap items-end gap-2.5">
          <label className="flex flex-col gap-1"><span className="text-[11px] font-bold text-muted">Sexo</span>
            <select value={sex} onChange={(e) => setSex(e.target.value)} className={inp}><option value="">Todos</option><option value="F">Femenino</option><option value="M">Masculino</option></select>
          </label>
          <label className="flex flex-col gap-1"><span className="text-[11px] font-bold text-muted">Edad mín.</span><input value={minAge} onChange={(e) => setMinAge(e.target.value)} inputMode="numeric" className={`${inp} w-20`} /></label>
          <label className="flex flex-col gap-1"><span className="text-[11px] font-bold text-muted">Edad máx.</span><input value={maxAge} onChange={(e) => setMaxAge(e.target.value)} inputMode="numeric" className={`${inp} w-20`} /></label>
          <label className="flex flex-col gap-1"><span className="text-[11px] font-bold text-muted">Motivo (ej. Acné)</span><input value={motivo} onChange={(e) => setMotivo(e.target.value)} className={inp} /></label>
        </div>
      </Card>

      {c && (
        <>
          <div className="flex flex-wrap gap-3.5">
            <Stat label="Pacientes encontrados" value={String(c.count)} />
            <Stat label="Femenino / Masculino" value={`${c.bySex.F} / ${c.bySex.M}`} sub={c.bySex.ND ? `${c.bySex.ND} sin definir` : undefined} />
          </div>
          <Card title="Por rango de edad">
            {Object.entries(c.byAge).filter(([, v]) => v > 0).map(([k, v]) => <Bar key={k} label={k} value={v} max={Math.max(1, ...Object.values(c.byAge))} right={String(v)} />)}
          </Card>
          <Card title={`Lista para campaña (${c.count})`}>
            <div className="mb-3 flex gap-2">
              <button onClick={() => copy('phone')} className="rounded-lg bg-navy px-3 py-1.5 text-[12px] font-bold text-white">Copiar teléfonos</button>
              <button onClick={() => copy('email')} className="rounded-lg bg-navy px-3 py-1.5 text-[12px] font-bold text-white">Copiar correos</button>
            </div>
            <div className="max-h-[420px] overflow-auto">
              <div className="min-w-[560px]">
                <div className="grid grid-cols-[2fr_1.3fr_1.6fr_.7fr_1.2fr] gap-2 border-b border-line pb-1.5 text-[11px] font-bold uppercase text-muted"><span>Paciente</span><span>Teléfono</span><span>Correo</span><span>Sexo</span><span>Sucursal</span></div>
                {c.patients.length === 0 && <Empty text="Ningún paciente con esos filtros." />}
                {c.patients.map((p) => (
                  <div key={p.id} className="grid grid-cols-[2fr_1.3fr_1.6fr_.7fr_1.2fr] items-center gap-2 border-b border-line-2 py-1.5 text-[12px]">
                    <span className="font-semibold">{p.name}{p.age != null ? ` · ${p.age}a` : ''}</span>
                    <span>{p.phone}</span>
                    <span className="truncate text-faint">{p.email ?? '—'}</span>
                    <span>{p.sex === 'F' ? 'F' : p.sex === 'M' ? 'M' : '—'}</span>
                    <span className="text-muted">{p.branch}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function Empty({ text = 'Sin datos en el período.' }: { text?: string }) {
  return <div className="py-6 text-center text-[12.5px] text-muted">{text}</div>;
}
