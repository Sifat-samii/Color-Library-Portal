function securityHeaders(req, res, next) {
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "connect-src 'self'"
  ].join("; "));
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", req.path.startsWith("/api/plugin/") ? "cross-origin" : "same-origin");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
  if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
}

function sameOriginRequest(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const requestHost = String(req.headers.host || "").toLowerCase();
    return originUrl.host.toLowerCase() === requestHost;
  } catch (_error) {
    return false;
  }
}

function protectUnsafeRequests(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (String(req.headers["sec-fetch-site"] || "").toLowerCase() === "cross-site" || !sameOriginRequest(req)) {
    return res.status(403).json({ error: "Cross-origin request blocked" });
  }
  next();
}

function createRateLimiter({ windowMs = 15 * 60 * 1000, limit = 30 } = {}) {
  const attempts = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = `${String(req.socket?.remoteAddress || "unknown")}|${String(req.ip || "unknown")}`;
    let entry = attempts.get(key);
    if (!entry || entry.resetAt <= now) entry = { count: 0, resetAt: now + windowMs };
    entry.count += 1;
    attempts.set(key, entry);
    if (attempts.size > 10000) {
      for (const [candidate, value] of attempts) if (value.resetAt <= now) attempts.delete(candidate);
      while (attempts.size > 10000) attempts.delete(attempts.keys().next().value);
    }
    res.setHeader("RateLimit-Limit", String(limit));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, limit - entry.count)));
    res.setHeader("RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));
    if (entry.count > limit) {
      res.setHeader("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: "Too many sign-in attempts. Please try again shortly." });
    }
    next();
  };
}

module.exports = { securityHeaders, protectUnsafeRequests, createRateLimiter };
