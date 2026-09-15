-- Ejecutar en Supabase ANTES del deploy en Render.
-- Relaciona el cargo pendiente con la cita que lo originó.
ALTER TABLE "ChargeItem"
  ADD COLUMN IF NOT EXISTS "appointmentId" TEXT;

CREATE INDEX IF NOT EXISTS "ChargeItem_appointmentId_status_idx"
  ON "ChargeItem" ("appointmentId", "status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ChargeItem_appointmentId_fkey'
  ) THEN
    ALTER TABLE "ChargeItem"
      ADD CONSTRAINT "ChargeItem_appointmentId_fkey"
      FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Recuperación prudente de cargos históricos: solo vincula cargos pendientes
-- creados inmediatamente después de una cita del mismo paciente/sucursal y cuyo
-- nombre forma parte del servicio agendado.
WITH matches AS (
  SELECT
    charge."id" AS "chargeId",
    (
      SELECT appointment."id"
      FROM "Appointment" appointment
      WHERE appointment."patientId" = charge."patientId"
        AND appointment."branchId" = charge."branchId"
        AND charge."createdAt" >= appointment."createdAt"
        AND charge."createdAt" <= appointment."createdAt" + INTERVAL '5 minutes'
        AND POSITION(LOWER(charge."name") IN LOWER(appointment."serviceName")) > 0
      ORDER BY ABS(EXTRACT(EPOCH FROM (charge."createdAt" - appointment."createdAt")))
      LIMIT 1
    ) AS "appointmentId"
  FROM "ChargeItem" charge
  WHERE charge."appointmentId" IS NULL
    AND charge."status" = 'PENDIENTE_FACTURAR'
)
UPDATE "ChargeItem" charge
SET "appointmentId" = matches."appointmentId"
FROM matches
WHERE charge."id" = matches."chargeId"
  AND matches."appointmentId" IS NOT NULL;

-- Las citas ya canceladas dejan de aparecer inmediatamente en cuentas por cobrar.
UPDATE "ChargeItem" charge
SET "status" = 'ANULADO'
FROM "Appointment" appointment
WHERE charge."appointmentId" = appointment."id"
  AND charge."status" = 'PENDIENTE_FACTURAR'
  AND appointment."status" = 'CANCELADA';
