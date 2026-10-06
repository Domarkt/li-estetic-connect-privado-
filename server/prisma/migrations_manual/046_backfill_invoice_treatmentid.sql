-- 046 · Backfill seguro de Invoice.treatmentId para cobros de planes históricos.
-- NO ejecutar automáticamente. Correr en Supabase SQL Editor, después de revisar
-- primero la consulta de diagnóstico incluida abajo.
-- No modifica facturas ya enlazadas, anuladas, no pagadas ni sin paciente.

BEGIN;

-- Diagnóstico y candidatos: una factura puede tener varias líneas, por eso se
-- deduplican invoice/treatment antes de clasificarla.
CREATE TEMP TABLE invoice_treatment_backfill_candidates ON COMMIT DROP AS
WITH candidates AS (
  SELECT DISTINCT
    i."id" AS invoice_id,
    i."number" AS invoice_number,
    i."branchId" AS invoice_branch_id,
    i."patientId" AS patient_id,
    i."issuedAt" AS issued_at,
    t."id" AS treatment_id,
    t."name" AS treatment_name,
    t."catalogItemId" AS treatment_catalog_item_id
  FROM "Invoice" i
  JOIN "InvoiceItem" ii ON ii."invoiceId" = i."id"
  JOIN "Treatment" t
    ON t."patientId" = i."patientId"
   AND t."active" = TRUE
  LEFT JOIN "CatalogItem" tc ON tc."id" = t."catalogItemId"
  WHERE i."treatmentId" IS NULL
    AND i."status" = 'PAGADA'
    AND i."patientId" IS NOT NULL
    AND ii."total" > 0
    AND (
      lower(regexp_replace(trim(ii."name"), '\s+', ' ', 'g')) =
        lower(regexp_replace(trim(t."name"), '\s+', ' ', 'g'))
      OR (
        tc."id" IS NOT NULL
        AND lower(regexp_replace(trim(ii."name"), '\s+', ' ', 'g')) =
          lower(regexp_replace(trim(tc."name"), '\s+', ' ', 'g'))
        AND lower(regexp_replace(trim(t."name"), '\s+', ' ', 'g')) =
          lower(regexp_replace(trim(tc."name"), '\s+', ' ', 'g'))
      )
      OR lower(regexp_replace(trim(i."concept"), '\s+', ' ', 'g')) =
          lower(regexp_replace(trim(t."name"), '\s+', ' ', 'g'))
    )
)
SELECT
  c.*,
  count(*) OVER (PARTITION BY c.invoice_id) AS candidate_count
FROM candidates c;

-- ── Diagnóstico (solo lectura; revisar estos resultados antes del UPDATE) ──
-- CLARA: exactamente un treatment_id candidato.
-- AMBIGUA: dos o más tratamientos activos candidatos; no se toca.
SELECT
  CASE WHEN candidate_count = 1 THEN 'CLARA' ELSE 'AMBIGUA' END AS classification,
  invoice_id, invoice_number, invoice_branch_id, patient_id, issued_at,
  treatment_id, treatment_name, candidate_count
FROM invoice_treatment_backfill_candidates
ORDER BY classification DESC, issued_at, invoice_number, treatment_name;

-- Actualiza únicamente facturas CLARAS. La condición treatmentId IS NULL hace
-- que sea seguro repetir el script sin modificar una factura ya corregida.
WITH clear_matches AS (
  SELECT invoice_id, max(treatment_id) AS treatment_id
  FROM invoice_treatment_backfill_candidates
  WHERE candidate_count = 1
  GROUP BY invoice_id
), updated AS (
  UPDATE "Invoice" i
  SET "treatmentId" = m.treatment_id
  FROM clear_matches m
  WHERE i."id" = m.invoice_id
    AND i."treatmentId" IS NULL
    AND i."status" = 'PAGADA'
    AND i."patientId" IS NOT NULL
  RETURNING i."id", i."number", i."branchId", i."patientId", i."treatmentId"
)
INSERT INTO "AuditLog" (
  "id", "at", "userId", "userName", "role", "branchId", "action", "entity", "entityId", "summary", "ip"
)
SELECT
  md5(random()::text || clock_timestamp()::text || u."id"),
  CURRENT_TIMESTAMP,
  NULL, 'Migración manual 046', 'SYSTEM', u."branchId",
  'INVOICE_PLAN_RESTORE', 'Invoice', u."id",
  'Backfill 046: factura ' || u."number" || ' enlazada al tratamiento ' || u."treatmentId",
  NULL
FROM updated u;

COMMIT;

-- Para volver a revisar después de ejecutar: el mismo diagnóstico mostrará solo
-- las facturas que sigan huérfanas; las corregidas ya tendrán treatmentId.
