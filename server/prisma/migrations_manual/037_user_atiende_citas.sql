-- "Atiende citas": marca a un Admin/Coordinadora que también atiende procesos en cabina,
-- para que aparezca como asignable en la agenda (ej. la directora o la coordinadora).
-- Correr en Supabase (proyecto suedjotznakkkgwftmnd) ANTES de desplegar el código.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "atiendeCitas" BOOLEAN NOT NULL DEFAULT false;
