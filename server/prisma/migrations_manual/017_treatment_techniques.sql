-- Conteo por técnica del combo del paciente (18 cavitaciones, 3 lipoláser…).
-- Se siembra al vender el combo y baja al aplicar la técnica en cada sesión.
-- Correr en Supabase (proyecto suedjotznakkkgwftmnd) ANTES de desplegar el código.
CREATE TABLE IF NOT EXISTS "TreatmentTechnique" (
  "id"          TEXT PRIMARY KEY,
  "treatmentId" TEXT NOT NULL REFERENCES "Treatment"("id") ON DELETE CASCADE,
  "name"        TEXT NOT NULL,
  "total"       INTEGER NOT NULL,
  "done"        INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS "TreatmentTechnique_treatmentId_name_key" ON "TreatmentTechnique" ("treatmentId", "name");
CREATE INDEX IF NOT EXISTS "TreatmentTechnique_treatmentId_idx" ON "TreatmentTechnique" ("treatmentId");
