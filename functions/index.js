/* eslint-disable */
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

initializeApp();

exports.cleanupOldRooms = onSchedule(
    {
        schedule: "30 18 * * *",
        timeZone: "Asia/Kolkata",
        region: "asia-south1",
    },
    async (event) => {
        const db = getFirestore();
        const now = Timestamp.now();
        const cutoff = Timestamp.fromMillis(now.toMillis() - 24 * 60 * 60 * 1000);

        console.log("Cleanup started. Cutoff:", cutoff.toDate().toISOString());

        let deletedRooms = 0;
        let deletedChats = 0;
        let deletedReactions = 0;

        try {
            // 1. Old rooms
            const oldRooms = await db.collection("rooms").where("createdAt", "<", cutoff).get();
            const roomIds = [];
            const roomBatch = db.batch();
            oldRooms.forEach((doc) => {
                roomIds.push(doc.data().roomId);
                roomBatch.delete(doc.ref);
                deletedRooms++;
            });
            if (deletedRooms > 0) await roomBatch.commit();

            // 2. Chats for those rooms (chunks of 10)
            for (let i = 0; i < roomIds.length; i += 10) {
                const chunk = roomIds.slice(i, i + 10);
                if (!chunk.length) continue;
                const snap = await db.collection("chats").where("roomId", "in", chunk).get();
                const batch = db.batch();
                snap.forEach((doc) => { batch.delete(doc.ref); deletedChats++; });
                if (!snap.empty) await batch.commit();
            }

            // 3. Reactions for those rooms
            for (let i = 0; i < roomIds.length; i += 10) {
                const chunk = roomIds.slice(i, i + 10);
                if (!chunk.length) continue;
                const snap = await db.collection("reactions").where("roomId", "in", chunk).get();
                const batch = db.batch();
                snap.forEach((doc) => { batch.delete(doc.ref); deletedReactions++; });
                if (!snap.empty) await batch.commit();
            }

            console.log(`Done! Rooms: ${deletedRooms}, Chats: ${deletedChats}, Reactions: ${deletedReactions}`);
        } catch (err) {
            console.error("Cleanup error:", err);
            throw err;
        }
    }
);