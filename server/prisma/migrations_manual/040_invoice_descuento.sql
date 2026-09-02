-- 040 — Descuento en el cobro (aplicado por recepción/admin, tope 20%).
-- discount        → monto del descuento en RD$ (0 = sin descuento).
-- discountReason  → motivo opcional (promo, cliente frecuente…), para auditoría/reportes.
-- El descuento también queda como una línea negativa del recibo (InvoiceItem), así que
-- estas columnas son para reporte/análisis. Seguro de re-ejecutar; no altera datos.

ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "discount"       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "discountReason" TEXT;
