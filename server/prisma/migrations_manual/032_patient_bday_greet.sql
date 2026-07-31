-- Guarda el año del último saludo de cumpleaños enviado (para no repetirlo).
-- Correr en Supabase (proyecto suedjotznakkkgwftmnd) ANTES de desplegar el código.

ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "lastBdayGreetYear" INTEGER;
