-- Ejecutar en Supabase SQL Editor ANTES de desplegar server/web.
-- Idempotente y no destructiva: añade el rol, la trazabilidad de anulación
-- y los módulos configurables del coordinador.

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'COORDINADOR';
ALTER TYPE "ChargeItemStatus" ADD VALUE IF NOT EXISTS 'ANULADO';

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "allowedModules" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
