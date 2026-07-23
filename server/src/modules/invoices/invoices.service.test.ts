import { describe, it, expect } from 'vitest';
import { splitItbis, rncValido, formatRnc } from './invoices.service.js';

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

  // No todos los servicios estéticos llevan ITBIS: recepción lo decide al cobrar.
  it('sin ITBIS, el subtotal es el total y el impuesto queda en cero', () => {
    expect(splitItbis(3500, false)).toEqual({ subtotal: 3500, itbis: 0 });
    expect(splitItbis(12_345, false)).toEqual({ subtotal: 12_345, itbis: 0 });
  });

  it('el desglose cuadra con el total lleve o no lleve ITBIS', () => {
    for (const total of [500, 3500, 9_999, 45_000]) {
      for (const aplica of [true, false]) {
        const { subtotal, itbis } = splitItbis(total, aplica);
        expect(subtotal + itbis).toBe(total);
      }
    }
  });
});

/**
 * En crédito fiscal (B01) la DGII exige identificar al comprador: RNC de 9
 * dígitos o cédula de 11. Emitir sin esto deja un comprobante que no se puede
 * corregir después.
 */
describe('rncValido · identificación del comprador', () => {
  it('acepta RNC de 9 dígitos', () => {
    expect(rncValido('131462332')).toBe(true);
    expect(rncValido('1-31-46233-2')).toBe(true); // con guiones
  });

  it('acepta cédula de 11 dígitos', () => {
    expect(rncValido('00112345678')).toBe(true);
    expect(rncValido('001-1234567-8')).toBe(true);
  });

  it('rechaza longitudes que no son ni RNC ni cédula', () => {
    for (const malo of ['', '123', '12345678', '1234567890', '123456789012']) {
      expect(rncValido(malo), `"${malo}" no debería pasar`).toBe(false);
    }
  });

  it('rechaza texto sin dígitos suficientes', () => {
    expect(rncValido('no-tengo')).toBe(false);
  });
});

describe('formatRnc · presentación en el comprobante', () => {
  it('formatea el RNC de empresa', () => {
    expect(formatRnc('131462332')).toBe('1-31-46233-2');
  });

  it('formatea la cédula', () => {
    expect(formatRnc('00112345678')).toBe('001-1234567-8');
  });

  it('deja intacto lo que no reconoce', () => {
    expect(formatRnc('abc')).toBe('abc');
  });
});
