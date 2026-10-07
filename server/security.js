const crypto = require("crypto");
const { promisify } = require("util");
const { query } = require("./db");
const config = require("./config");

const scrypt = promisify(crypto.scrypt);
const SESSION_CACHE_TTL_MS = 10000;
const SESSION_CACHE_LIMIT = 1000;
const sessionCache = new Map();
const sessionLookups = new Map();

function forgetSession(hash) {
  sessionCache.delete(hash);
  sessionLookups.delete(hash);
}

async function revokeUserSessions(userId) {
  await query("DELETE FROM sessions WHERE user_id=$1", [userId]);
  for (const [hash, entry] of sessionCache) {
    if (entry.user && entry.user.id === userId) forgetSession(hash);
  }
}

async function revokeClientSessions(clientId) {
  await query("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE client_id=$1)", [clientId]);
  for (const [hash, entry] of sessionCache) {
    if (entry.user && entry.user.client_id === clientId) forgetSession(hash);
  }
}

function rememberSession(hash, user) {
  if (sessionCache.size >= SESSION_CACHE_LIMIT) sessionCache.delete(sessionCache.keys().next().value);
  sessionCache.set(hash, { user, expiresAt: Date.now() + SESSION_CACHE_TTL_MS });
}

async function lookupSession(hash) {
  const cached = sessionCache.get(hash);
  if (cached && cached.expiresAt > Date.now()) return cached.user;
  if (cached) sessionCache.delete(hash);
  if (sessionLookups.has(hash)) return sessionLookups.get(hash);
  const pending = query(
    `SELECT u.id, u.email, u.display_name, u.role, u.client_id
     FROM sessions s
     JOIN users u ON u.id=s.user_id
     LEFT JOIN clients c ON c.id=u.client_id
     WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true
       AND (u.role='ADMIN' OR (u.role='CLIENT' AND c.active=true))`,
    [hash]
  ).then(result => {
    const user = result.rows[0] || null;
    rememberSession(hash, user);
    return user;
  }).finally(() => sessionLookups.delete(hash));
  sessionLookups.set(hash, pending);
  return pending;
}

async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 7 || password.length > 1024) {
    throw new Error("Password must be between 7 and 1024 characters");
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${Buffer.from(derived).toString("hex")}`;
}

async function verifyPassword(password, encoded) {
  if (typeof password !== "string" || password.length > 1024) return false;
  const parts = String(encoded || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt" || !/^[0-9a-f]{32}$/i.test(parts[1]) || !/^[0-9a-f]{128}$/i.test(parts[2])) return false;
  const derived = await scrypt(password, parts[1], 64);
  const expected = Buffer.from(parts[2], "hex");
  return expected.length === derived.length && crypto.timingSafeEqual(expected, Buffer.from(derived));
}

function parseCookies(header) {
  return String(header || "").split(";").reduce((result, part) => {
    const index = part.indexOf("=");
    if (index > 0) {
      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      if (!key || value.length > 4096) return result;
      try { result[key] = decodeURIComponent(value); } catch (_error) { result[key] = value; }
    }
    return result;
  }, {});
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function createSession(userId, req, res) {
  const previousToken = parseCookies(req.headers.cookie).acl_session;
  if (previousToken) {
    const previousHash = tokenHash(previousToken);
    await query("DELETE FROM sessions WHERE token_hash=$1", [previousHash]);
    forgetSession(previousHash);
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + config.sessionDays * 86400000);
  await query("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES($1,$2,$3)", [tokenHash(token), userId, expires]);
  const retired = await query(
    `DELETE FROM sessions WHERE token_hash IN (
       SELECT token_hash FROM sessions WHERE user_id=$1 ORDER BY created_at DESC OFFSET $2
     ) RETURNING token_hash`,
    [userId, config.maxSessionsPerUser]
  );
  for (const row of retired.rows) forgetSession(row.token_hash);
  const secure = req.secure || config.cookieSecure ? "; Secure" : "";
  res.setHeader("Set-Cookie", `acl_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${config.sessionDays * 86400}; Priority=High${secure}`);
}

async function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie).acl_session;
  if (token) {
    const hash = tokenHash(token);
    await query("DELETE FROM sessions WHERE token_hash=$1", [hash]);
    forgetSession(hash);
  }
  const secure = req.secure || config.cookieSecure ? "; Secure" : "";
  res.setHeader("Set-Cookie", `acl_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Priority=High${secure}`);
}

async function authenticate(req, _res, next) {
  try {
    const token = parseCookies(req.headers.cookie).acl_session;
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return next();
    req.user = await lookupSession(tokenHash(token));
    next();
  } catch (error) { next(error); }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Access denied" });
    next();
  };
}

module.exports = { hashPassword, verifyPassword, parseCookies, createSession, destroySession, revokeUserSessions, revokeClientSessions, authenticate, requireRole };
