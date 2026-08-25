import { describe, expect, it } from 'vitest';
import { businessHoursError, DEFAULT_BUSINESS_HOURS } from './business-hours.js';

describe('horario configurable de sucursal', () => {
  it('permite una cita de 30 minutos a las 6:30 p. m. entre semana', () => {
    expect(businessHoursError(DEFAULT_BUSINESS_HOURS, new Date('2026-08-25T18:30:00'), 30)).toBeNull();
  });

  it('rechaza una cita de 60 minutos a las 6:30 p. m. si cierra a las 7', () => {
    expect(businessHoursError(DEFAULT_BUSINESS_HOURS, new Date('2026-08-25T18:30:00'), 60)).toContain('09:00–19:00');
  });

  it('permite terminar exactamente a las 3 p. m. del sábado', () => {
    expect(businessHoursError(DEFAULT_BUSINESS_HOURS, new Date('2026-08-29T14:30:00'), 30)).toBeNull();
  });

  it('bloquea el domingo por defecto', () => {
    expect(businessHoursError(DEFAULT_BUSINESS_HOURS, new Date('2026-08-30T10:00:00'), 30)).toContain('cerrada');
  });

  it('respeta una variación configurada por la sucursal', () => {
    const custom = { ...DEFAULT_BUSINESS_HOURS, weekdays: { open: '10:00', close: '20:00', closed: false } };
    expect(businessHoursError(custom, new Date('2026-08-25T19:30:00'), 30)).toBeNull();
  });
});
