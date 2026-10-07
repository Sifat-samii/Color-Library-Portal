const path = require("path");
const { connectionConfig } = require("./database-config");

const root = path.resolve(__dirname, "..");

function booleanSetting(name, fallback = false) {
  if (process.env[name] == null) return fallback;
  return String(process.env[name]).trim().toLowerCase() === "true";
}

function integerSetting(name, fallback, minimum, maximum) {
  if (process.env[name] == null || String(process.env[name]).trim() === "") return fallback;
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function listSetting(name) {
  return String(process.env[name] || "")
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
}

const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI || "";
const googleEnabled = Boolean(googleClientId && googleClientSecret && googleRedirectUri);
const production = process.env.NODE_ENV === "production";

const config = {
  production,
  port: integerSetting("PORT", 8787, 1, 65535),
  host: process.env.HOST || "0.0.0.0",
  database: connectionConfig(),
  sessionDays: integerSetting("SESSION_DAYS", 7, 1, 30),
  maxSessionsPerUser: integerSetting("MAX_SESSIONS_PER_USER", 10, 1, 100),
  cookieSecure: booleanSetting("COOKIE_SECURE", production),
  trustProxy: booleanSetting("TRUST_PROXY", false),
  google: {
    enabled: googleEnabled,
    clientId: googleClientId,
    clientSecret: googleClientSecret,
    redirectUri: googleRedirectUri,
    allowedDomains: listSetting("GOOGLE_ALLOWED_DOMAINS")
  },
  allowPasswordLogin: !production && booleanSetting("ALLOW_PASSWORD_LOGIN", !googleEnabled),
  storageRoot: path.resolve(root, process.env.STORAGE_ROOT || "storage"),
  publicRoot: path.resolve(root, "public")
};

function validateRuntimeConfig() {
  const googleValues = [googleClientId, googleClientSecret, googleRedirectUri];
  const configuredGoogleValues = googleValues.filter(Boolean).length;
  if (configuredGoogleValues > 0 && configuredGoogleValues < googleValues.length) {
    throw new Error("GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI must be configured together");
  }
  if (config.google.enabled) {
    let redirect;
    try { redirect = new URL(config.google.redirectUri); } catch (_error) {
      throw new Error("GOOGLE_REDIRECT_URI must be an absolute http(s) URL");
    }
    if (!["http:", "https:"].includes(redirect.protocol) || redirect.username || redirect.password || redirect.search || redirect.hash) {
      throw new Error("GOOGLE_REDIRECT_URI must be a clean absolute http(s) URL without credentials, query, or fragment");
    }
    if (redirect.pathname !== "/api/auth/google/callback") {
      throw new Error("GOOGLE_REDIRECT_URI must end at /api/auth/google/callback");
    }
    if (config.production && redirect.protocol !== "https:") {
      throw new Error("GOOGLE_REDIRECT_URI must use HTTPS in production");
    }
  }
  if (config.production && !config.google.enabled) {
    throw new Error("Google authentication must be configured in production");
  }
}

module.exports = { ...config, validateRuntimeConfig };
