-- Vincular tarjetas de Seguimiento (Lead) a un paciente, para que la automatización
-- avance la MISMA tarjeta en vez de crear duplicados.
-- Correr en Supabase (proyecto suedjotznakkkgwftmnd) ANTES de desplegar el código.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "patientId" TEXT;
CREATE INDEX IF NOT EXISTS "Lead_patientId_idx" ON "Lead" ("patientId");
