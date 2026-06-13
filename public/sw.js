const CACHE_STATIC = 'gameonline-static-v2';
const CACHE_PAGES = 'gameonline-pages-v2';

const FILES_TO_CACHE = [
  '/',
  '/index.html',
  '/tournoi.html',
  '/style.css',
  '/app.js',
  '/offline.html',
  '/icon-192.png',
  '/icon-512.png'
];

// Installation
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_STATIC).then(cache => cache.addAll(FILES_TO_CACHE))
  );

  self.skipWaiting();
});

// Activation
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_STATIC && key !== CACHE_PAGES) {
            return caches.delete(key);
          }
        })
      )
    )
  );

  self.clients.claim();
});

// Requêtes
self.addEventListener('fetch', e => {

  const url = new URL(e.request.url);

  // API : toujours réseau
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error: "offline" }), {
          headers: { "Content-Type": "application/json" }
        })
      )
    );
    return;
  }

  // Navigation des pages
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_PAGES).then(cache => {
            cache.put(e.request, copy);
          });
          return response;
        })
        .catch(async () => {
          return (
            await caches.match(e.request) ||
            await caches.match('/offline.html') ||
            await caches.match('/index.html')
          );
        })
    );
    return;
  }

  // CSS, JS, images...
  e.respondWith(
    caches.match(e.request).then(cached => {
      return (
        cached ||
        fetch(e.request).then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_STATIC).then(cache => {
              cache.put(e.request, copy);
            });
          }
          return response;
        })
      );
    })
  );
});
