import { describe, it, expect } from 'vitest';

/**
 * Disponibilidad real de la esteticista.
 *
 * Regla: una cita ocupa la agenda hasta que se cierra el turno. Si terminó antes
 * de lo previsto, la esteticista queda libre desde ese momento; si la atendió
 * antes de la hora, ocupó desde que abrió el turno.
 *
 * Copia de la lógica de ventanaReal() en appointments.routes.ts.
 */
function ventanaReal(a: {
  startsAt: Date; durationMin: number;
  serviceStartedAt?: Date | null; serviceEndedAt?: Date | null;
}) {
  const ini = a.serviceStartedAt
    ? Math.min(a.startsAt.getTime(), a.serviceStartedAt.getTime())
    : a.startsAt.getTime();
  const fin = a.serviceEndedAt
    ? Math.max(ini, a.serviceEndedAt.getTime())
    : a.startsAt.getTime() + a.durationMin * 60_000;
  return { ini, fin };
}

const h = (hhmm: string) => new Date(`2026-07-23T${hhmm}:00`);
const SEPARACION_MS = 30 * 60_000;

/** ¿Se puede agendar una cita nueva en ese hueco? */
function cabe(nueva: { desde: string; durMin: number }, ocupadas: Parameters<typeof ventanaReal>[0][]) {
  const nIni = h(nueva.desde).getTime();
  const nFin = nIni + nueva.durMin * 60_000;
  return !ocupadas.some((a) => {
    const { ini, fin } = ventanaReal(a);
    // Turno cerrado = sin colchón: ya se sabe a qué hora quedó libre.
    const margen = a.serviceEndedAt ? 0 : SEPARACION_MS;
    return nIni < fin + margen && ini < nFin + margen;
  });
}

describe('Disponibilidad de la esteticista', () => {
  it('el caso real: cita 3:00 de 1h que cerró 3:15 libera las 3:30', () => {
    const atendida = {
      startsAt: h('15:00'), durationMin: 60,
      serviceStartedAt: h('14:50'), // el paciente llegó antes
      serviceEndedAt: h('15:15'),   // y terminó antes
    };
    // Antes se reservaba hasta las 16:00 y esto se bloqueaba.
    expect(cabe({ desde: '15:30', durMin: 30 }, [atendida])).toBe(true);
  });

  it('mientras el turno NO se ha cerrado, se respeta la duración prevista', () => {
    const enCurso = { startsAt: h('15:00'), durationMin: 60, serviceStartedAt: h('15:00'), serviceEndedAt: null };
    expect(cabe({ desde: '15:30', durMin: 30 }, [enCurso])).toBe(false);
  });

  it('no se puede encimar sobre el rato que realmente estuvo ocupada', () => {
    const atendida = { startsAt: h('15:00'), durationMin: 60, serviceStartedAt: h('14:50'), serviceEndedAt: h('15:15') };
    // 15:10 cae dentro de la atención real (14:50–15:15).
    expect(cabe({ desde: '15:10', durMin: 30 }, [atendida])).toBe(false);
  });

  it('cerrado el turno no se exige colchón: puede atender enseguida', () => {
    const atendida = { startsAt: h('15:00'), durationMin: 60, serviceStartedAt: h('14:50'), serviceEndedAt: h('15:15') };
    // La separación de 30 min protege de que una cita se alargue; si ya cerró,
    // no hay nada que estimar y recepción decide el hueco.
    expect(cabe({ desde: '15:20', durMin: 30 }, [atendida])).toBe(true);
  });

  it('con la cita en curso SÍ se exigen los 30 min de separación', () => {
    const enCurso = { startsAt: h('15:00'), durationMin: 30, serviceStartedAt: h('15:00'), serviceEndedAt: null };
    expect(cabe({ desde: '15:40', durMin: 30 }, [enCurso])).toBe(false); // solo 10 min después
    expect(cabe({ desde: '16:00', durMin: 30 }, [enCurso])).toBe(true);
  });

  it('llegar antes de la hora ocupa desde que abrió el turno', () => {
    const temprano = { startsAt: h('15:00'), durationMin: 30, serviceStartedAt: h('14:40'), serviceEndedAt: h('15:10') };
    const { ini } = ventanaReal(temprano);
    expect(ini).toBe(h('14:40').getTime());
  });

  it('una cita sin abrir usa su horario previsto tal cual', () => {
    const prevista = { startsAt: h('15:00'), durationMin: 45, serviceStartedAt: null, serviceEndedAt: null };
    const { ini, fin } = ventanaReal(prevista);
    expect(ini).toBe(h('15:00').getTime());
    expect(fin).toBe(h('15:45').getTime());
  });

  it('un cierre anterior al inicio no invierte la ventana', () => {
    const raro = { startsAt: h('15:00'), durationMin: 60, serviceStartedAt: null, serviceEndedAt: h('14:30') };
    const { ini, fin } = ventanaReal(raro);
    expect(fin).toBeGreaterThanOrEqual(ini);
  });
});
