import { describe, expect, it } from 'vitest';
import { resolveAppointmentTreatmentId } from './appointments.service.js';

const plans = [
  { id: 'plan-1', name: '1 SECCION DE MASAJE POSTOPERATORIO DE SEGUNDA', active: true, totalSessions: 10, doneSessions: 2 },
];

describe('resolveAppointmentTreatmentId', () => {
  it('conserva el tratamiento enlazado', () => {
    expect(resolveAppointmentTreatmentId(plans, 'plan-1', 'Otro nombre')).toBe('plan-1');
  });

  it('recupera el único plan activo de una cita antigua', () => {
    expect(resolveAppointmentTreatmentId(plans, null, 'Servicio importado')).toBe('plan-1');
  });

  it('recupera por nombre normalizado cuando hay varios planes', () => {
    const varios = [...plans, { id: 'plan-2', name: 'INDIBA', active: true, totalSessions: 10, doneSessions: 0 }];
    expect(resolveAppointmentTreatmentId(varios, null, '1 sección de masaje postoperatorio de segunda')).toBe('plan-1');
  });
});
