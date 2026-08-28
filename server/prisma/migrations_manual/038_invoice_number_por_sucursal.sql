-- El No. de recibo (F-2219) era único GLOBAL, pero cada sucursal lleva su propia
-- secuencia. Las sucursales atrasadas (ej. Estética 3) generaban un número que otra
-- sucursal ya había usado y el cobro fallaba. Se cambia a único POR SUCURSAL.
-- Correr en Supabase (proyecto suedjotznakkkgwftmnd) ANTES de desplegar el código.

-- Quita la unicidad global del número (puede ser constraint o índice, según cómo se creó).
ALTER TABLE "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_number_key";
DROP INDEX IF EXISTS "Invoice_number_key";

-- Único por (sucursal, número): cada estética tiene su propia secuencia F-xxxx.
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_branchId_number_key" ON "Invoice"("branchId", "number");
