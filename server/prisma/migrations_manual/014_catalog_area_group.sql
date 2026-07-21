-- Tipo de áreas de un combo/paquete (CORPORAL | LASER), para que el selector de áreas
-- muestre solo el grupo correcto al definir las áreas del paciente.
-- Correr en Supabase (proyecto suedjotznakkkgwftmnd) ANTES de desplegar el código.
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "areaGroup" TEXT;
