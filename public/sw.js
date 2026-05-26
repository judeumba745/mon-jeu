self.addEventlistener('install', (e) => {
  console.log('service worker installé');
});

self.addEventlistener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then(resp => resp || fetch(e.request))
    );
});
