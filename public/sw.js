const CACHE_STATIC = 'gameonline-v1.2';
const CACHE_API = 'gameonline-api-v1';

const FILES_TO_CACHE = [
  '/',
  '/index.html',
  '/tournoi.html',
  '/style.css',
  '/app.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_STATIC).then(c => c.addAll(FILES_TO_CACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_STATIC && k !== CACHE_API).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
 
  // API et HTML : Network First
  if (url.pathname.startsWith('/api/') || e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_API).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // CSS, JS, images : Cache First
  e.respondWith(
    caches.match(e.request).then(res => res || fetch(e.request))
  );
});