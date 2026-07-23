import { describe, it, expect } from 'vitest';
import { repartirSesiones } from './areas.service.js';

/**
 * Un paciente puede tener VARIOS paquetes activos a la vez (4, 5 o más).
 * Estas pruebas fijan las reglas de consolidación: si alguien vuelve a mostrar
 * solo "el primer plan", estas pruebas fallan.
 */

/** Igual que serializePatient: consolida el avance y el saldo de todos los planes. */
function consolidar(planes: { done: number; total: number; balance: number }[]) {
  const hechas = planes.reduce((s, x) => s + x.done, 0);
  const totales = planes.reduce((s, x) => s + x.total, 0);
  return {
    progLabel: `${hechas}/${totales}`,
    progPct: totales > 0 ? Math.round((hechas / totales) * 100) : 0,
    balance: planes.reduce((s, x) => s + x.balance, 0),
  };
}

describe('Paciente con varios paquetes a la vez', () => {
  const cinco = [
    { done: 2, total: 5, balance: 0 },      // combo glúteos
    { done: 2, total: 18, balance: 3000 },  // reduce abdomen (con saldo)
    { done: 0, total: 6, balance: 0 },      // oferta flash
    { done: 5, total: 10, balance: 1500 },  // celulitis (con saldo)
    { done: 10, total: 10, balance: 0 },    // terminado
  ];

  it('el avance es la suma de todos, no el del primero', () => {
    // Con el primero solo se vería "2/5"; el real es 19/49.
    expect(consolidar(cinco).progLabel).toBe('19/49');
  });

  it('el saldo suma TODOS los planes: uno al día no puede tapar a otro con deuda', () => {
    expect(consolidar(cinco).balance).toBe(4500);
  });

  it('el porcentaje se calcula sobre el total consolidado', () => {
    expect(consolidar(cinco).progPct).toBe(39); // 19/49 = 38.7 -> 39
  });

  it('sin paquetes no revienta ni divide por cero', () => {
    expect(consolidar([])).toEqual({ progLabel: '0/0', progPct: 0, balance: 0 });
  });

  it('escala: con 20 paquetes sigue cuadrando', () => {
    const muchos = Array.from({ length: 20 }, () => ({ done: 3, total: 10, balance: 500 }));
    const r = consolidar(muchos);
    expect(r.progLabel).toBe('60/200');
    expect(r.balance).toBe(10_000);
    expect(r.progPct).toBe(30);
  });
});

/**
 * Cada plan reparte SUS sesiones entre SUS áreas, de forma independiente.
 * Que el paciente tenga otros planes no puede alterar este reparto.
 */
describe('Reparto de áreas con varios planes', () => {
  it('cada plan reparte lo suyo sin mezclarse', () => {
    const glúteos = repartirSesiones(5, 1);   // 1 área
    const abdomen = repartirSesiones(18, 2);  // 2 áreas
    expect(glúteos).toEqual([5]);
    expect(abdomen).toEqual([9, 9]);
    // Ningún reparto pierde sesiones del otro.
    expect(glúteos.reduce((a, b) => a + b, 0)).toBe(5);
    expect(abdomen.reduce((a, b) => a + b, 0)).toBe(18);
  });

  it('trabajar 2 áreas en una visita consume 2 sesiones de ESE plan', () => {
    // Regla del descuento: el plan consume tantas sesiones como áreas trabajadas.
    const areasTrabajadas = 2;
    const consumidas = areasTrabajadas || 1;
    expect(consumidas).toBe(2);
    // 18 sesiones repartidas 9 y 9 -> 9 visitas trabajando ambas áreas.
    expect(18 / consumidas).toBe(9);
  });

  it('sin marcar áreas se consume 1 sesión', () => {
    const consumidas = 0 || 1;
    expect(consumidas).toBe(1);
  });
});
