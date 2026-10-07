const crypto = require("crypto");
const config = require("./config");
const db = require("./db");
const { createSession } = require("./security");
const { writeAudit } = require("./audit");

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
let keyCache = { expiresAt: 0, keys: new Map() };

function safeReturnTo(value) {
  const candidate = String(value || "/").trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) return "/";
  return candidate.slice(0, 1000);
}

function base64UrlHash(value) {
  return crypto.createHash("sha256").update(value).digest("base64url");
}

function decodePart(value) {
  if (!value || value.length > 16384 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Google returned an invalid identity token");
  const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Google returned an invalid identity token");
  return parsed;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      ...options,
      redirect: "error",
      headers: { Accept: "application/json", ...(options.headers || {}) },
      signal: controller.signal
    });
    const text = await response.text();
    if (text.length > 1024 * 1024) throw new Error("Google returned an oversized authentication response");
    const body = (() => { try { return JSON.parse(text); } catch (_error) { return {}; } })();
    if (!response.ok) {
      const error = new Error(body.error_description || body.error || "Google authentication failed");
      error.status = 502;
      throw error;
    }
    return { body, headers: response.headers };
  } finally {
    clearTimeout(timeout);
  }
}

async function googleKey(keyId) {
  const now = Date.now();
  if (keyCache.expiresAt > now && keyCache.keys.has(keyId)) return keyCache.keys.get(keyId);
  const { body, headers } = await fetchJson(GOOGLE_JWKS_URL);
  const maxAge = Number((headers.get("cache-control") || "").match(/max-age=(\d+)/)?.[1] || 3600);
  keyCache = {
    expiresAt: now + Math.max(60, Math.min(maxAge, 86400)) * 1000,
    keys: new Map((body.keys || [])
      .filter(key => key?.kid && key.kty === "RSA" && (!key.use || key.use === "sig") && (!key.alg || key.alg === "RS256"))
      .map(key => [key.kid, key]))
  };
  return keyCache.keys.get(keyId);
}

function validateGoogleClaims(claims, expectedNonce, now = Math.floor(Date.now() / 1000)) {
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const issuedAt = Number(claims.iat || 0);
  const expiresAt = Number(claims.exp || 0);
  const notBefore = claims.nbf == null ? null : Number(claims.nbf);
  if (!GOOGLE_ISSUERS.has(claims.iss) || !audience.includes(config.google.clientId)) throw new Error("Google identity verification failed");
  if ((audience.length > 1 && claims.azp !== config.google.clientId) || (claims.azp && claims.azp !== config.google.clientId)) {
    throw new Error("Google identity verification failed");
  }
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt > now + 300 || issuedAt < now - 900
    || expiresAt <= now - 60 || expiresAt > now + 7200 || (notBefore != null && (!Number.isFinite(notBefore) || notBefore > now + 300))) {
    throw new Error("Google identity verification failed");
  }
  if (!safeEqual(claims.nonce, expectedNonce) || claims.email_verified !== true) throw new Error("Google identity verification failed");
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 255
    || typeof claims.email !== "string" || claims.email.length > 320) {
    throw new Error("Google did not provide a verified email address");
  }
  const email = claims.email.trim().toLowerCase();
  const emailDomain = email.split("@")[1] || "";
  if (config.google.allowedDomains.length
    && (!claims.hd || !config.google.allowedDomains.includes(String(claims.hd).toLowerCase()) || !config.google.allowedDomains.includes(emailDomain))) {
    throw new Error("This Google Workspace domain is not authorized");
  }
  return claims;
}

async function verifyGoogleIdToken(token, expectedNonce) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || String(token).length > 32768) throw new Error("Google returned an invalid identity token");
  const header = decodePart(parts[0]);
  const claims = decodePart(parts[1]);
  if (header.alg !== "RS256" || !header.kid) throw new Error("Google returned an unsupported identity token");
  const jwk = await googleKey(header.kid);
  if (!jwk) throw new Error("Google signing key is unavailable");
  const valid = crypto.verify(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    crypto.createPublicKey({ key: jwk, format: "jwk" }),
    Buffer.from(parts[2], "base64url")
  );
  if (!valid) throw new Error("Google identity verification failed");
  return validateGoogleClaims(claims, expectedNonce);
}

function authErrorRedirect(message) {
  return `/?authError=${encodeURIComponent(String(message || "Sign-in failed").slice(0, 240))}`;
}

