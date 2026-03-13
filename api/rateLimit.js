// ✅ Simple in-memory rate limiter for Vercel serverless
// Each function call gets fresh memory, but within a single execution window this works

const rateLimitMap = new Map();

/**
 * Rate limit helper
 * @param {string} key - IP or user identifier
 * @param {number} maxRequests - max allowed in window
 * @param {number} windowMs - time window in milliseconds
 * @returns {{ allowed: boolean, remaining: number, resetIn: number }}
 */
export function rateLimit(key, maxRequests = 20, windowMs = 60000) {
    const now = Date.now();
    const entry = rateLimitMap.get(key);

    if (!entry || now > entry.resetAt) {
        // New window
        rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, remaining: maxRequests - 1, resetIn: windowMs };
    }

    entry.count++;
    const remaining = Math.max(0, maxRequests - entry.count);
    const resetIn = entry.resetAt - now;

    if (entry.count > maxRequests) {
        return { allowed: false, remaining: 0, resetIn };
    }

    return { allowed: true, remaining, resetIn };
}

/**
 * Get client IP from Vercel request
 */
export function getClientIP(req) {
    return (
        req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
        req.headers["x-real-ip"] ||
        req.socket?.remoteAddress ||
        "unknown"
    );
}