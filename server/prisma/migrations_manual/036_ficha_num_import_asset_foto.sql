-- Puntos 1, 6 y 9:
--  · fichaNumber: número de la ficha FÍSICA (papel) en el expediente (numeración manual).
--  · fromImport: marca a los pacientes cargados desde la base anterior (no son "nuevos").
--  · Asset.imageUrl: foto del equipo en el inventario.
-- Correr en Supabase (proyecto suedjotznakkkgwftmnd) ANTES de desplegar el código.

ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "fichaNumber" TEXT;
ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "fromImport" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Asset"   ADD COLUMN IF NOT EXISTS "imageUrl"   TEXT;

-- Los pacientes que ya tienen algún paquete/tratamiento NO deben aparecer como "nuevos".
UPDATE "Patient" p
SET "type" = 'RECURRENTE'
WHERE p."type" = 'NUEVO'
  AND EXISTS (SELECT 1 FROM "Treatment" t WHERE t."patientId" = p."id");
