import './config/tz.js'; // fija TZ de RD antes de todo (fechas/horas correctas)
import { createApp } from './app.js';
import { env } from './config/env.js';
import { backfillEncryption } from './config/backfill.js';

const app = createApp();
app.listen(env.port, () => {
  console.log(`\n  Li Estetic Connect API → http://localhost:${env.port}`);
  console.log(`  Health: http://localhost:${env.port}/api/health\n`);
  // Cifra datos sensibles heredados en texto plano (idempotente, no bloquea el arranque).
  backfillEncryption().catch((e) => console.error('  ⚠️  Backfill de cifrado falló:', e));
});
