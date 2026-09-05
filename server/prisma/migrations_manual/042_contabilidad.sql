-- 042_contabilidad.sql — Módulo de Contabilidad
-- Ejecutar en Supabase → SQL Editor ANTES de desplegar el backend.
-- Idempotente: se puede correr más de una vez sin romper nada.

-- 1) Columnas nuevas en Purchase para el 606 DGII (RNC del proveedor + ITBIS del gasto)
ALTER TABLE "Purchase" ADD COLUMN IF NOT EXISTS "supplierRnc" text;
ALTER TABLE "Purchase" ADD COLUMN IF NOT EXISTS "itbis" integer NOT NULL DEFAULT 0;

-- 2) Plan de cuentas (categorías administrables)
CREATE TABLE IF NOT EXISTS "LedgerCategory" (
  "id"        text PRIMARY KEY,
  "kind"      text NOT NULL,              -- INGRESO | EGRESO | RETIRO | APORTE | TRASLADO
  "name"      text NOT NULL,
  "code"      text,
  "active"    boolean NOT NULL DEFAULT true,
  "sortOrder" integer NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "LedgerCategory_kind_name_key" ON "LedgerCategory"("kind","name");

-- 3) Movimientos manuales / ajustes (lo que Invoice/Purchase no capturan)
CREATE TABLE IF NOT EXISTS "LedgerEntry" (
  "id"           text PRIMARY KEY,
  "date"         timestamptz NOT NULL,
  "type"         text NOT NULL,           -- INGRESO | EGRESO | RETIRO | APORTE | TRASLADO
  "categoryId"   text,
  "categoryName" text NOT NULL DEFAULT '',
  "amount"       integer NOT NULL,
  "method"       text NOT NULL DEFAULT 'EFECTIVO',
  "branchId"     text NOT NULL,
  "ncf"          text,
  "supplierRnc"  text,
  "concept"      text NOT NULL DEFAULT '',
  "notes"        text,
  "createdById"  text,
  "createdAt"    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "LedgerEntry_categoryId_fkey" FOREIGN KEY ("categoryId")
    REFERENCES "LedgerCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "LedgerEntry_branchId_date_idx" ON "LedgerEntry"("branchId","date");
CREATE INDEX IF NOT EXISTS "LedgerEntry_categoryId_idx" ON "LedgerEntry"("categoryId");

-- 4) Cierre contable de período (congela el mes cerrado)
CREATE TABLE IF NOT EXISTS "AccountingPeriod" (
  "id"            text PRIMARY KEY,
  "period"        text NOT NULL,          -- YYYY-MM
  "branchId"      text,                   -- null = consolidado (todas)
  "status"        text NOT NULL DEFAULT 'CERRADO',
  "totalIngresos" integer NOT NULL DEFAULT 0,
  "totalEgresos"  integer NOT NULL DEFAULT 0,
  "utilidad"      integer NOT NULL DEFAULT 0,
  "closedById"    text,
  "closedAt"      timestamptz NOT NULL DEFAULT now(),
  "note"          text
);
-- Unicidad de (período, sucursal) tratando null como 'ALL' (un solo cierre por mes/alcance)
CREATE UNIQUE INDEX IF NOT EXISTS "AccountingPeriod_period_branch_key"
  ON "AccountingPeriod"("period", COALESCE("branchId",'ALL'));

-- 5) Semillas del plan de cuentas (idempotente por (kind,name))
INSERT INTO "LedgerCategory" ("id","kind","name","sortOrder") VALUES
  (gen_random_uuid()::text,'INGRESO','Otros ingresos',10),
  (gen_random_uuid()::text,'INGRESO','Ingreso financiero (intereses)',20),
  (gen_random_uuid()::text,'EGRESO','Nómina / Salarios',10),
  (gen_random_uuid()::text,'EGRESO','Alquiler',20),
  (gen_random_uuid()::text,'EGRESO','Servicios (luz, agua, internet)',30),
  (gen_random_uuid()::text,'EGRESO','Comisiones a esteticistas',40),
  (gen_random_uuid()::text,'EGRESO','Publicidad y marketing',50),
  (gen_random_uuid()::text,'EGRESO','Mantenimiento y reparaciones',60),
  (gen_random_uuid()::text,'EGRESO','Impuestos y tasas (DGII/Ayuntamiento)',70),
  (gen_random_uuid()::text,'EGRESO','Comisión bancaria / POS',80),
  (gen_random_uuid()::text,'EGRESO','Suministros de oficina',90),
  (gen_random_uuid()::text,'EGRESO','Transporte y mensajería',100),
  (gen_random_uuid()::text,'EGRESO','Gastos varios',110),
  (gen_random_uuid()::text,'RETIRO','Retiro de socia',10),
  (gen_random_uuid()::text,'APORTE','Aporte de socia',10),
  (gen_random_uuid()::text,'TRASLADO','Depósito bancario',10)
ON CONFLICT ("kind","name") DO NOTHING;
