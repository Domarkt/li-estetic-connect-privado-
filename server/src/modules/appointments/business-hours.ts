export type DayHours = { open: string; close: string; closed: boolean };
export type BusinessHours = { weekdays: DayHours; saturday: DayHours; sunday: DayHours };

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  weekdays: { open: '09:00', close: '19:00', closed: false },
  saturday: { open: '09:00', close: '15:00', closed: false },
  sunday: { open: '09:00', close: '15:00', closed: true },
};

export function normalizeBusinessHours(raw: unknown): BusinessHours {
  if (!raw || typeof raw !== 'object') return DEFAULT_BUSINESS_HOURS;
  const r = raw as Partial<Record<keyof BusinessHours, Partial<DayHours>>>;
  const day = (key: keyof BusinessHours): DayHours => ({
    open: r[key]?.open ?? DEFAULT_BUSINESS_HOURS[key].open,
    close: r[key]?.close ?? DEFAULT_BUSINESS_HOURS[key].close,
    closed: r[key]?.closed ?? DEFAULT_BUSINESS_HOURS[key].closed,
  });
  return { weekdays: day('weekdays'), saturday: day('saturday'), sunday: day('sunday') };
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export function hoursForDate(raw: unknown, date: Date): DayHours {
  const h = normalizeBusinessHours(raw);
  return date.getDay() === 0 ? h.sunday : date.getDay() === 6 ? h.saturday : h.weekdays;
}

/** Devuelve un mensaje si la cita queda fuera del horario de la sucursal. */
export function businessHoursError(raw: unknown, startsAt: Date, durationMin: number): string | null {
  const h = hoursForDate(raw, startsAt);
  if (h.closed) return 'La sucursal está cerrada ese día. Modifica su horario en Configuración si abrirá excepcionalmente.';
  const start = startsAt.getHours() * 60 + startsAt.getMinutes();
  const end = start + durationMin;
  if (start < minutes(h.open) || end > minutes(h.close)) {
    return `La cita (${durationMin} min) debe quedar dentro del horario ${h.open}–${h.close}. Ajusta la hora o la duración.`;
  }
  return null;
}
