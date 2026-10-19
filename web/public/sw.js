// Keeps the app's own files on the phone so the installed app opens fast, even on a weak
// connection. Project data (/api) always comes live from the server and is never stored here.
const CACHE = 'bpm-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

const keep = (req, res) => {
  if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
  return res;
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    // The page itself: fresh when online, the stored copy when not.
    e.respondWith(fetch(req).then((res) => keep(new Request('/'), res)).catch(() => caches.match('/')));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    // Build files have the content hash in their name, so a stored copy is always right.
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => keep(req, res))));
    return;
  }
  e.respondWith(fetch(req).then((res) => keep(req, res)).catch(() => caches.match(req)));
});
