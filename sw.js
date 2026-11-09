/* Service worker de Mis Series
   - App shell: se sirve desde caché (abre al instante) y se actualiza en segundo plano.
   - API de TMDB: siempre red primero; si falla, última respuesta guardada.
   - Imágenes de TMDB y librerías del CDN: caché primero.
   Sube VERSION cada vez que cambies index.html para forzar la actualización. */

const VERSION = 'misseries-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const API_CACHE = `${VERSION}-api`;
const IMG_CACHE = `${VERSION}-img`;
const CDN_CACHE = `${VERSION}-cdn`;

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

const CDN_HOSTS = ['esm.sh', 'cdn.tailwindcss.com'];
const MAX_IMAGES = 300;
const MAX_API = 200;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Limita el tamaño de una caché borrando las entradas más antiguas
async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

// API: red primero, caché como respaldo
async function networkFirst(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone()).then(() => trim(API_CACHE, MAX_API));
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;
    return new Response(JSON.stringify({ status_message: 'Sin conexión' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Imágenes y CDN: caché primero
async function cacheFirst(request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') {
    cache.put(request, response.clone()).then(() => max && trim(cacheName, max));
  }
  return response;
}

// App shell: respuesta inmediata desde caché y actualización en segundo plano
async function staleWhileRevalidate(request, fallbackUrl) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true }) || (fallbackUrl && await cache.match(fallbackUrl));
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(fallbackUrl || request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || (await network) || new Response('Sin conexión', { status: 503 });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.hostname === 'api.themoviedb.org') {
    event.respondWith(networkFirst(request));
  } else if (url.hostname === 'image.tmdb.org') {
    event.respondWith(cacheFirst(request, IMG_CACHE, MAX_IMAGES));
  } else if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request, CDN_CACHE));
  } else if (url.origin === self.location.origin) {
    // Navegación (abrir la app) → siempre el index.html cacheado
    if (request.mode === 'navigate') {
      event.respondWith(staleWhileRevalidate(request, './index.html'));
    } else {
      event.respondWith(staleWhileRevalidate(request));
    }
  }
});
