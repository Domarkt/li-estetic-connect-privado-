-- ═══════════════════════════════════════════════════════════════════════════
--  LIMPIEZA PARA SALIR A PRODUCCIÓN (borra datos de prueba)
--  Proyecto Supabase: suedjotznakkkgwftmnd
--
--  ⚠️  DESTRUCTIVO E IRREVERSIBLE. Haz un backup antes (Supabase → Database → Backups).
--
--  SE CONSERVAN:
--    • Sucursales (Branch)
--    • Usuarios del sistema / colaboradores (User) — se reinician sus contadores
--    • Catálogo de SERVICIOS, PAQUETES y COMBOS
--    • Integraciones y conexiones de Calendar, metas por sucursal, reglas de puntos/recompensas
--
--  SE BORRAN:
--    • Pacientes, fichas, tratamientos, cargos, citas, facturas, recibos
--    • Mensajes (chat de equipo, conversaciones, leads, notificaciones)
--    • Cuadres de caja, deducciones, puntos ganados y canjes
--    • Equipos (activos) e historial, inventario y movimientos de stock
--    • Catálogo de PRODUCTOS e INSUMOS
--    • Cuentas de portal del paciente y solicitudes de compra
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1) Vaciar todas las tablas operativas (CASCADE resuelve el orden de llaves foráneas).
TRUNCATE TABLE
  "Appointment",
  "ClinicalRecord",
  "Treatment",
  "ChargeItem",
  "Invoice",
  "InvoiceItem",
  "InvoiceSequence",
  "Patient",
  "PatientAccount",
  "PurchaseRequest",
  "Conversation",
  "Message",
  "Lead",
  "PointsEntry",
  "Redemption",
  "Notification",
  "TeamMessage",
  "TeamThreadRead",
  "CashClose",
  "StaffDeduction",
  "Asset",
  "AssetEvent",
  "StockLevel",
  "StockMovement"
RESTART IDENTITY CASCADE;

-- 2) Quitar del catálogo solo productos e insumos (los servicios/paquetes/combos se quedan).
DELETE FROM "CatalogItem" WHERE "kind" IN ('PRODUCTO', 'INSUMO');

-- 3) Reiniciar contadores de desempeño de las colaboradoras (para empezar limpio).
UPDATE "TherapistProfile" SET "points" = 0, "monthSales" = 0;

-- 4) Garantizar los 2 correos base de Domarkt como administradores (no se borran desde la UI).
--    Si ya existen, solo se aseguran como ADMIN activos (NO se cambia su contraseña).
--    Si NO existían, se crean con la contraseña temporal:  LiEstetic2026!  (cámbiala al entrar).
INSERT INTO "User" (id, name, email, "passwordHash", role, "branchId", active, "avatarColor", "createdAt")
VALUES
  (substr(md5(random()::text || clock_timestamp()::text), 1, 25), 'Domarkt · Administración', 'dominicanmarketingrd@gmail.com', '$2a$10$bb1kGo1IvA.D6nYOnB6kauoXxXAY28Rb71NnQDezRPOy7FTU3Qeky', 'ADMIN'::"Role", NULL, true, '#B31C86', now()),
  (substr(md5(random()::text || clock_timestamp()::text), 1, 25), 'Domarkt · Soporte',        'infodomarkt@gmail.com',        '$2a$10$bb1kGo1IvA.D6nYOnB6kauoXxXAY28Rb71NnQDezRPOy7FTU3Qeky', 'ADMIN'::"Role", NULL, true, '#245E85', now())
ON CONFLICT (email) DO UPDATE SET role = 'ADMIN'::"Role", active = true;

COMMIT;
