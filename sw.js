/* Jadwal Kampus — Service Worker
   Strategy:
   - Precache core shell on install (index.html, styles.css, app.js, fonts.css, icon.svg)
   - Navigations: network-first (fresh when online, cache when offline)
   - CSS/JS/SVG: NETWORK-FIRST (always serve the latest when online; stale-while-
     revalidate caused users to see outdated CSS for a full session after a deploy)
   - Fonts (woff2): cache-first (immutable, long-lived)
   - CDN libs (SheetJS, html2canvas): network-first, cache fallback
   - Bumping CACHE on every breaking change purges old entries on activate.
*/
const CACHE = 'jk-v4';
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

// Izinkan app meminta SW baru (waiting) mengambil alih segera, lalu controllerchange
// di app.js akan reload halaman supaya shell versi baru dipakai.
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
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

  // Same-origin static assets.
  if (url.origin === self.location.origin) {
    // CSS/JS/SVG/webmanifest: NETWORK-FIRST so a fresh deploy is served on the
    // very next load when online (stale-while-revalidate served the old sheet
    // for a whole session). Falls back to cache only when offline.
    if (/\.(?:css|js|svg|webmanifest)$/.test(url.pathname)) {
      e.respondWith(
        fetch(req).then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          }
          return res;
        }).catch(() => caches.match(req).then(r => r || Response.error()))
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
