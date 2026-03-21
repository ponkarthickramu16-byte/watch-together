// public/firebase-messaging-sw.js

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Firebase config - filled at runtime via message from app
let messaging = null;

// Handle GET_FCM_TOKEN request from main app
self.addEventListener("message", async (event) => {
    if (event.data?.type !== "GET_FCM_TOKEN") return;

    const port = event.ports[0];
    const vapidKey = event.data.vapidKey;

    try {
        // Initialize Firebase in SW if not done yet
        if (!messaging) {
            // Get config from IndexedDB (set by app on first load)
            const config = await getFirebaseConfig();
            if (!config) {
                port.postMessage({ error: "No Firebase config in SW" });
                return;
            }
            if (!firebase.apps.length) firebase.initializeApp(config);
            messaging = firebase.messaging();
        }

        const token = await messaging.getToken({ vapidKey });
        port.postMessage({ token });
    } catch (err) {
        port.postMessage({ error: err.message });
    }
});

// Store/retrieve Firebase config via IndexedDB
async function getFirebaseConfig() {
    return new Promise((resolve) => {
        const req = indexedDB.open("fcm-config", 1);
        req.onupgradeneeded = (e) => e.target.result.createObjectStore("config");
        req.onsuccess = (e) => {
            const tx = e.target.result.transaction("config", "readonly");
            const store = tx.objectStore("config");
            const get = store.get("firebaseConfig");
            get.onsuccess = () => resolve(get.result || null);
            get.onerror = () => resolve(null);
        };
        req.onerror = () => resolve(null);
    });
}

// Handle background push messages
self.addEventListener("push", (event) => {
    if (!event.data) return;
    try {
        const payload = event.data.json();
        const { title, body, icon } = payload.notification || {};
        event.waitUntil(
            self.registration.showNotification(title || "Watch Together 🎬", {
                body: body || "New message",
                icon: icon || "/icons/icon-192x192.png",
                tag: payload.data?.roomId || "watch-together",
                data: payload.data,
            })
        );
    } catch { }
});

// Notification click → open room
self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const roomId = event.notification.data?.roomId;
    const url = roomId ? `/room/${roomId}` : "/";
    event.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
            for (const c of list) {
                if (c.url.includes(url) && "focus" in c) return c.focus();
            }
            return clients.openWindow(url);
        })
    );
});