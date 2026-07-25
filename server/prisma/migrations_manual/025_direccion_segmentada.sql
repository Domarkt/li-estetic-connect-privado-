-- 025 · Dirección segmentada: sector y provincia (para saber de dónde visitan).
ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "sector" TEXT;
ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "province" TEXT;
