import { rateLimit, getClientIP } from "./rateLimit.js";

export default async function handler(req, res) {
    // ✅ CORS
    res.setHeader("Access-Control-Allow-Origin", "https://watch-together-xi.vercel.app");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(200).end();

    // ✅ Only GET allowed
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    // ✅ RATE LIMIT — 10 token requests per IP per minute
    // (A user joins a call once, so 10 is very generous)
    const ip = getClientIP(req);
    const limit = rateLimit(`token:${ip}`, 10, 60000);

    res.setHeader("X-RateLimit-Limit", "10");
    res.setHeader("X-RateLimit-Remaining", String(limit.remaining));

    if (!limit.allowed) {
        return res.status(429).json({
            error: "Too many requests. 1 minute wait பண்ணு.",
            resetIn: Math.ceil(limit.resetIn / 1000),
        });
    }

    // ✅ Validate params
    const { roomName, participantName } = req.query;
    if (!roomName || !participantName) {
        return res.status(400).json({ error: "roomName and participantName required" });
    }

    // Basic sanity check - no weird characters
    if (roomName.length > 100 || participantName.length > 100) {
        return res.status(400).json({ error: "Parameters too long" });
    }

    try {
        const { AccessToken } = await import("livekit-server-sdk");
        const token = new AccessToken(
            process.env.LIVEKIT_API_KEY,
            process.env.LIVEKIT_API_SECRET,
            { identity: participantName, ttl: "2h" }
        );
        token.addGrant({
            room: roomName,
            roomJoin: true,
            canPublish: true,
            canSubscribe: true,
        });
        const jwt = await token.toJwt();
        return res.status(200).json({ token: jwt });
    } catch (err) {
        console.error("Token generation error:", err);
        return res.status(500).json({ error: "Token generation failed" });
    }
}