# Capacitación del equipo · Li Estetic Connect

Material de entrenamiento en 12 módulos, uno por área del sistema. Cada módulo es una
hoja A4 lista para imprimir o guardar como PDF.

## Generar el material

```bash
cd docs/capacitacion
node generar.mjs
```

Esto crea la carpeta `salida/` con:

- `index.html` — índice general con los 12 módulos
- `modulo-01-...html` … `modulo-12-...html` — un archivo por módulo

## Convertirlos en PDF

1. Abre el archivo en el navegador (doble clic).
2. **Ctrl + P** (o Cmd + P en Mac).
3. Destino: **Guardar como PDF**. Tamaño: **A4**. Márgenes: **Predeterminados**.
4. Activa **"Gráficos de fondo"** — sin esto los colores no se imprimen.

> Para hacerlos todos de una vez, abre `index.html` y ve entrando a cada módulo desde ahí.

## Editar los textos

Todo el contenido está en **`contenido.mjs`**. Es el único archivo que hay que tocar
para cambiar textos; el diseño vive en `generar.mjs` y no requiere mantenimiento.

Cada módulo tiene esta forma:

```js
{
  num: 6,
  titulo: 'Paquetes y combos',
  bajada: 'Una línea que resume el módulo.',
  roles: ['Recepción', 'Esteticista', 'Administración'],
  duracion: '25 min',
  proposito: 'Párrafo corto: qué resuelve esto en el día a día.',
  pasos:  [{ t: 'Título del paso', d: 'Qué hace la persona.' }],
  ojo:    ['Advertencias reales: errores que cuestan tiempo o dinero.'],
  atajos: ['Tips y dudas frecuentes.'],
}
```

Después de editar, vuelve a correr `node generar.mjs`.

## Agregar un módulo nuevo

Añade un objeto más al arreglo `modulos` con el siguiente `num`. El índice y el
nombre del archivo se generan solos.

## Diseño

Usa los mismos tokens que el sistema (magenta `#B31C86`, navy `#1C2540`, Playfair
Display + Plus Jakarta Sans) para que la capacitación se vea como el producto. Las
tipografías tienen respaldo (Georgia / system-ui), así que imprime igual sin conexión.

La estructura de cada módulo es siempre la misma, para que el equipo sepa dónde buscar:

| Sección | Para qué |
|---|---|
| **Para qué sirve** | El porqué, en lenguaje del negocio |
| **Paso a paso** | La secuencia exacta, numerada |
| **Ojo con esto** | Errores que cuestan dinero o tiempo |
| **Atajos y dudas frecuentes** | Lo que preguntan siempre |

## Generar los PDF automáticamente

En vez de imprimir uno por uno, se convierten todos con Chrome en modo headless:

```bash
node generar.mjs        # 1. genera los HTML en salida/
node a-pdf.mjs          # 2. convierte todo a PDF en pdf/
```

Los PDF quedan en `pdf/` (A4, listos para imprimir o enviar por WhatsApp).
