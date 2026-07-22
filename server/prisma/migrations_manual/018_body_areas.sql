-- Catálogo administrable de áreas del cuerpo (corporal + láser), con muslo y glúteos.
-- La administración podrá agregar más desde Configuración.
-- Correr en Supabase (proyecto suedjotznakkkgwftmnd) ANTES de desplegar el código.

CREATE TABLE IF NOT EXISTS "BodyArea" (
  "id"        TEXT PRIMARY KEY,
  "key"       TEXT NOT NULL UNIQUE,
  "label"     TEXT NOT NULL,
  "grupo"     TEXT NOT NULL,
  "active"    BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Semilla (incluye las nuevas: Muslo y Glúteos). Idempotente.
INSERT INTO "BodyArea" ("id","key","label","grupo","sortOrder") VALUES
  (substr(md5(random()::text),1,25), 'ABDOMEN',         'Abdomen',         'CORPORAL', 1),
  (substr(md5(random()::text),1,25), 'ESPALDA',         'Espalda',         'CORPORAL', 2),
  (substr(md5(random()::text),1,25), 'ABDOMEN_LATERAL', 'Abdomen lateral', 'CORPORAL', 3),
  (substr(md5(random()::text),1,25), 'MUSLO',           'Muslo',           'CORPORAL', 4),
  (substr(md5(random()::text),1,25), 'GLUTEOS',         'Glúteos',         'CORPORAL', 5),
  (substr(md5(random()::text),1,25), 'PIERNAS',         'Piernas',         'LASER',    10),
  (substr(md5(random()::text),1,25), 'AXILAS',          'Axilas',          'LASER',    11),
  (substr(md5(random()::text),1,25), 'BRAZOS',          'Brazos',          'LASER',    12),
  (substr(md5(random()::text),1,25), 'CUERPO_COMPLETO', 'Cuerpo completo', 'LASER',    13),
  (substr(md5(random()::text),1,25), 'BOZO',            'Bozo',            'LASER',    14),
  (substr(md5(random()::text),1,25), 'CARA',            'Cara',            'LASER',    15),
  (substr(md5(random()::text),1,25), 'ENTREPIERNAS',    'Entrepiernas',    'LASER',    16),
  (substr(md5(random()::text),1,25), 'INTIMOS',         'Íntimos',         'LASER',    17)
ON CONFLICT ("key") DO NOTHING;
