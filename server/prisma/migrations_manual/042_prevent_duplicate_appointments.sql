-- Ejecutar en Supabase ANTES del deploy en Render.
-- Conserva el historial: las copias activas se anulan, no se eliminan.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "branchId", "patientId", "startsAt", "serviceName"
      ORDER BY "createdAt", "id"
    ) AS duplicate_number
  FROM "Appointment"
  WHERE "status" IN ('SIN_CONFIRMAR', 'CONFIRMADA', 'REAGENDADA')
)
UPDATE "Appointment" AS appointment
SET
  "status" = 'CANCELADA',
  "cancelReason" = 'Cita duplicada anulada durante corrección del sistema',
  "cancelledBy" = 'STAFF',
  "cancelledAt" = NOW()
FROM ranked
WHERE appointment."id" = ranked."id"
  AND ranked.duplicate_number > 1;

-- Garantía definitiva aunque dos solicitudes lleguen exactamente al mismo tiempo.
CREATE UNIQUE INDEX IF NOT EXISTS "Appointment_one_active_exact_visit"
ON "Appointment" ("branchId", "patientId", "startsAt", "serviceName")
WHERE "status" IN ('SIN_CONFIRMAR', 'CONFIRMADA', 'REAGENDADA');
