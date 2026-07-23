-- 023 · ITBIS opcional por factura + factura de crédito fiscal (B01).
-- Correr en Supabase (proyecto suedjotznakkkgwftmnd) ANTES de desplegar el código.
--
-- Contexto: no todos los servicios estéticos llevan ITBIS, así que dejar de
-- asumir el 18% siempre. Y para clientes que lo piden hay que emitir Crédito
-- Fiscal (B01), que exige el RNC/cédula del comprador y lleva su propia
-- secuencia de NCF, separada de la de consumo final (B02).

-- ── Factura ─────────────────────────────────────────────────────────────────
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "ncfType"      TEXT NOT NULL DEFAULT 'B02';
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "clientRnc"    TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "clientName"   TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "itbisApplied" BOOLEAN NOT NULL DEFAULT true;

-- ── Secuencia de NCF por tipo ───────────────────────────────────────────────
-- La secuencia B01 arranca en 0 y corre aparte de la de consumo final.
ALTER TABLE "InvoiceSequence" ADD COLUMN IF NOT EXISTS "lastNcfB01" INTEGER NOT NULL DEFAULT 0;
