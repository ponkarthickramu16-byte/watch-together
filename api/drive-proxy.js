// api/drive-proxy.js  — Vercel Serverless Function
// Proxies Google Drive video so the browser never hits drive.google.com directly.
// This avoids the 403 "only owner can download" restriction on large files.

export const config = { runtime: "edge" };

export default async function handler(req) {
    const { searchParams } = new URL(req.url);
    const fileId = searchParams.get("id");

    if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId)) {
        return new Response("Missing or invalid file id", { status: 400 });
    }

    // Google Drive direct download URL
    const driveUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;

    // Forward Range header so browser can seek (partial content requests)
    const headers = { "User-Agent": "Mozilla/5.0" };
    const range = req.headers.get("range");
    if (range) headers["Range"] = range;

    let res;
    try {
        res = await fetch(driveUrl, { headers, redirect: "follow" });
    } catch (e) {
        return new Response("Upstream fetch failed: " + e.message, { status: 502 });
    }

    // Build response headers — pass through Content-Type, Content-Range, Content-Length
    const resHeaders = new Headers();
    for (const key of ["content-type", "content-range", "content-length", "accept-ranges"]) {
        const val = res.headers.get(key);
        if (val) resHeaders.set(key, val);
    }
    // Allow browser video player to make range requests
    resHeaders.set("Accept-Ranges", "bytes");
    // Cache 1 hour — avoids hammering Drive on every seek
    resHeaders.set("Cache-Control", "public, max-age=3600");

    return new Response(res.body, {
        status: res.status,
        headers: resHeaders,
    });
}
