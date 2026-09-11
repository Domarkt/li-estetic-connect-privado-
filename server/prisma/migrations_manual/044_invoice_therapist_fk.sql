-- 044_invoice_therapist_fk.sql — relación Invoice.therapistId → User.id
-- La columna "therapistId" ya existía (esteticista atribuida a la venta); aquí solo
-- se agrega la llave foránea para que la base concuerde con el esquema Prisma.
-- Idempotente. Ejecutar en Supabase → SQL Editor.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Invoice_therapistId_fkey'
  ) THEN
    ALTER TABLE "Invoice"
      ADD CONSTRAINT "Invoice_therapistId_fkey"
      FOREIGN KEY ("therapistId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
