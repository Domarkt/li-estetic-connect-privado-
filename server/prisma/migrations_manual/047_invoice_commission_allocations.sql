-- 047 — Reparto de comisión de venta entre varias esteticistas.
--
-- Se guarda el monto comisionable de cada participante, no el total cobrado de
-- la factura. Esto permite registrar, por ejemplo, una venta de RD$15,000 cuyo
-- diferencial comisionable de RD$5,000 se reparte entre dos esteticistas.
-- Idempotente. Ejecutar en la base de producción antes de activar el flujo.

CREATE TABLE IF NOT EXISTS "InvoiceCommissionAllocation" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "therapistId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceCommissionAllocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceCommissionAllocation_invoiceId_therapistId_key"
  ON "InvoiceCommissionAllocation" ("invoiceId", "therapistId");

CREATE INDEX IF NOT EXISTS "InvoiceCommissionAllocation_therapistId_createdAt_idx"
  ON "InvoiceCommissionAllocation" ("therapistId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'InvoiceCommissionAllocation_invoiceId_fkey'
  ) THEN
    ALTER TABLE "InvoiceCommissionAllocation"
      ADD CONSTRAINT "InvoiceCommissionAllocation_invoiceId_fkey"
      FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'InvoiceCommissionAllocation_therapistId_fkey'
  ) THEN
    ALTER TABLE "InvoiceCommissionAllocation"
      ADD CONSTRAINT "InvoiceCommissionAllocation_therapistId_fkey"
      FOREIGN KEY ("therapistId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