function registerGoogleAuth(app, { asyncRoute, authStartLimiter, authCallbackLimiter }) {
  app.get("/api/auth/config", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ googleEnabled: config.google.enabled, passwordEnabled: config.allowPasswordLogin });
  });

  app.get("/api/auth/google/start", authStartLimiter, asyncRoute(async (req, res) => {
    if (!config.google.enabled) return res.status(503).json({ error: "Google sign-in is not configured" });
    const state = crypto.randomBytes(32).toString("base64url");
    const nonce = crypto.randomBytes(32).toString("base64url");
    const verifier = crypto.randomBytes(48).toString("base64url");
    await db.transaction(async client => {
      await client.query("DELETE FROM oauth_login_states WHERE expires_at<=now()");
      await client.query(
        `INSERT INTO oauth_login_states(state_hash,nonce,code_verifier,return_to,expires_at)
         VALUES($1,$2,$3,$4,now()+interval '10 minutes')`,
        [base64UrlHash(state), nonce, verifier, safeReturnTo(req.query.returnTo)]
      );
    });
    const search = new URLSearchParams({
      client_id: config.google.clientId,
      redirect_uri: config.google.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: base64UrlHash(verifier),
      code_challenge_method: "S256",
      prompt: "select_account"
    });
    res.setHeader("Cache-Control", "no-store");
    res.redirect(`${GOOGLE_AUTH_URL}?${search}`);
  }));

  app.get("/api/auth/google/callback", authCallbackLimiter, asyncRoute(async (req, res) => {
    if (!config.google.enabled) return res.redirect(authErrorRedirect("Google sign-in is not configured"));
    if (req.query.error) return res.redirect(authErrorRedirect("Google sign-in was cancelled"));
    if (typeof req.query.code !== "string" || typeof req.query.state !== "string" || req.query.code.length > 4096 || req.query.state.length > 256) {
      return res.redirect(authErrorRedirect("The Google sign-in response was incomplete"));
    }
    try {
      const loginState = await db.transaction(async client => {
      const row = (await client.query(
        "SELECT * FROM oauth_login_states WHERE state_hash=$1 AND expires_at>now() FOR UPDATE",
        [base64UrlHash(req.query.state)]
      )).rows[0];
      if (row) await client.query("DELETE FROM oauth_login_states WHERE state_hash=$1", [row.state_hash]);
      return row;
    });
      if (!loginState) return res.redirect(authErrorRedirect("This sign-in link has expired. Please try again."));

      const tokenResponse = await fetchJson(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: String(req.query.code),
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        redirect_uri: config.google.redirectUri,
        grant_type: "authorization_code",
        code_verifier: loginState.code_verifier
      })
    });
      if (typeof tokenResponse.body.id_token !== "string") throw new Error("Google did not return an identity token");
      const claims = await verifyGoogleIdToken(tokenResponse.body.id_token, loginState.nonce);
      const email = String(claims.email).trim().toLowerCase();
      const user = await db.transaction(async client => {
      const subjectUser = (await client.query(
        `SELECT u.*,c.active AS client_active FROM users u
         LEFT JOIN clients c ON c.id=u.client_id
         WHERE u.google_subject=$1 FOR UPDATE OF u`,
        [claims.sub]
      )).rows[0];
      const emailUser = (await client.query(
        `SELECT u.*,c.active AS client_active FROM users u
         LEFT JOIN clients c ON c.id=u.client_id
         WHERE lower(u.email)=$1 FOR UPDATE OF u`,
        [email]
      )).rows[0];
      const authorized = subjectUser || emailUser;
      const companyActive = authorized?.role === "ADMIN" || (authorized?.role === "CLIENT" && authorized.client_active === true);
      if (!authorized || !authorized.active || !companyActive) return null;
      if (subjectUser && emailUser && subjectUser.id !== emailUser.id) {
        const error = new Error("This Google identity conflicts with another authorized account");
        error.status = 403;
        throw error;
      }
      if (authorized.google_subject && authorized.google_subject !== claims.sub) {
        const error = new Error("This email is already connected to a different Google account");
        error.status = 403;
        throw error;
      }
      return (await client.query(
        `UPDATE users SET google_subject=$1,google_connected_at=coalesce(google_connected_at,now()),last_login_at=now(),
                          display_name=coalesce(nullif(display_name,''),$2)
         WHERE id=$3 RETURNING *`,
        [claims.sub, String(claims.name || email).slice(0, 120), authorized.id]
      )).rows[0];
    });
      if (!user) return res.redirect(authErrorRedirect("This Gmail address has not been authorized. Ask your administrator for access."));
      await createSession(user.id, req, res);
      await writeAudit(db, { user, ip: req.ip }, { clientId: user.client_id, entityType: "session", entityId: user.id, action: "GOOGLE_LOGIN" });
      res.redirect(safeReturnTo(loginState.return_to));
    } catch (error) {
      console.warn("Google sign-in failed:", error.status === 403 ? error.message : error.name || "authentication error");
      if (!res.headersSent) res.redirect(authErrorRedirect(error.status === 403 ? error.message : "Google sign-in could not be completed. Please try again."));
    }
  }));
}

module.exports = { registerGoogleAuth, safeReturnTo, base64UrlHash, validateGoogleClaims, verifyGoogleIdToken };
