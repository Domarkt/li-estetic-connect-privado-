-- Destinatario del mensaje del chat de equipo (a quién va dirigido: ALL/RECEPCIONISTA/ESTETICISTA)
-- Correr en Supabase (proyecto suedjotznakkkgwftmnd). Una sola línea.
ALTER TABLE "TeamMessage" ADD COLUMN IF NOT EXISTS "targetRole" TEXT NOT NULL DEFAULT 'ALL';
