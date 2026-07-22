-- Áreas que trae un combo/paquete por defecto: se eligen al crearlo en el catálogo
-- y se cargan automáticamente al venderlo a un paciente.
-- Correr en Supabase (proyecto suedjotznakkkgwftmnd) ANTES de desplegar el código.
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "defaultAreas" TEXT[] NOT NULL DEFAULT '{}';
