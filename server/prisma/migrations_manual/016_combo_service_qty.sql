-- Cantidad incluida de cada técnica dentro de un combo/paquete
-- (ej. 18 cavitaciones, 18 vacumterapias, 3 lipoláser, 2 gimnasias pasivas).
-- Se define al crear el combo. Correr en Supabase ANTES de desplegar el código.
ALTER TABLE "ComboService" ADD COLUMN IF NOT EXISTS "qty" INTEGER NOT NULL DEFAULT 1;
