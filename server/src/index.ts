import { createApp } from './app.js';
import { env } from './config/env.js';

const app = createApp();
app.listen(env.port, () => {
  console.log(`\n  Li Estetic Connect API → http://localhost:${env.port}`);
  console.log(`  Health: http://localhost:${env.port}/api/health\n`);
});
