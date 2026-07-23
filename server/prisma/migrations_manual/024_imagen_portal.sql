-- 024 · Imagen del combo/paquete para el portal del paciente.
-- Correr en Supabase (proyecto suedjotznakkkgwftmnd) ANTES de desplegar el código.
--
-- Solo se usa en lo que ve el paciente (ofertas y paquetes del portal): guardar
-- una foto por cada insumo no aporta nada y engordaría la base sin necesidad.
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;
