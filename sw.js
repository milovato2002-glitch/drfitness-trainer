const CACHE_NAME = 'drfitness-v3';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// INSTALL — cache app shell, then activate this SW immediately instead of
// waiting for all old tabs to close.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ACTIVATE — purge any cache whose name doesn't match the current version,
// then take control of every open page so the next fetch goes through this SW.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// FETCH —
//  - Skip non-GET and the chat function (those must always hit the network).
//  - For the app shell (/, /index.html), use NETWORK-FIRST so returning users
//    always get the latest HTML; fall back to cache only when offline.
//  - For everything else, cache-first with network fallback (and update cache
//    on successful network fetch).
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || event.request.url.includes('/.netlify/functions/')) {
    return;
  }

  const url = new URL(event.request.url);
  const isAppShell = url.pathname === '/' || url.pathname === '/index.html';

  if (isAppShell) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request).then(r => r || caches.match('/index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request)
        .then(response => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match('/index.html'));
    })
  );
});
