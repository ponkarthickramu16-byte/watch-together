// api/notify.js — Vercel Serverless Function
// Triggered when a new chat message is sent to notify partner via FCM

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

// Initialize Firebase Admin (once)
if (!getApps().length) {
    initializeApp({
        credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        }),
    });
}

const db = getFirestore();
const messaging = getMessaging();

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    // Rate limit check (basic)
    const { roomId, senderUsername, messagePreview } = req.body || {};

    if (!roomId || !senderUsername) {
        return res.status(400).json({ error: "roomId and senderUsername required" });
    }

    try {
        // Get all FCM tokens for this room (excluding sender)
        const tokensSnap = await db
            .collection("fcmTokens")
            .where("roomId", "==", roomId)
            .where("username", "!=", senderUsername)
            .get();

        if (tokensSnap.empty) {
            return res.status(200).json({ sent: 0 });
        }

        const tokens = tokensSnap.docs.map((d) => d.data().token).filter(Boolean);
        if (tokens.length === 0) return res.status(200).json({ sent: 0 });

        // Send FCM notification
        const message = {
            notification: {
                title: `${senderUsername} 💬`,
                body: messagePreview || "New message in Watch Together",
            },
            data: { roomId },
            tokens,
        };

        const response = await messaging.sendEachForMulticast(message);

        // Clean up invalid tokens
        const invalidTokenDocs = [];
        response.responses.forEach((r, idx) => {
            if (!r.success && r.error?.code === "messaging/registration-token-not-registered") {
                invalidTokenDocs.push(tokensSnap.docs[idx].ref);
            }
        });
        if (invalidTokenDocs.length > 0) {
            const batch = db.batch();
            invalidTokenDocs.forEach((ref) => batch.delete(ref));
            await batch.commit();
        }

        return res.status(200).json({ sent: response.successCount });
    } catch (err) {
        console.error("[notify]", err);
        return res.status(500).json({ error: err.message });
    }
}