import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

// Initialize Firebase Admin (only once)
if (!getApps().length) {
    initializeApp({
        credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        }),
    });
}

export default async function handler(req, res) {
    // ✅ Only allow Vercel cron calls (or manual GET with secret)
    const authHeader = req.headers["authorization"];
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    if (req.method !== "GET") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const db = getFirestore();
    const now = Timestamp.now();
    // 24 hours ago
    const cutoff = Timestamp.fromMillis(now.toMillis() - 24 * 60 * 60 * 1000);

    let deletedRooms = 0;
    let deletedChats = 0;
    let deletedReactions = 0;

    try {
        // 1. Find old rooms
        const oldRooms = await db
            .collection("rooms")
            .where("createdAt", "<", cutoff)
            .get();

        const roomIds = [];
        for (const docSnap of oldRooms.docs) {
            roomIds.push(docSnap.data().roomId);
            await docSnap.ref.delete();
            deletedRooms++;
        }

        // 2. Delete chats for those rooms (chunks of 10)
        for (let i = 0; i < roomIds.length; i += 10) {
            const chunk = roomIds.slice(i, i + 10);
            if (!chunk.length) continue;
            const snap = await db.collection("chats").where("roomId", "in", chunk).get();
            for (const d of snap.docs) { await d.ref.delete(); deletedChats++; }
        }

        // 3. Delete reactions
        for (let i = 0; i < roomIds.length; i += 10) {
            const chunk = roomIds.slice(i, i + 10);
            if (!chunk.length) continue;
            const snap = await db.collection("reactions").where("roomId", "in", chunk).get();
            for (const d of snap.docs) { await d.ref.delete(); deletedReactions++; }
        }

        console.log(`Cleanup done: ${deletedRooms} rooms, ${deletedChats} chats, ${deletedReactions} reactions`);

        return res.status(200).json({
            success: true,
            deletedRooms,
            deletedChats,
            deletedReactions,
            cutoff: cutoff.toDate().toISOString(),
        });
    } catch (err) {
        console.error("Cleanup error:", err);
        return res.status(500).json({ error: err.message });
    }
}