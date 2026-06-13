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

  // API = toujours internet
  if (e.request.url.includes('/api/')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // navigation (ouvrir le site)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // fichiers (css, js, images)
  e.respondWith(
    caches.match(e.request).then(res => res || fetch(e.request))
  );
});
