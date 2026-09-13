// Service Worker for GarminDash PWA
const CACHE_NAME = 'garmindash-v1';
const STATIC_ASSETS = [
  '/',
  '/static/style.css',
  '/static/logo.png',
  '/static/js/utils.js',
  '/static/js/api.js',
  '/static/js/charts.js',
  '/static/js/ui.js',
  '/static/js/map.js',
  '/static/js/nutrition.js',
  '/static/js/calendar.js',
  '/static/js/dashboard.js',
  '/static/js/activity_detail.js',
  '/static/js/health.js',
  '/static/js/pbs.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('PWA Asset pre-cache partial error:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Network-only for API and dynamic endpoints
  if (url.pathname.startsWith('/api') || event.request.method !== 'GET') {
    return;
  }

  // Network first with cache fallback for HTML pages
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/'))
    );
    return;
  }

  // Stale-while-revalidate for static assets
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
