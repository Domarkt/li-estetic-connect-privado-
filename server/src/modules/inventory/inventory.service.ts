import { prisma } from '../../db/prisma.js';

export type StockReason = 'ENTRADA' | 'VENTA' | 'CONSUMO' | 'AJUSTE';

/**
 * Ajusta la existencia de un producto/insumo en UNA sucursal y deja traza del
 * movimiento. `delta` positivo = entrada; negativo = salida (venta/consumo).
 * La existencia nunca baja de 0. Idempotente al crear el nivel (upsert).
 */
export async function adjustStock(opts: {
  branchId: string;
  catalogItemId: string;
  delta: number;
  reason: StockReason;
  note?: string | null;
  createdById?: string | null;
}) {
  const { branchId, catalogItemId, delta, reason, note, createdById } = opts;

  const level = await prisma.stockLevel.upsert({
    where: { branchId_catalogItemId: { branchId, catalogItemId } },
    create: { branchId, catalogItemId, qty: 0 },
    update: {},
  });
  const newQty = Math.max(0, level.qty + delta);
  const applied = newQty - level.qty; // delta real aplicado (por si topó en 0)

  const [updated] = await prisma.$transaction([
    prisma.stockLevel.update({ where: { id: level.id }, data: { qty: newQty } }),
    prisma.stockMovement.create({
      data: { branchId, catalogItemId, delta: applied, reason, note: note ?? null, createdById: createdById ?? null },
    }),
  ]);
  return updated;
}

/**
 * Descuenta del stock los PRODUCTOS vendidos en una factura (por sucursal).
 * Best-effort: si algo falla no rompe el cobro. Solo afecta ítems de tipo PRODUCTO
 * que tengan nivel de inventario en esa sucursal.
 */
export async function decrementSoldProducts(
  branchId: string,
  catalogItemIds: string[],
  createdById?: string | null,
) {
  if (!catalogItemIds.length) return;
  try {
    // Cuenta cuántas unidades de cada ítem se facturaron.
    const counts = new Map<string, number>();
    for (const id of catalogItemIds) counts.set(id, (counts.get(id) ?? 0) + 1);

    const products = await prisma.catalogItem.findMany({
      where: { id: { in: [...counts.keys()] }, kind: 'PRODUCTO' },
      select: { id: true },
    });
    for (const p of products) {
      const qty = counts.get(p.id) ?? 1;
      await adjustStock({ branchId, catalogItemId: p.id, delta: -qty, reason: 'VENTA', createdById, note: 'Venta facturada' });
    }
  } catch {
    /* el inventario no debe bloquear la facturación */
  }
}
