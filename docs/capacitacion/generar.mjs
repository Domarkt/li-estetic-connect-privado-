// Generador del material de capacitación.
// Uso:  node generar.mjs        → escribe los HTML en ./salida
// Luego se abre cada HTML en el navegador y se guarda como PDF (Ctrl+P → Guardar como PDF).
//
// El contenido vive en contenido.mjs. Este archivo solo se ocupa del diseño.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marca, modulos } from './contenido.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SALIDA = join(AQUI, 'salida');

/** Escapa texto para que un & o un < no rompan el HTML. */
const e = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slug = (s) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// Paleta y tipografía del propio sistema, para que la capacitación se vea como el producto.
const CSS = `
:root{
  --magenta:#B31C86; --magenta-d:#8E1268; --magenta-soft:#FBEEF6;
  --navy:#1C2540; --navy-2:#28324F; --navy-soft:#EEF1F8;
  --muted:#6A7089; --faint:#9AA0B4;
  --line:#E7E9F2; --line-2:#EFF1F7; --paper:#FFFFFF; --ground:#F5F6FB;
  --ok:#1F9D6B; --ok-soft:#E7F5EE;
  --warn:#C9880E; --warn-soft:#FBF1DE;
  --danger:#C0392B; --danger-soft:#FBEAE7;
  --teal:#2C7FB8; --teal-soft:#E6F0F7;
  --serif:"Playfair Display",Georgia,"Times New Roman",serif;
  --sans:"Plus Jakarta Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
}
*{box-sizing:border-box;}
html{-webkit-print-color-adjust:exact; print-color-adjust:exact;}
body{
  margin:0; background:var(--ground); color:var(--navy);
  font-family:var(--sans); font-size:11pt; line-height:1.55;
}
.hoja{
  width:210mm; min-height:297mm; margin:8mm auto; padding:16mm 15mm 14mm;
  background:var(--paper); box-shadow:0 1px 2px rgba(28,37,64,.06),0 8px 24px rgba(28,37,64,.05);
  display:flex; flex-direction:column;
}

/* ── Encabezado ─────────────────────────────────────────── */
.cabecera{display:flex; align-items:baseline; gap:10px; padding-bottom:7px; border-bottom:2px solid var(--magenta); margin-bottom:16px;}
.cabecera .sistema{font-family:var(--serif); font-size:12.5pt; font-weight:700; letter-spacing:-.01em;}
.cabecera .lema{font-family:var(--serif); font-style:italic; font-size:9.5pt; color:var(--magenta);}
.cabecera .cual{margin-left:auto; font-size:8pt; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:var(--faint);}

/* ── Portada del módulo ─────────────────────────────────── */
.portada{display:grid; grid-template-columns:auto 1fr; gap:18px; align-items:start; margin-bottom:20px;}
.numero{
  font-family:var(--serif); font-size:44pt; line-height:.85; font-weight:700;
  color:var(--magenta); font-variant-numeric:tabular-nums;
}
.numero small{display:block; font-family:var(--sans); font-size:7.5pt; font-weight:700; letter-spacing:.16em; color:var(--faint); margin-bottom:5px;}
h1{font-family:var(--serif); font-size:25pt; line-height:1.08; margin:2px 0 6px; text-wrap:balance; letter-spacing:-.015em;}
.bajada{font-size:11.5pt; color:var(--muted); margin:0 0 10px; max-width:62ch;}
.etiquetas{display:flex; flex-wrap:wrap; gap:6px; align-items:center;}
.rol{font-size:8.5pt; font-weight:700; padding:3px 9px; border-radius:999px; background:var(--teal-soft); color:var(--teal);}
.tiempo{font-size:8.5pt; font-weight:700; padding:3px 9px; border-radius:999px; background:var(--navy-soft); color:var(--navy-2);}

/* ── Secciones ──────────────────────────────────────────── */
.seccion{margin-top:18px;}
.rotulo{
  font-size:8pt; font-weight:800; letter-spacing:.16em; text-transform:uppercase;
  color:var(--magenta); margin-bottom:8px; padding-bottom:5px; border-bottom:1px solid var(--line);
}
.proposito{
  font-size:11pt; background:var(--magenta-soft); border-left:3px solid var(--magenta);
  padding:11px 14px; border-radius:0 10px 10px 0; margin:0; max-width:64ch;
}

/* ── Pasos (secuencia real: por eso van numerados) ──────── */
.pasos{list-style:none; margin:0; padding:0; counter-reset:paso; display:flex; flex-direction:column; gap:9px;}
.pasos li{display:grid; grid-template-columns:26px 1fr; gap:11px; align-items:start; break-inside:avoid;}
.pasos li::before{
  counter-increment:paso; content:counter(paso);
  width:26px; height:26px; border-radius:50%; background:var(--navy); color:#fff;
  font-size:9.5pt; font-weight:700; display:flex; align-items:center; justify-content:center;
  font-variant-numeric:tabular-nums;
}
.pasos .t{font-weight:700; font-size:10.5pt;}
.pasos .d{color:var(--muted); font-size:10pt;}

/* ── Avisos y atajos ────────────────────────────────────── */
.avisos{list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:7px;}
.avisos li{
  background:var(--warn-soft); border-left:3px solid var(--warn); color:#7A5405;
  padding:8px 12px; border-radius:0 8px 8px 0; font-size:10pt; break-inside:avoid;
}
.atajos{list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px;}
.atajos li{position:relative; padding-left:18px; font-size:10pt; color:var(--muted); break-inside:avoid;}
.atajos li::before{content:"→"; position:absolute; left:0; color:var(--ok); font-weight:700;}

.pie{
  margin-top:auto; padding-top:12px; border-top:1px solid var(--line);
  display:flex; justify-content:space-between; font-size:8pt; color:var(--faint);
}

/* ── Índice ─────────────────────────────────────────────── */
.intro{font-size:11pt; color:var(--muted); max-width:64ch; margin:0 0 6px;}
.indice{list-style:none; margin:14px 0 0; padding:0; display:flex; flex-direction:column;}
.indice li{display:grid; grid-template-columns:34px 1fr auto; gap:12px; align-items:baseline; padding:9px 0; border-bottom:1px solid var(--line-2); break-inside:avoid;}
.indice .n{font-family:var(--serif); font-size:14pt; font-weight:700; color:var(--magenta); font-variant-numeric:tabular-nums;}
.indice .t{font-weight:700; font-size:11pt;}
.indice .t span{display:block; font-weight:400; font-size:9.5pt; color:var(--muted);}
.indice .r{font-size:8.5pt; color:var(--faint); text-align:right;}
.indice a{color:inherit; text-decoration:none;}
.nota{margin-top:16px; background:var(--ok-soft); border-left:3px solid var(--ok); color:#14614A; padding:10px 13px; border-radius:0 8px 8px 0; font-size:10pt;}

/* ── Impresión ──────────────────────────────────────────── */
@page{size:A4 portrait; margin:14mm 13mm;}
@media print{
  body{background:#fff;}
  .hoja{width:auto; min-height:0; margin:0; padding:0; box-shadow:none;}
  .seccion{break-inside:avoid;}
  h1,.rotulo{break-after:avoid;}
}
@media (max-width:820px){
  .hoja{width:auto; margin:0; padding:22px 16px;}
  .portada{grid-template-columns:1fr; gap:6px;}
  .numero{font-size:32pt;}
  h1{font-size:21pt;}
}
`;

