-- Egresos del cierre de caja: salidas de efectivo (compras menores) con nota.
-- Correr en Supabase (proyecto suedjotznakkkgwftmnd) ANTES de desplegar el código.

ALTER TABLE "CashClose" ADD COLUMN IF NOT EXISTS "expenses" JSONB;
