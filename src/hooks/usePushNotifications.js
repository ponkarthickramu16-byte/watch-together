// src/hooks/usePushNotifications.js
// Minimal version - no firebase/messaging import at module level
// Uses raw service worker postMessage to get FCM token

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
        if (!VAPID_KEY) return false;

        try {
            const permission = Notification.permission === "granted"
                ? "granted"
                : await Notification.requestPermission();
            if (permission !== "granted") return false;

            // Use service worker directly - no firebase/messaging import needed
            const sw = await navigator.serviceWorker.register(
                "/firebase-messaging-sw.js", { scope: "/" }
            );
            await navigator.serviceWorker.ready;

            // Ask SW to get FCM token for us
            const token = await new Promise((resolve, reject) => {
                const channel = new MessageChannel();
                channel.port1.onmessage = (e) => {
                    if (e.data?.token) resolve(e.data.token);
                    else reject(new Error(e.data?.error || "No token"));
                };
                sw.active?.postMessage(
                    { type: "GET_FCM_TOKEN", vapidKey: VAPID_KEY },
                    [channel.port2]
                );
                setTimeout(() => reject(new Error("Token timeout")), 10000);
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
            console.warn("[push]", err.message);
            return false;
        }
    }, [roomId, username]);

    // Auto-register if already permitted
    useEffect(() => {
        if (!enabled || !roomId || !username) return;
        if (Notification.permission === "granted" && !registeredRef.current) {
            registerToken();
        }
    }, [enabled, roomId, username, registerToken]);

    // Cleanup token on leave
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