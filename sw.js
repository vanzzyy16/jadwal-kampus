/* Jadwal Kampus — Service Worker
   Strategy:
   - Precache core shell on install (index.html, styles.css, app.js, fonts.css, icon.svg)
   - Runtime: cache-first for fonts/images (immutable-ish)
   - Runtime: stale-while-revalidate for CSS/JS (fast + fresh)
   - Runtime: network-first for navigations (fresh when online, cache when offline)
   - Excel/CDN libs (SheetJS, html2canvas) are cross-origin; we try network then
     fall back to cached responses opportunistically (no-cors not needed since they
     send CORS headers).
*/
const CACHE = 'jk-v1';
const CORE = [
  './',
  './index.html',
  './styles.css',
  './fonts.css',
  './app.js',
  './icon.svg',
  './manifest.webmanifest'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Navigations (HTML pages): network-first, fallback to cache, then offline page.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put('./index.html', copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('./index.html').then(r => r || caches.match(req)))
    );
    return;
  }

  // Same-origin static assets: stale-while-revalidate (CSS/JS/SVG).
  if (url.origin === self.location.origin) {
    if (/\.(?:css|js|svg|webmanifest)$/.test(url.pathname)) {
      e.respondWith(
        caches.open(CACHE).then(async c => {
          const cached = await c.match(req);
          const fetchPromise = fetch(req).then(res => {
            if (res && res.ok) c.put(req, res.clone());
            return res;
          }).catch(() => cached);
          return cached || fetchPromise;
        })
      );
      return;
    }
    // Fonts (woff2): cache-first, long-lived.
    if (/\.woff2$/.test(url.pathname)) {
      e.respondWith(
        caches.match(req).then(cached => cached || fetch(req).then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          }
          return res;
        }).catch(() => cached))
      );
      return;
    }
  } else {
    // Cross-origin (SheetJS, html2canvas CDNs): network-first, fall back to cache
    // if previously fetched (works offline once loaded once).
    e.respondWith(
      fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }
});
