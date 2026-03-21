// src/hooks/usePushNotifications.js
// Call this hook inside Room component to register/unregister FCM token

import { useEffect, useRef } from "react";
import { db } from "../firebase";
import { doc, setDoc, deleteDoc } from "firebase/firestore";

// Dynamically import FCM to avoid breaking app if browser doesn't support it
async function getFCM() {
    try {
        const { initializeApp, getApps } = await import("firebase/app");
        const { getMessaging, getToken, deleteToken } = await import("firebase/messaging");
        // Use the same firebase app already initialized
        const app = getApps()[0];
        if (!app) return null;
        const messaging = getMessaging(app);
        return { messaging, getToken, deleteToken };
    } catch {
        return null;
    }
}

export function usePushNotifications({ roomId, username, enabled = true }) {
    const tokenDocRef = useRef(null);

    useEffect(() => {
        if (!roomId || !username || !enabled) return;
        if (!("Notification" in window) || !("serviceWorker" in navigator)) return;

        let cancelled = false;
        let currentToken = null;

        const register = async () => {
            try {
                // Request permission
                const permission = await Notification.requestPermission();
                if (permission !== "granted" || cancelled) return;

                // Register service worker
                const registration = await navigator.serviceWorker.register(
                    "/firebase-messaging-sw.js",
                    { scope: "/" }
                );

                const fcm = await getFCM();
                if (!fcm || cancelled) return;

                const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;
                if (!VAPID_KEY) {
                    console.warn("[push] VITE_FIREBASE_VAPID_KEY not set — push disabled");
                    return;
                }

                const token = await fcm.getToken(fcm.messaging, {
                    vapidKey: VAPID_KEY,
                    serviceWorkerRegistration: registration,
                });

                if (!token || cancelled) return;
                currentToken = token;

                // Save token to Firestore: fcmTokens/{roomId}_{username}
                const docId = `${roomId}_${username}`;
                tokenDocRef.current = doc(db, "fcmTokens", docId);
                await setDoc(tokenDocRef.current, {
                    roomId,
                    username,
                    token,
                    updatedAt: new Date(),
                });
            } catch (err) {
                // Permission denied or FCM error — silent, notifications just won't work
                if (err.code !== "messaging/permission-blocked") {
                    console.warn("[push] registration error:", err.message);
                }
            }
        };

        register();

        return () => {
            cancelled = true;
            // Remove token from Firestore on unmount (leave room)
            if (tokenDocRef.current) {
                deleteDoc(tokenDocRef.current).catch(() => { });
                tokenDocRef.current = null;
            }
        };
    }, [roomId, username, enabled]);
}