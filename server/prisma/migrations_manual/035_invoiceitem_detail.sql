-- Detalle por línea de factura: qué incluye el combo/paquete/servicio (sesiones y
-- técnicas) al momento de facturar. Snapshot: no cambia aunque luego se edite el combo.
-- Correr en Supabase (proyecto suedjotznakkkgwftmnd) ANTES de desplegar el código.

ALTER TABLE "InvoiceItem" ADD COLUMN IF NOT EXISTS "detail" TEXT;
