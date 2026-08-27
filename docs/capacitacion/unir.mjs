// Une el índice + los 13 módulos (ya generados en ./salida) en UN solo HTML,
// un módulo por página, para imprimirlo como un único PDF (fácil de enviar por
// WhatsApp). Uso:  node generar.mjs && node unir.mjs   (luego se imprime a PDF)
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SALIDA = join(AQUI, 'salida');

const html = (f) => readFile(join(SALIDA, f), 'utf8');
const tomarMain = (s) => (s.match(/<main class="hoja">[\s\S]*?<\/main>/) || [''])[0];

const indice = await html('index.html');
const head = (indice.match(/<head>[\s\S]*?<\/head>/) || ['<head></head>'])[0];

// Orden: índice primero, luego los módulos por número.
const modulos = (await readdir(SALIDA))
  .filter((f) => /^modulo-\d\d-.*\.html$/.test(f))
  .sort();

const paginas = [tomarMain(indice)];
for (const f of modulos) paginas.push(tomarMain(await html(f)));

// Cada hoja (menos la primera) fuerza un salto de página al imprimir.
const cuerpo = paginas
  .map((m, i) => (i === 0 ? m : m.replace('<main class="hoja">', '<main class="hoja" style="break-before:page">')))
  .join('\n');

const doc = `<!doctype html>
<html lang="es">
${head}
<body>
${cuerpo}
</body>
</html>`;

await writeFile(join(SALIDA, 'instructivo-completo.html'), doc, 'utf8');
console.log(`✓ instructivo-completo.html (${paginas.length} páginas) en ${SALIDA}`);
