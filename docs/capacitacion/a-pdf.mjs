// Convierte los HTML de ./salida en PDF A4 dentro de ./pdf, usando Chrome o Edge
// en modo headless (no hace falta instalar nada más).
//
// Uso:  node generar.mjs && node a-pdf.mjs

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const ejecutar = promisify(execFile);
const AQUI = dirname(fileURLToPath(import.meta.url));
const ENTRADA = join(AQUI, 'salida');
const SALIDA = join(AQUI, 'pdf');

// Navegadores habituales en Windows, macOS y Linux.
const CANDIDATOS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const navegador = CANDIDATOS.find((r) => existsSync(r));
if (!navegador) {
  console.error('No encontré Chrome ni Edge. Abre los HTML de ./salida y usa Ctrl+P → Guardar como PDF.');
  process.exit(1);
}

if (!existsSync(ENTRADA)) {
  console.error('Falta la carpeta ./salida. Corre primero:  node generar.mjs');
  process.exit(1);
}

await mkdir(SALIDA, { recursive: true });
const archivos = (await readdir(ENTRADA)).filter((f) => f.endsWith('.html'));

for (const archivo of archivos) {
  const destino = join(SALIDA, archivo.replace(/\.html$/, '.pdf'));
  await ejecutar(navegador, [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--no-pdf-header-footer', // sin encabezado ni número de página del navegador
    `--print-to-pdf=${destino}`,
    pathToFileURL(join(ENTRADA, archivo)).href,
  ]);
  console.log('✓', archivo.replace(/\.html$/, '.pdf'));
}

console.log(`\n${archivos.length} PDF listos en: ${SALIDA}`);
