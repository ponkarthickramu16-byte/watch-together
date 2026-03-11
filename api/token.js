const { AccessToken } = require("livekit-server-sdk");

module.exports = async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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
        return res.status(500).json({ error: "credentials missing" });
    }

    const token = new AccessToken(apiKey, apiSecret, {
        identity: participantName,
    });

    token.addGrant({
        room: roomName,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
    });

    const jwt = await token.toJwt();
    return res.status(200).json({ token: jwt });
};