// api/drive-proxy.js — CommonJS Node.js (Vercel Serverless)
const https = require("https");
const http = require("http");

module.exports = async function handler(req, res) {
    const { id } = req.query;

    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
        return res.status(400).send("Invalid file id");
    }

    // CORS preflight
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") return res.status(200).end();

    function request(url, headers, hops) {
        return new Promise((resolve, reject) => {
            if (hops <= 0) return reject(new Error("Too many redirects"));
            const lib = url.startsWith("https") ? https : http;
            const req = lib.get(url, { headers }, (r) => {
                if ([301,302,303,307,308].includes(r.statusCode) && r.headers.location) {
                    return request(r.headers.location, headers, hops - 1).then(resolve).catch(reject);
                }
                resolve(r);
            });
            req.on("error", reject);
            req.setTimeout(20000, () => { req.destroy(); reject(new Error("timeout")); });
        });
    }

    const url = `https://drive.google.com/uc?export=download&id=${id}&confirm=t`;
    const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Referer": "https://drive.google.com/",
    };
    if (req.headers.range) headers["Range"] = req.headers.range;

    let upstream;
    try {
        upstream = await request(url, headers, 8);
    } catch (err) {
        console.error("[drive-proxy] error:", err.message);
        return res.status(502).send("Proxy error: " + err.message);
    }

    if (upstream.statusCode === 403) {
        return res.status(403).send("Drive 403 — file sharing 'Anyone with the link' → Viewer ஆக மாத்து");
    }

    ["content-type","content-length","content-range","accept-ranges"].forEach(h => {
        if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]);
    });
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.status(upstream.statusCode);
    upstream.pipe(res);
};