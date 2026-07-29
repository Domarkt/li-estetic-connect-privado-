-- Fecha de vencimiento para ofertas/paquetes/combos (opcional).
-- Correr en Supabase (proyecto suedjotznakkkgwftmnd) ANTES de desplegar el código.

ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "validUntil" TIMESTAMP(3);
