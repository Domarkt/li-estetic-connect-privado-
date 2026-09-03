-- 041 — Modo de sesión por combo: PER_AREA (como hoy) | FULL_BODY (cuerpo completo,
-- se puede partir en varias visitas y cuenta como 1 sesión).
--   CatalogItem.sessionMode   → modo del combo (se elige al crear/editar).
--   Treatment.sessionMode     → modo heredado por el plan del paciente al venderlo.
--   TreatmentSession.completa → false = sesión EN CURSO (aún se pueden trabajar más áreas
--                               otro día, no descuenta); true = sesión cerrada.
-- Todo por defecto queda como hoy (PER_AREA / completa=true). Seguro de re-ejecutar.

ALTER TABLE "CatalogItem"      ADD COLUMN IF NOT EXISTS "sessionMode" TEXT    NOT NULL DEFAULT 'PER_AREA';
ALTER TABLE "Treatment"        ADD COLUMN IF NOT EXISTS "sessionMode" TEXT    NOT NULL DEFAULT 'PER_AREA';
ALTER TABLE "TreatmentSession" ADD COLUMN IF NOT EXISTS "completa"    BOOLEAN NOT NULL DEFAULT true;
