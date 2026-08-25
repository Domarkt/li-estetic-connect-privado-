-- Ejecutar en Supabase ANTES de desplegar el backend en Render.
ALTER TABLE "Branch"
  ADD COLUMN IF NOT EXISTS "businessHours" JSONB;

-- Horario inicial solicitado: lunes-viernes 9:00-19:00, sábado 9:00-15:00,
-- domingo cerrado. La administradora podrá modificarlo luego por sucursal.
UPDATE "Branch"
SET "businessHours" = '{
  "weekdays": {"open":"09:00","close":"19:00","closed":false},
  "saturday": {"open":"09:00","close":"15:00","closed":false},
  "sunday": {"open":"09:00","close":"15:00","closed":true}
}'::jsonb
WHERE "businessHours" IS NULL;
