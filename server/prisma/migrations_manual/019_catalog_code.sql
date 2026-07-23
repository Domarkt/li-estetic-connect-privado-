-- Código/SKU para los ítems del catálogo (servicios, combos, paquetes, productos, insumos).
-- Correr en Supabase (proyecto suedjotznakkkgwftmnd) ANTES de desplegar el código.
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "code" TEXT;
-- Curaduría del portal: qué combos/paquetes ve el paciente (por defecto, visibles).
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "showInPortal" BOOLEAN NOT NULL DEFAULT true;
