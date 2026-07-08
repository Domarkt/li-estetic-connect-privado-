import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { CalendarResponse } from '../../lib/types';

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function monthKey(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function dayKey(y: number, m: number, day: number) { return `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }

interface Props { branchQuery: string; onPickDay: (date: string) => void }

export default function CalendarView({ branchQuery, onPickDay }: Props) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [data, setData] = useState<CalendarResponse>({ month: '', days: {} });

  const load = useCallback(() => {
    const m = monthKey(cursor);
    api.get<CalendarResponse>(`/appointments/calendar?month=${m}${branchQuery ? '&' + branchQuery : ''}`).then(setData).catch(() => {});
  }, [cursor, branchQuery]);
  useEffect(() => { load(); }, [load]);

  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const firstDow = (new Date(y, m, 1).getDay() + 6) % 7; // lunes=0
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayKey = dayKey(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  const cells: (number | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="rounded-base border border-line bg-card p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-base font-extrabold">{MONTHS[m]} {y}</div>
        <div className="flex gap-2">
          <button onClick={() => setCursor(new Date(y, m - 1, 1))} className="h-8 w-8 rounded-lg border border-line bg-card font-bold text-muted hover:border-magenta">‹</button>
          <button onClick={() => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); }} className="rounded-lg border border-line bg-card px-3 text-[12.5px] font-bold text-muted hover:border-magenta">Hoy</button>
          <button onClick={() => setCursor(new Date(y, m + 1, 1))} className="h-8 w-8 rounded-lg border border-line bg-card font-bold text-muted hover:border-magenta">›</button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map((w) => <div key={w} className="pb-1 text-center text-[11px] font-bold uppercase text-faint">{w}</div>)}
        {cells.map((day, i) => {
          if (day === null) return <div key={`e${i}`} />;
          const key = dayKey(y, m, day);
          const info = data.days[key];
          const isToday = key === todayKey;
          return (
            <button key={key} onClick={() => onPickDay(key)}
              className="flex min-h-[84px] flex-col rounded-[10px] border p-1.5 text-left transition hover:border-magenta"
              style={{ borderColor: isToday ? 'var(--magenta)' : 'var(--line)', background: info ? 'var(--card)' : 'var(--bg)' }}>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[12px] font-bold" style={{ color: isToday ? 'var(--magenta)' : 'var(--ink)' }}>{day}</span>
                {info && <span className="rounded-full bg-magenta px-1.5 text-[9.5px] font-bold text-white">{info.count}</span>}
              </div>
              <div className="flex flex-col gap-0.5 overflow-hidden">
                {info?.items.slice(0, 3).map((it, j) => (
                  <div key={j} className="truncate rounded px-1 py-0.5 text-[9.5px] font-semibold"
                    style={{ background: it.status === 'CONFIRMADA' ? 'var(--ok-soft)' : it.status === 'CANCELADA' ? 'var(--danger-soft)' : 'var(--warn-soft)', color: it.status === 'CONFIRMADA' ? 'var(--ok)' : it.status === 'CANCELADA' ? 'var(--danger)' : 'var(--warn)' }}>
                    {it.time} {it.patient.split(' ')[0]}
                  </div>
                ))}
                {info && info.count > 3 && <div className="px-1 text-[9.5px] font-semibold text-faint">+{info.count - 3} más</div>}
                {!info && <div className="px-1 text-[9.5px] text-faint">Libre</div>}
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex gap-4 text-[11px] text-muted">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-ok" /> Confirmada</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-warn" /> Sin confirmar</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: 'var(--bg)', border: '1px solid var(--line)' }} /> Día libre</span>
      </div>
    </div>
  );
}
