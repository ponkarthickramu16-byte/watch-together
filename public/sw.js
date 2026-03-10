const CACHE_NAME = 'watch-together-v1';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

// ✅ Fix - localhost requests block பண்ணாம விடு
self.addEventListener('fetch', (event) => {
    // localhost-ல cache bypass பண்ணு
    if (
        event.request.url.includes('localhost') ||
        event.request.url.includes('firestore') ||
        event.request.url.includes('firebase') ||
        event.request.url.includes('cloudinary') ||
        event.request.url.includes('youtube')
    ) {
        return; // Cache bypass - direct network request
    }

    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        }).catch(() => {
            return fetch(event.request);
        })
    );
});