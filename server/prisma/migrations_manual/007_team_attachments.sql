-- Adjuntos en el chat de equipo (foto/video/documento) guardados como base64 en la propia DB.
-- Correr en Supabase (proyecto suedjotznakkkgwftmnd) ANTES de desplegar el código.
ALTER TABLE "TeamMessage" ALTER COLUMN "body" SET DEFAULT '';
ALTER TABLE "TeamMessage" ADD COLUMN IF NOT EXISTS "attachmentData" TEXT;
ALTER TABLE "TeamMessage" ADD COLUMN IF NOT EXISTS "attachmentName" TEXT;
ALTER TABLE "TeamMessage" ADD COLUMN IF NOT EXISTS "attachmentKind" TEXT;
ALTER TABLE "TeamMessage" ADD COLUMN IF NOT EXISTS "attachmentMime" TEXT;
