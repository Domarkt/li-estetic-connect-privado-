-- 039 — Sofia (asistente IA) sobre el módulo de mensajería omnicanal.
-- Banderas por conversación para el modo HÍBRIDO:
--   botEnabled    → Sofia responde automáticamente en este hilo (toggle del staff).
--   needsHuman    → Sofia escaló: requiere atención de una persona (badge en la bandeja).
--   handoffReason → motivo interno de la escalación (no se muestra al cliente).
-- Y una marca por mensaje: viaBot = lo envió Sofia (para distinguirlo del staff).
-- Seguro de re-ejecutar (IF NOT EXISTS). No borra ni altera datos existentes.

ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "botEnabled"    BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "needsHuman"    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "handoffReason" TEXT;

ALTER TABLE "Message"      ADD COLUMN IF NOT EXISTS "viaBot"        BOOLEAN NOT NULL DEFAULT false;
