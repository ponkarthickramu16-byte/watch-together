const CACHE_VERSION = 'v4';
const CACHE_NAME = `watch-together-${CACHE_VERSION}`;

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.map(key => caches.delete(key)))
        )
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            self.clients.claim(),
            caches.keys().then(keys =>
                Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
            )
        ])
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // Skip chrome-extension and non-http requests
    if (!url.protocol.startsWith('http')) return;

    // Never cache JS/CSS/assets — always network
    if (url.pathname.includes('/assets/') ||
        url.pathname.endsWith('.js') ||
        url.pathname.endsWith('.css') ||
        url.pathname.endsWith('.jsx')) {
        event.respondWith(
            fetch(event.request).catch(() => new Response('Network error', { status: 503 }))
        );
        return;
    }

    // Navigation: network first, fallback to index.html
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // Only cache valid responses
                    if (response && response.status === 200 && response.type === 'basic') {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return response;
                })
                .catch(() => caches.match('/index.html')
                    .then(cached => cached || new Response('Offline', { status: 503 }))
                )
        );
        return;
    }

    // Default: network only (no caching)
    event.respondWith(
        fetch(event.request).catch(() => new Response('Network error', { status: 503 }))
    );
});