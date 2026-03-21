import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// ── Add this to the BOTTOM of your src/firebase.js ──────────────────────────
// Saves Firebase config to IndexedDB so Service Worker can access it
// (Service Workers can't read import.meta.env or Vite env vars)

function saveConfigForSW() {
    if (!("indexedDB" in window)) return;
    try {
        const config = {
            apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
            authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
            projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
            storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
            messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
            appId: import.meta.env.VITE_FIREBASE_APP_ID,
        };
        const req = indexedDB.open("fcm-config", 1);
        req.onupgradeneeded = (e) => e.target.result.createObjectStore("config");
        req.onsuccess = (e) => {
            const tx = e.target.result.transaction("config", "readwrite");
            tx.objectStore("config").put(config, "firebaseConfig");
        };
    } catch { }
}

saveConfigForSW();