-- ─────────────────────────────────────────────────────────────
-- Equipos y suministros (activos durables) + historial — correr en Supabase
-- Proyecto correcto: suedjotznakkkgwftmnd
-- No usa enums nuevos; se puede pegar y ejecutar todo de una vez.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "Asset" (
  "id"           TEXT PRIMARY KEY,
  "code"         TEXT NOT NULL,
  "kind"         TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "category"     TEXT,
  "branchId"     TEXT NOT NULL,
  "assignedToId" TEXT,
  "status"       TEXT NOT NULL DEFAULT 'OPERATIVO',
  "serial"       TEXT,
  "notes"        TEXT,
  "active"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Asset_branch_fkey"   FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE,
  CONSTRAINT "Asset_assignee_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "Asset_code_key"     ON "Asset" ("code");
CREATE INDEX IF NOT EXISTS "Asset_branch_kind_idx"     ON "Asset" ("branchId", "kind");
CREATE INDEX IF NOT EXISTS "Asset_assignedTo_idx"      ON "Asset" ("assignedToId");

CREATE TABLE IF NOT EXISTS "AssetEvent" (
  "id"           TEXT PRIMARY KEY,
  "assetId"      TEXT NOT NULL,
  "type"         TEXT NOT NULL,
  "note"         TEXT,
  "cost"         INTEGER,
  "reportedById" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssetEvent_asset_fkey"    FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE,
  CONSTRAINT "AssetEvent_reporter_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "AssetEvent_asset_date_idx" ON "AssetEvent" ("assetId", "createdAt");
