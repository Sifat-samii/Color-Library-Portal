const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { safeSegment, ensureInside } = require("../server/sync");
const config = require("../server/config");
const { hashPassword, verifyPassword, parseCookies } = require("../server/security");
const { pool } = require("../server/db");
const { safeReturnTo, base64UrlHash, validateGoogleClaims } = require("../server/google-auth");
const { pluginCors, protectUnsafeRequests } = require("../server/http-security");
const { lanIPv4Addresses, portalUrls, listenOptions } = require("../server/studio-network");

async function main() {
  assert.equal(safeSegment('Wine: 01/02'), "Wine- 01-02");
  const root = path.resolve("managed-client");
  assert.doesNotThrow(() => ensureInside(root, path.join(root, "FULL", "Wine.jpg")));
  assert.throws(() => ensureInside(root, path.resolve(root, "..", "outside.jpg")));
  const encoded = await hashPassword("A-secure-test-password");
  assert.equal(await verifyPassword("A-secure-test-password", encoded), true);
  assert.equal(await verifyPassword("wrong-password", encoded), false);
  assert.equal(await verifyPassword("1234567", await hashPassword("1234567")), true);
  await assert.rejects(() => hashPassword("123456"), /between 7 and 1024/);
  assert.equal(safeReturnTo("/requests/123?client=abc"), "/requests/123?client=abc");
  assert.equal(safeReturnTo("https://evil.example"), "/");
  assert.equal(safeReturnTo("//evil.example"), "/");
  assert.equal(safeReturnTo("/\\evil"), "/");
  assert.equal(base64UrlHash("state"), base64UrlHash("state"));
  assert.deepEqual(parseCookies("good=value; malformed=%E0%A4%A; huge=" + "x".repeat(5000)), { good: "value", malformed: "%E0%A4%A" });

  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: "https://accounts.google.com",
    aud: config.google.clientId,
    sub: "google-user-123",
    email: "person@example.com",
    email_verified: true,
    nonce: "expected-nonce",
    iat: now,
    exp: now + 3600
  };
  const serverIndex = fs.readFileSync(path.resolve(__dirname, "../server/index.js"), "utf8");
  const pluginLibrary = fs.readFileSync(path.resolve(__dirname, "../server/pixofix-library.js"), "utf8");
  const securitySource = fs.readFileSync(path.resolve(__dirname, "../server/security.js"), "utf8");
  const configSource = fs.readFileSync(path.resolve(__dirname, "../server/config.js"), "utf8");
  assert.doesNotMatch(serverIndex, /requireLocalPlugin/);
  assert.doesNotMatch(pluginLibrary, /requireLocalPlugin/);
  assert.doesNotMatch(securitySource, /requireLocalPlugin|Plugin access is local only/);
  assert.match(configSource, /host: process\.env\.HOST \|\| "0\.0\.0\.0"/);
  assert.deepEqual(listenOptions("0.0.0.0", 8787), { port: 8787, host: "::", ipv6Only: false });
  assert.deepEqual(listenOptions("127.0.0.1", 8787), { port: 8787, host: "127.0.0.1" });
  assert.ok(portalUrls(8787).includes("http://127.0.0.1:8787"));
  assert.ok(Array.isArray(lanIPv4Addresses()));
  assert.match(serverIndex, /listenOptions\(config\.host, config\.port\)/);
  assert.match(serverIndex, /ensureLanFirewall\(config\.port\)/);
  const catalogAt = serverIndex.indexOf("async function catalogForClient");
  const catalogStart = serverIndex.slice(catalogAt, serverIndex.indexOf("const key = ", catalogAt));
  assert.match(catalogStart, /if \(!RECORD_ID\.test\(String\(clientId \|\| ""\)\)\) return null/);
  assert.match(serverIndex, /\/api\/plugin\/versions\/:id\/file/);
  assert.match(serverIndex, /\/api\/plugin\/versions\/:id\/preview/);
  assert.match(serverIndex, /cachedPreview\(config\.storageRoot, asset\.assetPath, req\.params\.id\)/);
  assert.match(fs.readFileSync(path.resolve(__dirname, "../server/previews.js"), "utf8"), /writePlaceholderPreview/);
  assert.match(serverIndex, /v\.status = 'APPROVED'/);
  assert.match(serverIndex, /r\.active_approved_version_id = v\.id/);
  assert.equal(validateGoogleClaims(claims, "expected-nonce", now), claims);
  assert.throws(() => validateGoogleClaims({ ...claims, nonce: "wrong" }, "expected-nonce", now), /verification failed/);
  assert.throws(() => validateGoogleClaims({ ...claims, iat: now - 3600 }, "expected-nonce", now), /verification failed/);

  const preflight = { headers: {}, statusCode: 0, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; }, end() { this.ended = true; } };
  pluginCors({ method: "OPTIONS", headers: { "access-control-request-private-network": "true" } }, preflight, () => { throw new Error("OPTIONS should not continue"); });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.ended, true);
  assert.equal(preflight.headers["Access-Control-Allow-Private-Network"], "true");
  assert.equal(preflight.headers["Access-Control-Allow-Origin"], "*");
  let continued = false;
  const getRes = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, status() { return this; }, end() {} };
  pluginCors({ method: "GET", headers: {} }, getRes, () => { continued = true; });
  assert.equal(continued, true);
  assert.equal(getRes.headers["Access-Control-Allow-Private-Network"], "true");
  const echoed = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, status() { return this; }, end() {} };
  pluginCors({ method: "GET", headers: { origin: "uxp://plugin" } }, echoed, () => {});
  assert.equal(echoed.headers["Access-Control-Allow-Origin"], "uxp://plugin");
  assert.equal(echoed.headers.Vary, "Origin");
  assert.match(serverIndex, /app\.use\("\/api\/plugin", pluginCors\)/);

  let allowed = false;
  protectUnsafeRequests({ method: "POST", headers: { host: "portal.example", origin: "https://portal.example" } }, {}, () => { allowed = true; });
  assert.equal(allowed, true);
  const blockedResponse = { statusCode: 0, status(code) { this.statusCode = code; return this; }, json(value) { this.value = value; } };
  protectUnsafeRequests({ method: "POST", headers: { host: "portal.example", origin: "https://evil.example", "sec-fetch-site": "cross-site" } }, blockedResponse, () => {});
  assert.equal(blockedResponse.statusCode, 403);
  console.log("Platform safety and authentication tests passed.");
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
