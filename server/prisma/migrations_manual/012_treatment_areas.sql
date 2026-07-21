-- Áreas del cuerpo dentro de un combo.
-- Un combo cubre 2 áreas y sus sesiones se reparten entre ellas (12 sesiones = 6 por área).
-- Una 3ra área es adicional (RD$1,500) y entra marcada como isExtra.
-- Correr en Supabase (proyecto suedjotznakkkgwftmnd) ANTES de desplegar el código.

CREATE TABLE IF NOT EXISTS "TreatmentArea" (
  "id"            TEXT PRIMARY KEY,
  "treatmentId"   TEXT NOT NULL REFERENCES "Treatment"("id") ON DELETE CASCADE,
  "area"          TEXT NOT NULL,
  "totalSessions" INTEGER NOT NULL,
  "doneSessions"  INTEGER NOT NULL DEFAULT 0,
  "isExtra"       BOOLEAN NOT NULL DEFAULT false,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "TreatmentArea_treatmentId_area_key" ON "TreatmentArea" ("treatmentId", "area");
CREATE INDEX IF NOT EXISTS "TreatmentArea_treatmentId_idx" ON "TreatmentArea" ("treatmentId");

-- Áreas trabajadas en cada cita (se consume 1 sesión por área).
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "areas" TEXT[] NOT NULL DEFAULT '{}';
