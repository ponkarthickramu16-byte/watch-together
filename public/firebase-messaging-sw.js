// Firebase Cloud Messaging Service Worker
// Place this file at: public/firebase-messaging-sw.js

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// These values are safe to expose in service workers (public-facing)
firebase.initializeApp({
    apiKey: self.FIREBASE_API_KEY || "AIzaSyCss9Or_TogWM8qwsw8W1V2RXbRv_K-SjI",
    authDomain: self.FIREBASE_AUTH_DOMAIN || "watch-together-948fc.firebaseapp.com",
    projectId: self.FIREBASE_PROJECT_ID || "watch-together-948fc",
    storageBucket: self.FIREBASE_STORAGE_BUCKET || "watch-together-948fc.firebasestorage.app",
    messagingSenderId: self.FIREBASE_MESSAGING_SENDER_ID || "1035918618075",
    appId: self.FIREBASE_APP_ID || "1:1035918618075:web:acad5e56343f0b59688bfe",
});

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
    const { title, body, icon } = payload.notification || {};
    self.registration.showNotification(title || "Watch Together 🎬", {
        body: body || "New message!",
        icon: icon || "/icons/icon-192x192.png",
        badge: "/icons/icon-72x72.png",
        tag: payload.data?.roomId || "watch-together",
        data: payload.data,
        actions: [
            { action: "open", title: "Open Room" },
        ],
    });
});

// Click on notification → open the room
self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const roomId = event.notification.data?.roomId;
    const url = roomId ? `/room/${roomId}` : "/";
    event.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url.includes(url) && "focus" in client) return client.focus();
            }
            return clients.openWindow(url);
        })
    );
});