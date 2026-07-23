-- 022 · Mensajes y ofertas que la administración publica en el portal del paciente.
-- Correr en Supabase (proyecto suedjotznakkkgwftmnd) ANTES de desplegar el código.

CREATE TABLE IF NOT EXISTS "PortalMessage" (
  "id"          TEXT NOT NULL,
  "branchId"    TEXT,               -- null = todas las sucursales
  "kind"        TEXT NOT NULL DEFAULT 'AVISO',  -- OFERTA | AVISO | CONSEJO
  "title"       TEXT NOT NULL,
  "body"        TEXT NOT NULL,
  "ctaLabel"    TEXT,
  "ctaLink"     TEXT,
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "startsAt"    TIMESTAMP(3),
  "endsAt"      TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PortalMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PortalMessage_active_idx"   ON "PortalMessage" ("active");
CREATE INDEX IF NOT EXISTS "PortalMessage_branchId_idx" ON "PortalMessage" ("branchId");
