// service-worker.js
// PokeBros PWA — safe caching (skip chrome-extension/mozilla-extension/etc)

const CACHE_NAME = 'pweb-cache-v5'; // bump when you deploy
const ASSETS = [
  '/',                 // keep if you serve index at /
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/images/logo.png',
  '/images/icons/icon-192.png',
  '/images/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Only handle GET + http(s) + same-origin. Ignore chrome-extension, data:, file:, etc.
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 1) Method guard
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 2) Protocol guard
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // 3) Navigation requests: network-first, fallback to cached index for offline
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        // Try live network first
        const fresh = await fetch(req);
        return fresh;
      } catch {
        // Offline fallback
        const cached = await caches.match('/index.html');
        return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // 4) Same-origin static assets: cache-first with background refresh
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) {
        // refresh in background (don’t fail page if it errors)
        event.waitUntil(fetch(req).then(res => {
          if (res && res.ok) cache.put(req, res.clone());
        }).catch(() => {}));
        return cached;
      }
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) await cache.put(req, fresh.clone());
        return fresh;
      } catch {
        // last resort: give whatever we had
        return cached || Response.error();
      }
    })());
    return;
  }

  // 5) Cross-origin: do not cache (avoids chrome-extension, analytics, etc.)
  // Just let the browser handle it normally.
  return;
});