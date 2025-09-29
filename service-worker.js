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
// ----------------- service-worker.js (PWA) -----------------
const CACHE_VERSION = 'v2.0.0-2025-09-23';     // <— bump for each release
const CACHE_NAME    = `pokebros-${CACHE_VERSION}`;

// List what you want precached at install (keep/extend your current list)
const PRECACHE_URLS = [
  '/',               // for GitHub Pages this is your repo page root
  '/index.html',
  '/app.js',
  '/style.css',
  '/images/favicon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS))
  );
  // Activate immediately without waiting for page reload
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Remove old cache versions, then take control of open pages
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('pokebros-') && k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Cache-first with background update (good default)
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchAndCache = fetch(event.request).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, copy)).catch(()=>{});
        return resp;
      });
      return cached || fetchAndCache;
    })
  );
});

// Optional: allow the page to tell the SW to activate now
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
