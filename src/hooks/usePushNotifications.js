// src/hooks/usePushNotifications.js
import { useEffect, useRef } from "react";
import { db } from "../firebase";
import { doc, setDoc, deleteDoc } from "firebase/firestore";
import { getMessaging, getToken } from "firebase/messaging";
import { getApp } from "firebase/app";

export function usePushNotifications({ roomId, username, enabled = true }) {
    const tokenDocRef = useRef(null);

    useEffect(() => {
        if (!roomId || !username || !enabled) return;
        if (!("Notification" in window) || !("serviceWorker" in navigator)) return;

        const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;
        if (!VAPID_KEY) return; // silent — no key configured

        let cancelled = false;

        const register = async () => {
            try {
                const permission = await Notification.requestPermission();
                if (permission !== "granted" || cancelled) return;

                const registration = await navigator.serviceWorker.register(
                    "/firebase-messaging-sw.js",
                    { scope: "/" }
                );

                if (cancelled) return;

                const messaging = getMessaging(getApp());
                const token = await getToken(messaging, {
                    vapidKey: VAPID_KEY,
                    serviceWorkerRegistration: registration,
                });

                if (!token || cancelled) return;

                const docId = `${roomId}_${username}`;
                tokenDocRef.current = doc(db, "fcmTokens", docId);
                await setDoc(tokenDocRef.current, {
                    roomId,
                    username,
                    token,
                    updatedAt: new Date(),
                });
            } catch (err) {
                if (err?.code !== "messaging/permission-blocked") {
                    console.warn("[push]", err?.message);
                }
            }
        };

        register();

        return () => {
            cancelled = true;
            if (tokenDocRef.current) {
                deleteDoc(tokenDocRef.current).catch(() => { });
                tokenDocRef.current = null;
            }
        };
    }, [roomId, username, enabled]);
}