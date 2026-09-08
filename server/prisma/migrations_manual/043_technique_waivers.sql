-- 043_technique_waivers.sql — Avisos / renuncias de técnica del combo
-- Ejecutar en Supabase → SQL Editor ANTES de desplegar. Idempotente.

CREATE TABLE IF NOT EXISTS "TechniqueWaiver" (
  "id"             text PRIMARY KEY,
  "treatmentId"    text NOT NULL,
  "patientId"      text NOT NULL,
  "branchId"       text NOT NULL,
  "techniqueName"  text NOT NULL,
  "kind"           text NOT NULL,               -- RENUNCIA_PACIENTE | REPORTE_ESTETICISTA
  "reason"         text NOT NULL,
  "signature"      text,                        -- firma del paciente (base64), obligatoria en RENUNCIA_PACIENTE
  "status"         text NOT NULL DEFAULT 'ACTIVA', -- ACTIVA | ANULADA
  "reportedById"   text,
  "reportedByName" text,
  "reportedRole"   text,
  "annulledById"   text,
  "annulReason"    text,
  "annulledAt"     timestamptz,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "TechniqueWaiver_treatmentId_fkey" FOREIGN KEY ("treatmentId")
    REFERENCES "Treatment"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "TechniqueWaiver_patientId_idx" ON "TechniqueWaiver"("patientId");
CREATE INDEX IF NOT EXISTS "TechniqueWaiver_treatmentId_idx" ON "TechniqueWaiver"("treatmentId");
