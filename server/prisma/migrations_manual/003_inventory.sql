-- ─────────────────────────────────────────────────────────────
-- Inventario por sucursal (productos + insumos) — correr en Supabase
-- Proyecto correcto: suedjotznakkkgwftmnd
-- IMPORTANTE: ejecuta el PASO 1 SOLO primero (Run), y luego el resto.
-- ─────────────────────────────────────────────────────────────

-- PASO 1 — nuevo valor de enum (debe ir en su propia ejecución):
ALTER TYPE "CatalogKind" ADD VALUE IF NOT EXISTS 'INSUMO';

-- ── PASO 2 (ejecutar después del Paso 1) ─────────────────────────

-- Columna de unidad de medida para productos/insumos
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "unit" TEXT;

-- Existencia por sucursal
CREATE TABLE IF NOT EXISTS "StockLevel" (
  "id"            TEXT PRIMARY KEY,
  "branchId"      TEXT NOT NULL,
  "catalogItemId" TEXT NOT NULL,
  "qty"           INTEGER NOT NULL DEFAULT 0,
  "minQty"        INTEGER NOT NULL DEFAULT 0,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockLevel_branch_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE,
  CONSTRAINT "StockLevel_item_fkey"   FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "StockLevel_branch_item_key" ON "StockLevel" ("branchId", "catalogItemId");
CREATE INDEX IF NOT EXISTS "StockLevel_branch_idx" ON "StockLevel" ("branchId");

-- Traza de movimientos de inventario
CREATE TABLE IF NOT EXISTS "StockMovement" (
  "id"            TEXT PRIMARY KEY,
  "branchId"      TEXT NOT NULL,
  "catalogItemId" TEXT NOT NULL,
  "delta"         INTEGER NOT NULL,
  "reason"        TEXT NOT NULL,
  "note"          TEXT,
  "createdById"   TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockMovement_branch_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE,
  CONSTRAINT "StockMovement_item_fkey"   FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "StockMovement_branch_date_idx" ON "StockMovement" ("branchId", "createdAt");
