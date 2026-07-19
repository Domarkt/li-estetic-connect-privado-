-- ─────────────────────────────────────────────────────────────
-- Chat interno del equipo (por sucursal) — correr en Supabase
-- Proyecto correcto: suedjotznakkkgwftmnd
-- Sin enums; se puede pegar y ejecutar todo de una vez.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "TeamMessage" (
  "id"          TEXT PRIMARY KEY,
  "branchId"    TEXT NOT NULL,
  "senderId"    TEXT NOT NULL,
  "senderName"  TEXT NOT NULL,
  "senderRole"  TEXT NOT NULL,
  "body"        TEXT NOT NULL,
  "patientId"   TEXT,
  "patientName" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "TeamMessage_branch_date_idx" ON "TeamMessage" ("branchId", "createdAt");

CREATE TABLE IF NOT EXISTS "TeamThreadRead" (
  "id"         TEXT PRIMARY KEY,
  "userId"     TEXT NOT NULL,
  "branchId"   TEXT NOT NULL,
  "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "TeamThreadRead_user_branch_key" ON "TeamThreadRead" ("userId", "branchId");
