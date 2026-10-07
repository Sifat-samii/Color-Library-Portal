const assert = require("node:assert/strict");
const fs = require("node:fs");
const { allowedPluginPath, bytesToBase64 } = require("../public/plugin-bridge.js");
const { securityHeaders } = require("../server/http-security");

const html = fs.readFileSync("public/plugin-bridge.html", "utf8");
assert.match(html, /src="\/plugin-bridge\.js"/);
assert.equal(allowedPluginPath("/api/plugin/clients"), true);
assert.equal(allowedPluginPath("/api/plugin/versions/x/file"), true);
assert.equal(allowedPluginPath("/api/plugin/versions/x/preview"), true);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
assert.match(bytesToBase64(jpeg.buffer), /^[A-Za-z0-9+/]+=*$/);
assert.equal(allowedPluginPath("/api/admin/clients"), false);
assert.equal(allowedPluginPath("https://evil.example/api/plugin/clients"), false);

const headers = {};
securityHeaders({ path: "/plugin-bridge.html", secure: false }, {
  setHeader: function (name, value) { headers[name] = value; }
}, function () {});
assert.match(headers["Content-Security-Policy"], /frame-ancestors \*/);
assert.equal(headers["Cross-Origin-Resource-Policy"], "cross-origin");
assert.equal(headers["X-Frame-Options"], undefined);

console.log("Plugin bridge tests passed.");