const cabecera = (cual) => `
<header class="cabecera">
  <span class="sistema">${e(marca.sistema)}</span>
  <span class="lema">${e(marca.lema)}</span>
  <span class="cual">${e(cual)}</span>
</header>`;

const pie = (izq) => `
<footer class="pie"><span>${e(izq)}</span><span>${e(marca.pie)}</span></footer>`;

const envoltura = (titulo, cuerpo) => `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(titulo)}</title>
<style>${CSS}</style>
</head>
<body>
<main class="hoja">
${cuerpo}
</main>
</body>
</html>`;

function paginaModulo(m) {
  const n = String(m.num).padStart(2, '0');
  const cuerpo = `
${cabecera(`Módulo ${n}`)}

<section class="portada">
  <div class="numero"><small>MÓDULO</small>${n}</div>
  <div>
    <h1>${e(m.titulo)}</h1>
    <p class="bajada">${e(m.bajada)}</p>
    <div class="etiquetas">
      ${m.roles.map((r) => `<span class="rol">${e(r)}</span>`).join('')}
      <span class="tiempo">⏱ ${e(m.duracion)}</span>
    </div>
  </div>
</section>

<section class="seccion">
  <div class="rotulo">Para qué sirve</div>
  <p class="proposito">${e(m.proposito)}</p>
</section>

<section class="seccion">
  <div class="rotulo">Paso a paso</div>
  <ol class="pasos">
    ${m.pasos.map((p) => `<li><div><div class="t">${e(p.t)}</div><div class="d">${e(p.d)}</div></div></li>`).join('\n    ')}
  </ol>
</section>

<section class="seccion">
  <div class="rotulo">Ojo con esto</div>
  <ul class="avisos">
    ${m.ojo.map((x) => `<li>${e(x)}</li>`).join('\n    ')}
  </ul>
</section>

<section class="seccion">
  <div class="rotulo">Atajos y dudas frecuentes</div>
  <ul class="atajos">
    ${m.atajos.map((x) => `<li>${e(x)}</li>`).join('\n    ')}
  </ul>
</section>

${pie(`${e(m.titulo)} · Módulo ${n}`)}`;
  return envoltura(`Módulo ${n} · ${m.titulo} · ${marca.sistema}`, cuerpo);
}

