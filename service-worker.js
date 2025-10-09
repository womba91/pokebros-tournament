// ----------------- service-worker.js -----------------

// Bump this each release to force a fresh cache
const CACHE_VERSION = 'v2.1.0';
const CACHE_NAME    = `pokebros-${CACHE_VERSION}`;

// Files to precache (relative to the worker *scope*, so this works on GitHub Pages)
const PRECACHE = [
  'index.html',
  'style.css',
  'app.js',
  'manifest.json',
  'images/logo.png',
  'images/icons/icon-192.png',
  'images/icons/icon-512.png'
];

// Helper: resolve a path against this worker's scope
const urlFromScope = (p) => new URL(p, self.registration.scope).toString();

/* Install: precache and activate immediately */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(PRECACHE.map(urlFromScope))
    )
  );
  self.skipWaiting();
});

/* Activate: clean old versions and take control */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k.startsWith('pokebros-') && k !== CACHE_NAME)
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

/* Fetch strategy
   - Navigations: network-first, fallback to cached index.html
   - Same-origin requests: stale-while-revalidate
   - Cross-origin or non-GET: passthrough
*/
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Only care about http(s)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // 1) Navigations (address-bar loads, SPA reloads)
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        // Live first
        const fresh = await fetch(req);
        return fresh;
      } catch {
        // Fallback to precached index
        const cached = await caches.match(urlFromScope('index.html'));
        return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // 2) Same-origin static: stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);

      const fetchAndUpdate = fetch(req).then(resp => {
        if (resp && resp.ok) cache.put(req, resp.clone());
        return resp;
      }).catch(() => undefined);

      // Return cached immediately if present, otherwise wait for network
      return cached || (await fetchAndUpdate) || new Response('', { status: 504 });
    })());
    return;
  }

  // 3) Cross-origin: let the browser handle it (don’t cache)
  return;
});

/* Allow page to trigger immediate activate */
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});