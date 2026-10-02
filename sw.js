/* B.R.A.I.N. service worker v2
   ─────────────────────────────────────────────────────────
   Strategy per resource:
     Shell   → stale-while-revalidate (cache-first, background refresh)
     library.json, notes.json → network-first with 3 s timeout, fallback to cache
     Cache only res.ok, never touch cross-origin.
   Update protocol: SW waits for user tap, then skipWaiting + reload.
   main.js hook → listen for {type:'sw-update-waiting'} on serviceWorker messages,
   show toast; on tap post {type:'sw-skip-waiting'} back, reload on controllerchange.
*/

// deploy.sh stamps CACHE with the build version so every deploy gets a fresh shell cache.
const CACHE = 'brain-ae4dbd7-202610022317';
const SHELL_CACHE = CACHE;
const API_CACHE  = 'brain-api-v2';

/* precached shell: everything the app needs to boot without a server */
const SHELL = [
  './', 'index.html', 'style.css', 'manifest.json',
  'src/main.js', 'src/util.js', 'src/library.js', 'src/state.js',
  'src/scheduler.js', 'src/session.js', 'src/watch.js',
  'src/intake.js', 'src/learn.js', 'src/notebook.js', 'src/ai.js', 'src/tutor.js', 'src/playlist.js', 'src/search.js', 'src/level.js',
  'icons/icon-192.png', 'icons/icon-512.png',
  'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'
];

/* ── helpers ──────────────────────────────────────────── */

/** Network-first with a timeout, falling back to cache.
 *  Only res.ok goes into the cache. */
async function networkFirstTimeout(req, cacheName, ms) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), ms));

  try {
    const res = await Promise.race([fetch(req), timeout]);
    if (res.ok) {
      const copy = res.clone();
      caches.open(cacheName).then(c => c.put(req, copy));
      return res;
    }
  } catch { /* fall through to cache */ }

  // Never answer a data request with the HTML shell: r.json() would throw.
  const cached = await caches.match(req);
  return cached || new Response('offline', { status: 503, statusText: 'Offline' });
}

/** Stale-while-revalidate: serve cache immediately, then refresh in the
 *  background.  On cold miss, wait for network.  Only res.ok is cached. */
async function staleWhileRevalidate(req, cacheName) {
  // Every in-app URL (?go=train/…, ?add=…) is the same shell page: store and
  // look it up by path so the cache holds one copy, not one per URL visited.
  const nav = req.mode === 'navigate';
  const key = nav ? new URL(req.url).pathname : req;
  const cached = await caches.match(key);

  // Revalidate with the server: a heuristically-cached old module next to a new
  // one breaks the ES-module graph. Navigate requests cannot be re-initialised.
  const net = fetch(nav ? req : new Request(req, { cache: 'no-cache' })).then(res => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(cacheName).then(c => c.put(key, copy));
    }
    return res;
  }).catch(() => null);

  if (cached) { net; return cached; }   // bg update, return cached now
  const live = await net;                // cold miss — wait
  if (live) return live;
  // Offline: a page falls back to the shell; a script or image must fail
  // honestly rather than receive HTML (a MIME error that hides the cause).
  return nav ? caches.match('./index.html') : Response.error();
}

/** Tell every open window an update is waiting. */
function notifyClients(msg) {
  self.clients.matchAll({ type: 'window' }).then(clients => {
    for (const c of clients) c.postMessage(msg);
  });
}

/* ── lifecycle ────────────────────────────────────────── */

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      // cache:'reload' skips the HTTP cache (GitHub Pages: max-age=600) so a
      // deploy never precaches a mix of old and new modules.
      .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
      // The first page load fetched library.json before this SW controlled it,
      // so seed the API cache now or the app cannot boot offline.
      .then(() => caches.open(API_CACHE))
      .then(c => Promise.all([
        c.add(new Request('library.json', { cache: 'reload' })),
        c.add(new Request('notes.json', { cache: 'reload' })).catch(() => {}),   // optional AI notes
      ]))
      .then(() => {
        // After the shell is cached, if there are open pages this is an
        // update — tell them a new version is waiting.
        // (A fresh install has no open windows; this is a no-op then.)
        return self.clients.matchAll({ type: 'window' }).then(clients => {
          for (const c of clients) c.postMessage({ type: 'sw-update-waiting' });
        });
      })
  );
  // Do NOT skipWaiting here — the user must accept the update via toast.
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(
      ks.filter(k => k !== SHELL_CACHE && k !== API_CACHE)
        .map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
  // After activation, check if there are windows to notify
  // (a fresh install won't have any; this is the post-skipWaiting activation)
});

/* ── update waiting protocol ──────────────────────────── */

self.addEventListener('message', e => {
  // main.js posts SKIP_WAITING; keep the older name working too.
  if (e.data?.type === 'SKIP_WAITING' || e.data?.type === 'sw-skip-waiting') {
    self.skipWaiting();
  }
  // Test hook: exercise the notifyClients path from the page
  if (e.data?.type === 'sw-ping-update') {
    notifyClients({ type: 'sw-update-waiting' });
  }
});

/* ── fetch routing ────────────────────────────────────── */

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;

  const u = new URL(r.url);
  if (u.origin !== self.location.origin) return;   // never touch youtube/instagram

  // library.json: network-first with 3 s timeout
  if (u.pathname.endsWith('/library.json') || u.pathname.endsWith('/notes.json')) {
    e.respondWith(networkFirstTimeout(r, API_CACHE, 3000));
    return;
  }

  // Shell: stale-while-revalidate
  e.respondWith(staleWhileRevalidate(r, SHELL_CACHE));
});