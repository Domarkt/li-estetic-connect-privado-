-- 021 · Registro de lo que se le APLICÓ al paciente en cada visita, firmado por él.
-- Correr en Supabase (proyecto suedjotznakkkgwftmnd) ANTES de desplegar el código.
--
-- Hasta ahora el combo mostraba el contador (0/5) pero no había forma de registrar
-- CUÁL de las técnicas se aplicó ese día ni de que el paciente lo validara.

CREATE TABLE IF NOT EXISTS "TreatmentSession" (
  "id"          TEXT NOT NULL,
  "treatmentId" TEXT NOT NULL,
  "patientId"   TEXT NOT NULL,
  "therapistId" TEXT,
  "at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "techniques"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "areas"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notes"       TEXT,
  "signature"   TEXT,
  CONSTRAINT "TreatmentSession_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TreatmentSession"
  DROP CONSTRAINT IF EXISTS "TreatmentSession_treatmentId_fkey";
ALTER TABLE "TreatmentSession"
  ADD CONSTRAINT "TreatmentSession_treatmentId_fkey"
  FOREIGN KEY ("treatmentId") REFERENCES "Treatment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "TreatmentSession_treatmentId_idx" ON "TreatmentSession" ("treatmentId");
CREATE INDEX IF NOT EXISTS "TreatmentSession_patientId_idx"   ON "TreatmentSession" ("patientId");
CREATE INDEX IF NOT EXISTS "TreatmentSession_at_idx"          ON "TreatmentSession" ("at");
