/*
 * Service worker de Li Estetic Connect (PWA instalable).
 *
 * Estrategia conservadora para no romper la app en producción:
 *  - Solo actúa sobre peticiones del MISMO origen (la web). La API vive en otro
 *    dominio (Render): nunca se intercepta ni se cachea (datos por sucursal, con sesión).
 *  - Navegaciones (SPA): RED PRIMERO, con index.html como respaldo sin conexión. Así
 *    siempre llega el index más reciente (que apunta a los assets con hash nuevo tras
 *    cada deploy) y no queda una versión vieja "pegada".
 *  - Assets estáticos (JS/CSS/imágenes): responde de caché y actualiza por detrás.
 *    Como Vite pone hash en el nombre, cada deploy trae archivos nuevos sin conflicto.
 */
const CACHE = 'lec-v1';
const SHELL = ['/', '/index.html', '/li-logo.png', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API y terceros: directo a la red

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }

  e.respondWith(
    caches.match(req).then((cached) => {
      const fromNet = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || fromNet;
    }),
  );
});
