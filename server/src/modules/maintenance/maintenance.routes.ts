import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireStaff, requireRole } from '../../middleware/auth.js';

export const maintenanceRouter = Router();

// Categorías de limpieza. Las listas de tablas son constantes fijas (no entran del usuario),
// así que es seguro usarlas con TRUNCATE. CASCADE resuelve las llaves foráneas hijas.
type TargetKey = 'patients' | 'appointments' | 'billing' | 'messages' | 'seguimiento' | 'cashclose' | 'assets' | 'inventory';

const TARGETS: Record<TargetKey, {
  label: string;
  count: () => Promise<number>;
  run: () => Promise<void>;
}> = {
  patients: {
    label: 'Pacientes e historial (fichas, citas, tratamientos, cobros, portal)',
    count: () => prisma.patient.count(),
    run: async () => {
      await prisma.$executeRawUnsafe('TRUNCATE TABLE "Patient" RESTART IDENTITY CASCADE');
      // Los contadores de desempeño derivan de ventas/puntos: se reinician.
      await prisma.$executeRawUnsafe('UPDATE "TherapistProfile" SET "points" = 0, "monthSales" = 0');
    },
  },
  appointments: {
    label: 'Citas (solo la agenda; conserva pacientes)',
    count: () => prisma.appointment.count(),
    run: async () => { await prisma.$executeRawUnsafe('TRUNCATE TABLE "Appointment" RESTART IDENTITY CASCADE'); },
  },
  billing: {
    label: 'Cobros y facturas (recibos, cargos, secuencia NCF; conserva pacientes)',
    count: () => prisma.invoice.count(),
    run: async () => { await prisma.$executeRawUnsafe('TRUNCATE TABLE "Invoice", "InvoiceItem", "ChargeItem", "InvoiceSequence" RESTART IDENTITY CASCADE'); },
  },
  messages: {
    label: 'Mensajes (chat de equipo, conversaciones y notificaciones)',
    count: () => prisma.teamMessage.count(),
    run: async () => { await prisma.$executeRawUnsafe('TRUNCATE TABLE "TeamMessage", "TeamThreadRead", "Conversation", "Message", "Notification" RESTART IDENTITY CASCADE'); },
  },
  seguimiento: {
    label: 'Seguimiento (tarjetas del tablero de leads)',
    count: () => prisma.lead.count(),
    run: async () => { await prisma.$executeRawUnsafe('TRUNCATE TABLE "Lead" RESTART IDENTITY CASCADE'); },
  },
  cashclose: {
    label: 'Cuadres de caja (cierres y deducciones)',
    count: () => prisma.cashClose.count(),
    run: async () => { await prisma.$executeRawUnsafe('TRUNCATE TABLE "CashClose", "StaffDeduction" RESTART IDENTITY CASCADE'); },
  },
  assets: {
    label: 'Equipos (activos e historial de mantenimiento/incidencias)',
    count: () => prisma.asset.count(),
    run: async () => { await prisma.$executeRawUnsafe('TRUNCATE TABLE "Asset", "AssetEvent" RESTART IDENTITY CASCADE'); },
  },
  inventory: {
    label: 'Inventario (stock, movimientos y catálogo de productos e insumos)',
    count: () => prisma.stockMovement.count(),
    run: async () => {
      await prisma.$executeRawUnsafe('TRUNCATE TABLE "StockLevel", "StockMovement" RESTART IDENTITY CASCADE');
      await prisma.$executeRawUnsafe(`DELETE FROM "CatalogItem" WHERE "kind" IN ('PRODUCTO', 'INSUMO')`);
    },
  },
};

/** Resumen: cuántos registros hay por categoría (para mostrar antes de borrar). */
maintenanceRouter.get('/summary', requireStaff, requireRole('ADMIN'), async (_req, res) => {
  const entries = await Promise.all(
    (Object.keys(TARGETS) as TargetKey[]).map(async (key) => [key, { label: TARGETS[key].label, count: await TARGETS[key].count() }] as const),
  );
  res.json(Object.fromEntries(entries));
});

const purgeSchema = z.object({
  target: z.enum(['patients', 'appointments', 'billing', 'messages', 'seguimiento', 'cashclose', 'assets', 'inventory']),
  confirm: z.literal('BORRAR'),
});

/** Borrado por categoría (Admin). Exige confirmación exacta "BORRAR". Irreversible. */
maintenanceRouter.post('/purge', requireStaff, requireRole('ADMIN'), async (req, res) => {
  const { target } = purgeSchema.parse(req.body);
  const t = TARGETS[target];
  const before = await t.count();
  await t.run();
  // Traza en el log del servidor (visible en Render) de quién borró qué.
  console.warn(`[MANTENIMIENTO] ${req.staff!.name} (${req.staff!.sub}) borró "${target}" · ~${before} registros base`);
  res.json({ ok: true, target, deleted: before, message: `Se eliminó: ${t.label} (~${before} registros).` });
});
