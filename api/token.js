// api/token.js - Vercel Serverless Function
// Render.com தேவையில்லை - இதுவே token குடுக்கும்!

export default async function handler(req, res) {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    const { roomName, participantName } = req.query;

    if (!roomName || !participantName) {
        return res.status(400).json({ error: "roomName and participantName required" });
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
        return res.status(500).json({ error: "LiveKit credentials not configured" });
    }

    try {
        // livekit-server-sdk import
        const { AccessToken } = await import("livekit-server-sdk");

        const token = new AccessToken(apiKey, apiSecret, {
            identity: participantName,
            ttl: "2h",
        });

        token.addGrant({
            room: roomName,
            roomJoin: true,
            canPublish: true,
            canSubscribe: true,
            canPublishData: true,
        });

        const jwt = await token.toJwt();
        return res.status(200).json({ token: jwt });

    } catch (err) {
        console.error("Token generation error:", err);
        return res.status(500).json({ error: "Token generation failed: " + err.message });
    }
}