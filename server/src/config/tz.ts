// Fija la zona horaria del proceso a República Dominicana (UTC-4). Debe
// importarse ANTES que cualquier otro módulo para que todas las fechas/horas
// del sistema (recibos, correos, agenda, reportes) usen la hora local de RD y
// no la del servidor (Render corre en UTC).
process.env.TZ = process.env.TZ || 'America/Santo_Domingo';
