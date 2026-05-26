self.addEventListener('install', (e) => {
  console.log('service worker installé');
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then(resp => resp || fetch(e.request))
    );
});
