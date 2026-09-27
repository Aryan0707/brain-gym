/* B.R.A.I.N. service worker — caches the app shell only.
   Video embeds are cross-origin and always go to the network. */
const CACHE = 'brain-v5';
const SHELL = ['./','index.html','style.css','app.js','library.json','manifest.json',
               'icons/icon-192.png','icons/icon-512.png','icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin) return;          // never touch youtube/instagram
  e.respondWith(
    fetch(r).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(r, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(r).then(hit => hit || caches.match('./index.html')))
  );
});
