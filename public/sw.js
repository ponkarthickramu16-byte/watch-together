// public/sw.js - Updated cache version to force cache clear
const CACHE_VERSION = 'v3';
const CACHE_NAME = `watch-together-${CACHE_VERSION}`;

// On install: clear ALL old caches
self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.map(key => caches.delete(key)))
        )
    );
});

// On activate: claim all clients immediately
self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            self.clients.claim(),
            // Delete all old caches
            caches.keys().then(keys =>
                Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
            )
        ])
    );
});

// Fetch: network-first, no caching for JS files (prevents stale code)
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Never cache JS/CSS chunks - always fetch fresh from network
    if (url.pathname.includes('/assets/') ||
        url.pathname.endsWith('.js') ||
        url.pathname.endsWith('.css')) {
        event.respondWith(fetch(event.request));
        return;
    }

    // For navigation requests - network first
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request).catch(() =>
                caches.match('/index.html')
            )
        );
        return;
    }

    // Default: network first
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});