function paginaIndice() {
  const cuerpo = `
${cabecera('Índice')}

<section class="portada">
  <div class="numero"><small>GUÍA</small>${modulos.length}</div>
  <div>
    <h1>Capacitación del equipo</h1>
    <p class="bajada">Guía por módulos para operar ${e(marca.sistema)} en las tres sucursales de ${e(marca.negocio)}.</p>
    <div class="etiquetas">
      <span class="rol">Recepción</span><span class="rol">Esteticista</span><span class="rol">Administración</span>
    </div>
  </div>
</section>

<section class="seccion">
  <div class="rotulo">Cómo usar esta guía</div>
  <p class="intro">Cada módulo es una sesión corta e independiente. Se recomienda seguir el orden: los primeros son comunes a todo el equipo y los últimos son de administración. Al terminar cada módulo, practica el paso a paso en el sistema con un caso real.</p>
</section>

<section class="seccion">
  <div class="rotulo">Módulos</div>
  <ol class="indice">
    ${modulos.map((m) => `<li>
      <span class="n">${String(m.num).padStart(2, '0')}</span>
      <span class="t"><a href="./modulo-${String(m.num).padStart(2, '0')}-${slug(m.titulo)}.html">${e(m.titulo)}</a><span>${e(m.bajada)}</span></span>
      <span class="r">${e(m.roles.join(' · '))}<br>${e(m.duracion)}</span>
    </li>`).join('\n    ')}
  </ol>
  <p class="nota">Para generar los PDF: abre cada archivo en el navegador y usa <b>Ctrl + P → Guardar como PDF</b>, tamaño A4. Activa "Gráficos de fondo" para que se impriman los colores.</p>
</section>

${pie('Índice general')}`;
  return envoltura(`Capacitación · ${marca.sistema}`, cuerpo);
}

await mkdir(SALIDA, { recursive: true });
await writeFile(join(SALIDA, 'index.html'), paginaIndice(), 'utf8');
for (const m of modulos) {
  const nombre = `modulo-${String(m.num).padStart(2, '0')}-${slug(m.titulo)}.html`;
  await writeFile(join(SALIDA, nombre), paginaModulo(m), 'utf8');
  console.log('✓', nombre);
}
console.log(`\n${modulos.length} módulos + índice generados en: ${SALIDA}`);
console.log('Abre index.html en el navegador y usa Ctrl+P → Guardar como PDF.');
