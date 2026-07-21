-- Vincular la cita al paquete/combo que consume, para descontar la sesión al cerrar el turno.
-- (Antes doneSessions nunca se incrementaba: el consumo se llevaba en papel.)
-- Correr en Supabase (proyecto suedjotznakkkgwftmnd) ANTES de desplegar el código.
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "treatmentId" TEXT;
CREATE INDEX IF NOT EXISTS "Appointment_treatmentId_idx" ON "Appointment" ("treatmentId");
