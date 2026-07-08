export type PointsTier = 'ORO' | 'PLATA' | 'BRONCE';

// Parámetros del programa "Líderes LI".
export const COMMISSION_RATE = 0.08; // 8% de ventas del mes
export const TIERS: { tier: PointsTier; min: number; bonus: number; color: string }[] = [
  { tier: 'ORO', min: 1201, bonus: 3000, color: '#C9880E' },
  { tier: 'PLATA', min: 1001, bonus: 2000, color: '#6A7089' },
  { tier: 'BRONCE', min: 0, bonus: 1000, color: '#B87333' },
];

export function tierFor(points: number) {
  return TIERS.find((t) => points >= t.min) ?? TIERS[TIERS.length - 1];
}

export function commissionFor(monthSales: number, points: number) {
  const t = tierFor(points);
  const base = Math.round(monthSales * COMMISSION_RATE);
  return { base, bonus: t.bonus, total: base + t.bonus, tier: t.tier, tierColor: t.color };
}

export const fmt = (n: number) => 'RD$' + Math.round(n).toLocaleString('en-US');
