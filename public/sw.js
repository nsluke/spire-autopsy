/**
 * Spire Autopsy service worker — offline support that doubles as the privacy
 * proof ("turn on airplane mode and keep using it").
 *
 * Strategy:
 *  - navigations (the app shell): network-first, falling back to the cached
 *    shell, so a fresh deploy is picked up on the next online visit and stale
 *    index.html is never pinned;
 *  - same-origin static assets (hashed /assets/, /art/, /demo/, fonts):
 *    cache-first — hashed files are immutable, art/demo change ~never.
 * Bump VERSION to invalidate everything after a breaking change.
 */
const VERSION = 'v1';
const CACHE = `spire-autopsy-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // CSP blocks these anyway

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((hit) => hit ?? caches.match('./index.html'))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        }),
    ),
  );
});
