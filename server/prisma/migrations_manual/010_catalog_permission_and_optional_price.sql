-- 1) Permiso por usuario para gestionar el catálogo sin ser administrador
--    (p. ej. la recepcionista de Estética 2 que ayuda a crear servicios y combos).
-- 2) Precio opcional en el catálogo: 0 = "sin precio", se define al cobrar.
-- Correr en Supabase (proyecto suedjotznakkkgwftmnd) ANTES de desplegar el código.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "canManageCatalog" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CatalogItem" ALTER COLUMN "price" SET DEFAULT 0;
