// src/hooks/usePushNotifications.js
// Simple version - no dynamic import, no getMessaging (avoids circular dep)
// FCM token registration happens manually via button click only

import { useEffect, useRef, useCallback } from "react";
import { db } from "../firebase";
import { doc, setDoc, deleteDoc } from "firebase/firestore";

export function usePushNotifications({ roomId, username, enabled = true }) {
    const tokenDocRef = useRef(null);
    const registeredRef = useRef(false);

    const registerToken = useCallback(async () => {
        if (!roomId || !username) return false;
        if (!("Notification" in window) || !("serviceWorker" in navigator)) return false;

        const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;
        if (!VAPID_KEY) {
            console.warn("[push] VITE_FIREBASE_VAPID_KEY not set");
            return false;
        }

        try {
            const permission = Notification.permission === "granted"
                ? "granted"
                : await Notification.requestPermission();
            if (permission !== "granted") return false;

            // Lazy-load firebase/messaging ONLY when needed to avoid circular dep
            const { getMessaging, getToken } = await import("firebase/messaging");

            const sw = await navigator.serviceWorker.register(
                "/firebase-messaging-sw.js", { scope: "/" }
            );

            const messaging = getMessaging();
            const token = await getToken(messaging, {
                vapidKey: VAPID_KEY,
                serviceWorkerRegistration: sw,
            });

            if (!token) return false;

            const docId = `${roomId}_${username}`;
            tokenDocRef.current = doc(db, "fcmTokens", docId);
            await setDoc(tokenDocRef.current, {
                roomId, username, token, updatedAt: new Date(),
            });

            registeredRef.current = true;
            return true;
        } catch (err) {
            console.warn("[push] error:", err.message);
            return false;
        }
    }, [roomId, username]);

    // Auto-register if permission already granted (user previously allowed)
    useEffect(() => {
        if (!enabled || !roomId || !username) return;
        if (Notification.permission === "granted" && !registeredRef.current) {
            registerToken();
        }
    }, [enabled, roomId, username, registerToken]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (tokenDocRef.current) {
                deleteDoc(tokenDocRef.current).catch(() => { });
                tokenDocRef.current = null;
            }
        };
    }, []);

    return { registerToken };
}