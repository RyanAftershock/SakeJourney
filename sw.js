/* Sake Journey service worker — offline-first app shell.
   Venue wifi is unreliable; once loaded, the app runs from cache.
   Guest data lives in IndexedDB (see js/store.js), never here. */

const CACHE = 'sake-journey-v15';
const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/logo.svg',
  './assets/venue-sample.png',
  './js/app.js',
  './js/store.js',
  './js/net.js',
  './js/seed.js',
  './js/ui.js',
  './js/views/guest.js',
  './js/views/host.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never cache the live API or event stream — always hit the network.
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) return;

  // Same-origin app files: cache-first with background refresh (stale-while-revalidate).
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Cross-origin (fonts, optional QR lib): try network, fall back to cache if present.
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req))
  );
});
