-- Áreas del cuerpo combinadas solicitadas por la administración (grupo CORPORAL).
-- Idempotente. Correr en Supabase (proyecto suedjotznakkkgwftmnd) ANTES de desplegar.
-- Nota: "Cuerpo completo" ya existe en grupo LASER (migración 018); aquí se agrega
-- una versión CORPORAL con clave propia para que aparezca en combos reductores.

INSERT INTO "BodyArea" ("id","key","label","grupo","sortOrder") VALUES
  (substr(md5(random()::text),1,25), 'ABDOMEN_Y_LATERAL',        'Abdomen y Lateral', 'CORPORAL', 11),
  (substr(md5(random()::text),1,25), 'ESPALDA_Y_LATERAL',        'Espalda y Lateral', 'CORPORAL', 12),
  (substr(md5(random()::text),1,25), 'CUERPO_COMPLETO_CORPORAL', 'Cuerpo completo',   'CORPORAL', 13),
  (substr(md5(random()::text),1,25), 'MUSLO_Y_GLUTEO',           'Muslo y Glúteo',    'CORPORAL', 14)
ON CONFLICT ("key") DO NOTHING;
