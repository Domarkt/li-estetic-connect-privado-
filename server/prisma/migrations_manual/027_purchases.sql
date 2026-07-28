-- Compras del negocio: facturas de proveedores/insumos/equipos con imagen anexa.
-- Correr en Supabase (proyecto suedjotznakkkgwftmnd) ANTES de desplegar el código.

CREATE TABLE IF NOT EXISTS "Purchase" (
  "id"           TEXT PRIMARY KEY,
  "branchId"     TEXT NOT NULL,
  "supplier"     TEXT NOT NULL,
  "concept"      TEXT NOT NULL,
  "category"     TEXT,
  "amount"       INTEGER NOT NULL,
  "ncf"          TEXT,
  "purchasedAt"  TIMESTAMP(3) NOT NULL,
  "invoiceImage" TEXT,
  "notes"        TEXT,
  "createdById"  TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "Purchase_branchId_purchasedAt_idx" ON "Purchase" ("branchId", "purchasedAt");
