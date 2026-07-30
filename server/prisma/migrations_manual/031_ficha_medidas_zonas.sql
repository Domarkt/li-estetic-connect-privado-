-- Medidas corporales por zona (abdomen alto/bajo, pierna alta/baja, brazo alto/bajo, glúteos).
-- Las columnas viejas (cinturaCm, abdomenCm, piernaCm, brazoCm) se conservan por referencia.
-- Correr en Supabase (proyecto suedjotznakkkgwftmnd) ANTES de desplegar el código.

ALTER TABLE "ClinicalRecord" ADD COLUMN IF NOT EXISTS "abdomenAltoCm" INTEGER;
ALTER TABLE "ClinicalRecord" ADD COLUMN IF NOT EXISTS "abdomenBajoCm" INTEGER;
ALTER TABLE "ClinicalRecord" ADD COLUMN IF NOT EXISTS "piernaAltaCm"  INTEGER;
ALTER TABLE "ClinicalRecord" ADD COLUMN IF NOT EXISTS "piernaBajaCm"  INTEGER;
ALTER TABLE "ClinicalRecord" ADD COLUMN IF NOT EXISTS "brazoAltoCm"   INTEGER;
ALTER TABLE "ClinicalRecord" ADD COLUMN IF NOT EXISTS "brazoBajoCm"   INTEGER;
ALTER TABLE "ClinicalRecord" ADD COLUMN IF NOT EXISTS "gluteosCm"     INTEGER;
