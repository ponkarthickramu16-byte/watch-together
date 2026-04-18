// api/drive-proxy.js — Vercel Serverless Function (Node.js runtime)
// Streams Google Drive video through Vercel so the browser never hits
// drive.google.com directly (avoids CORS / CSP blocks).

import https from "https";
import http from "http";

export const config = {
    api: {
        responseLimit: false,
        bodyParser: false,
    },
};

/**
 * Follow redirects manually so we can forward the Range header at every hop.
 * fetch() drops Range headers on redirect — that breaks video seeking.
 */
function driveRequest(url, headers, redirectsLeft = 6) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith("https") ? https : http;
        const req = lib.get(url, { headers }, (res) => {
            if (
                [301, 302, 303, 307, 308].includes(res.statusCode) &&
                res.headers.location &&
                redirectsLeft > 0
            ) {
                return driveRequest(res.headers.location, headers, redirectsLeft - 1)
                    .then(resolve)
                    .catch(reject);
            }
            resolve(res);
        });
        req.on("error", reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error("timeout")); });
    });
}

export default async function handler(req, res) {
    const { id } = req.query;

    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
        return res.status(400).send("Missing or invalid file id");
    }

    const driveUrl = `https://drive.google.com/uc?export=download&id=${id}&confirm=t`;

    const upstreamHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Referer": "https://drive.google.com/",
        "Origin": "https://drive.google.com",
    };

    if (req.headers["range"]) {
        upstreamHeaders["Range"] = req.headers["range"];
    }

    let upstream;
    try {
        upstream = await driveRequest(driveUrl, upstreamHeaders);
    } catch (err) {
        console.error("[drive-proxy] upstream error:", err.message);
        return res.status(502).send("Upstream error: " + err.message);
    }

    if (upstream.statusCode === 403) {
        return res.status(403).send(
            "Google Drive 403 — file sharing-ஐ 'Anyone with the link' → Viewer ஆக மாத்து."
        );
    }

    const forward = ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"];
    for (const h of forward) {
        if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]);
    }
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("Access-Control-Allow-Origin", "*");

    res.status(upstream.statusCode);
    upstream.pipe(res);
}