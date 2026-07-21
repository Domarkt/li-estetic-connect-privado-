-- Técnicas/servicios que incluye un combo o paquete (vacumterapia, cavitación,
-- masajes reductores, radiofrecuencia, lipoláser, sculpt, gimnasia pasiva...).
-- La esteticista marca en cada sesión cuáles le aplicó al paciente.
-- Correr en Supabase (proyecto suedjotznakkkgwftmnd) ANTES de desplegar el código.

CREATE TABLE IF NOT EXISTS "ComboService" (
  "id"        TEXT PRIMARY KEY,
  "comboId"   TEXT NOT NULL REFERENCES "CatalogItem"("id") ON DELETE CASCADE,
  "serviceId" TEXT NOT NULL REFERENCES "CatalogItem"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ComboService_comboId_serviceId_key" ON "ComboService" ("comboId", "serviceId");
CREATE INDEX IF NOT EXISTS "ComboService_comboId_idx" ON "ComboService" ("comboId");

-- Checklist de lo aplicado en la sesión.
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "techniques" TEXT[] NOT NULL DEFAULT '{}';
