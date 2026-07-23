import { describe, it, expect } from 'vitest';
import { splitItbis } from './invoices.service.js';

/**
 * El precio que cobra la estética SIEMPRE lleva el ITBIS incluido (18%).
 * El recibo desglosa subtotal + ITBIS, y ese desglose tiene que sumar
 * exactamente el total cobrado: si no cuadra, no cuadra la caja.
 */
describe('splitItbis · desglose del ITBIS incluido', () => {
  it('el subtotal más el ITBIS siempre reconstruyen el total', () => {
    for (const total of [1, 100, 999, 1500, 3500, 7800, 12_345, 99_999, 250_000]) {
      const { subtotal, itbis } = splitItbis(total);
      expect(subtotal + itbis).toBe(total);
    }
  });

  it('separa correctamente un cobro típico de RD$3,500', () => {
    // 3500 / 1.18 = 2966.10… → subtotal 2966, ITBIS 534
    expect(splitItbis(3500)).toEqual({ subtotal: 2966, itbis: 534 });
  });

  it('nunca devuelve un ITBIS negativo', () => {
    for (const total of [0, 1, 2, 5, 17, 118]) {
      expect(splitItbis(total).itbis).toBeGreaterThanOrEqual(0);
    }
  });

  it('el ITBIS ronda el 15.25% del total (18% ya incluido)', () => {
    const { itbis } = splitItbis(100_000);
    // 100000 - round(100000/1.18) = 100000 - 84746 = 15254
    expect(itbis).toBe(15_254);
  });

  it('un total de cero no genera impuesto', () => {
    expect(splitItbis(0)).toEqual({ subtotal: 0, itbis: 0 });
  });
});
