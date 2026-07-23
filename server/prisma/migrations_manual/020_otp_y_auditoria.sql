-- 020 · Código de un solo uso (OTP) para el portal del paciente + registro de auditoría.
-- Correr en Supabase (proyecto suedjotznakkkgwftmnd) ANTES de desplegar el código.

-- ── 1. OTP del portal del paciente ──────────────────────────────────────────
-- El acceso pasa de "correo + teléfono" (datos que un tercero puede conocer)
-- a un código de 6 dígitos que vence en 10 minutos y se usa una sola vez.
ALTER TABLE "PatientAccount" ADD COLUMN IF NOT EXISTS "otpHash"      TEXT;
ALTER TABLE "PatientAccount" ADD COLUMN IF NOT EXISTS "otpExpiresAt" TIMESTAMP(3);
ALTER TABLE "PatientAccount" ADD COLUMN IF NOT EXISTS "otpAttempts"  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PatientAccount" ADD COLUMN IF NOT EXISTS "otpSentAt"    TIMESTAMP(3);

-- ── 2. Registro de auditoría ────────────────────────────────────────────────
-- Quién leyó una ficha clínica, quién cobró o anuló, quién cambió un precio.
CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id"       TEXT NOT NULL,
  "at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId"   TEXT,
  "userName" TEXT,
  "role"     TEXT,
  "branchId" TEXT,
  "action"   TEXT NOT NULL,
  "entity"   TEXT NOT NULL,
  "entityId" TEXT,
  "summary"  TEXT,
  "ip"       TEXT,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AuditLog_at_idx"              ON "AuditLog" ("at");
CREATE INDEX IF NOT EXISTS "AuditLog_action_idx"          ON "AuditLog" ("action");
CREATE INDEX IF NOT EXISTS "AuditLog_entity_entityId_idx" ON "AuditLog" ("entity", "entityId");
CREATE INDEX IF NOT EXISTS "AuditLog_userId_idx"          ON "AuditLog" ("userId");
