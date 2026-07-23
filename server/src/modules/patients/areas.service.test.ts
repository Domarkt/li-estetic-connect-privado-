import { describe, it, expect } from 'vitest';
import { repartirSesiones } from './areas.service.js';

/**
 * Las sesiones que compró el paciente se reparten entre las áreas a trabajar.
 * Es la base del descuento por sesión: si el reparto pierde o inventa sesiones,
 * la paciente termina recibiendo de menos (queja) o de más (pérdida).
 */
describe('repartirSesiones · reparto entre áreas', () => {
  it('reparte exacto cuando divide', () => {
    expect(repartirSesiones(12, 2)).toEqual([6, 6]);
    expect(repartirSesiones(18, 3)).toEqual([6, 6, 6]);
  });

  it('cuando no divide exacto, el resto va a las primeras áreas', () => {
    expect(repartirSesiones(10, 3)).toEqual([4, 3, 3]);
    expect(repartirSesiones(7, 2)).toEqual([4, 3]);
  });

  it('nunca pierde ni inventa sesiones', () => {
    for (const total of [1, 5, 10, 12, 15, 18, 24, 33]) {
      for (const areas of [1, 2, 3, 4, 5]) {
        const reparto = repartirSesiones(total, areas);
        expect(reparto).toHaveLength(areas);
        expect(reparto.reduce((s, n) => s + n, 0)).toBe(total);
      }
    }
  });

  it('con una sola área, esa área se lleva todo', () => {
    expect(repartirSesiones(9, 1)).toEqual([9]);
  });

  it('sin áreas devuelve un reparto vacío (no revienta)', () => {
    expect(repartirSesiones(10, 0)).toEqual([]);
    expect(repartirSesiones(10, -1)).toEqual([]);
  });

  it('si hay más áreas que sesiones, algunas quedan en cero', () => {
    const reparto = repartirSesiones(2, 4);
    expect(reparto).toEqual([1, 1, 0, 0]);
    expect(reparto.reduce((s, n) => s + n, 0)).toBe(2);
  });
});
