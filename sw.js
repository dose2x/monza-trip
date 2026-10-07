// Offline support: the app shell is fetched fresh when the network is quick, and served from the saved copy
// when it is slow or absent. Bump CACHE when the list of shell files changes.
const CACHE = 'monza-shell-v7';
const TILES = 'monza-tiles-v1';
const MAX_TILES = 1500;
const SLOW_MS = 2500;
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'seed.js', 'config.js', 'manifest.webmanifest', 'icon-192.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== TILES && !k.startsWith('monza-photos')).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Map tiles already looked at stay available offline. The page asks for them with CORS so they can be stored.
async function tile(req) {
  const c = await caches.open(TILES);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    await c.put(req, res.clone());
    const keys = await c.keys();
    if (keys.length > MAX_TILES) await Promise.all(keys.slice(0, keys.length - MAX_TILES).map(k => c.delete(k)));
  }
  return res;
}

async function shell(req) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(req, { ignoreSearch: true });
  const fresh = fetch(req).then(res => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
  if (!saved) {
    // Nothing saved yet: wait for the network; a page load that fails falls back to the app itself.
    return fresh.catch(() => req.mode === 'navigate' ? cache.match('index.html') : Response.error());
  }
  // A saved copy exists: use the network only if it answers quickly, and keep refreshing the copy in the background.
  const slow = new Promise(resolve => setTimeout(() => resolve(saved), SLOW_MS));
  return Promise.race([fresh.catch(() => saved), slow]);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('tile.openstreetmap.org')) return e.respondWith(tile(req));
  const isShell = url.origin === location.origin || ['unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname);
  if (isShell) e.respondWith(shell(req)); // sync and place search always go to the network
});
