-- Nuevas áreas del cuerpo solicitadas por la administración (grupo CORPORAL).
-- Idempotente: si ya existen no se duplican, y si estaban dadas de baja se reactivan.
-- Correr en Supabase (proyecto suedjotznakkkgwftmnd) ANTES de desplegar el código.
-- 'Brazos' ya existe (grupo LASER) y no se toca aquí.

INSERT INTO "BodyArea" ("id","key","label","grupo","sortOrder") VALUES
  (substr(md5(random()::text),1,25), 'LATERAL',          'Lateral',          'CORPORAL', 6),
  (substr(md5(random()::text),1,25), 'MUSLO_TRASERO',    'Muslo trasero',    'CORPORAL', 7),
  (substr(md5(random()::text),1,25), 'MUSLO_DELANTERO',  'Muslo delantero',  'CORPORAL', 8),
  (substr(md5(random()::text),1,25), 'MUSLO_COMPLETO',   'Muslo completo',   'CORPORAL', 9),
  (substr(md5(random()::text),1,25), 'PIERNA_PANTORRILLA','Pierna / pantorrilla','CORPORAL', 10)
ON CONFLICT ("key") DO NOTHING;
