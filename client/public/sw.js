// BrainADZ HRMS service worker. It keeps the app itself (page, scripts, styles, icons) on the
// device so the installed app opens fast and still opens without a connection. People's data
// under /api is never stored here: it always comes straight from the server.
const SHELL = 'hrms-shell-v1';
const ASSETS = 'hrms-assets-v1';
const CORE = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];
const MAX_ASSETS = 80;
const NETWORK_WAIT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL);
      await shell.addAll(CORE);
      // Scripts and styles have hashed names, so read them from the page itself.
      const html = await (await shell.match('/')).text();
      const entry = [
        ...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1])),
      ];
      const assets = await caches.open(ASSETS);
      await assets.addAll(entry);
      // Every page's code is named in the main script; keep it all so any page opens offline.
      const pages = new Set();
      for (const file of entry.filter((f) => f.endsWith('.js'))) {
        const code = await (await assets.match(file)).text();
        for (const m of code.matchAll(/assets\/[\w.-]+\.(?:js|css)/g)) pages.add(`/${m[0]}`);
      }
      await assets.addAll([...pages].filter((f) => !entry.includes(f)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key !== SHELL && key !== ASSETS) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(key);
}

// Pages: the server's latest copy when it answers in time, otherwise the saved one.
async function page(request) {
  const shell = await caches.open(SHELL);
  const fresh = fetch(request).then((res) => {
    if (res.ok && (res.headers.get('content-type') || '').includes('text/html'))
      shell.put('/', res.clone());
    return res;
  });
  fresh.catch(() => {}); // a failure is handled below; this only keeps it from being reported twice
  const slow = new Promise((resolve) => {
    setTimeout(resolve, NETWORK_WAIT_MS);
  });
  try {
    const res = await Promise.race([fresh, slow]);
    if (res) return res;
  } catch {
    // offline: fall through to the saved copy
  }
  return (await shell.match('/')) || fresh;
}

// Hashed scripts and styles never change, so a saved copy is always right.
async function asset(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    await cache.put(request, res.clone());
    trim(cache);
  }
  return res;
}

// Icons and the manifest: answer from the saved copy and refresh it in the background.
async function staticFile(request) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request);
  const fresh = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || fresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // fonts and the like: the browser's own cache
  if (url.pathname.startsWith('/api/')) return; // personal data: always from the server
  if (request.mode === 'navigate') event.respondWith(page(request));
  else if (url.pathname.startsWith('/assets/')) event.respondWith(asset(request));
  else event.respondWith(staticFile(request));
});
