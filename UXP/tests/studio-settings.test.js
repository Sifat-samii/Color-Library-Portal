const assert = require("node:assert/strict");
const { connectionHosts, createMemorySettings, createStudioSettings, defaultServerUrls, isLoopbackHost, orderedConnectHosts, serverUrlsFromInput } = require("../studio-settings.js");
const { portalHosts } = require("../config.js");

(async function main() {
  assert.deepEqual(defaultServerUrls(), portalHosts);
  assert.equal(portalHosts[0], "http://192.168.0.112:8787");
  assert.ok(portalHosts.indexOf("http://127.0.0.1:18787") !== -1);
  assert.deepEqual(connectionHosts([
    "http://pixofix-library:8787",
    "https://pixofix-library"
  ], portalHosts), portalHosts.concat([
    "http://pixofix-library:8787",
    "https://pixofix-library"
  ]));
  assert.equal(connectionHosts(["https://colors.example:8443"], portalHosts)[0], "http://192.168.0.112:8787");
  assert.ok(connectionHosts(["https://colors.example:8443"], portalHosts).indexOf("https://colors.example:8443") !== -1);
  assert.ok(portalHosts.indexOf("http://127.0.0.1:8787") !== -1);
  assert.ok(portalHosts.indexOf("http://localhost:8787") !== -1);
  assert.equal(portalHosts.indexOf("https://pixofix-library"), -1);
  assert.deepEqual(serverUrlsFromInput(""), defaultServerUrls());
  assert.deepEqual(serverUrlsFromInput("http://127.0.0.1:9000/"), ["http://127.0.0.1:9000"]);
  assert.throws(function () { serverUrlsFromInput("ftp://127.0.0.1"); }, /Enter a server address/);
  assert.throws(function () { serverUrlsFromInput("http://127.0.0.1:8787/portal"); }, /Enter a server address/);

  const memory = createMemorySettings();
  const settings = createStudioSettings({ storage: memory, namespace: "pixofix-color-library-v1" });
  const initial = await settings.read();
  assert.deepEqual(initial.serverUrls, defaultServerUrls());
  assert.equal(initial.preferredHost, "");
  assert.equal(isLoopbackHost("http://127.0.0.1:18787"), true);
  assert.equal(isLoopbackHost("http://192.168.0.112:8787"), false);
  assert.deepEqual(orderedConnectHosts(portalHosts, ""), [
    "http://192.168.0.112:8787",
    "http://tudb01:8787"
  ].concat(portalHosts.filter(function (host) { return host.indexOf("127.0.0.1") !== -1 || host.indexOf("localhost") !== -1; })));
  assert.equal(orderedConnectHosts(portalHosts, "http://192.168.0.112:8787")[0], "http://192.168.0.112:8787");
  assert.equal(orderedConnectHosts(portalHosts, "http://127.0.0.1:8787")[0], "http://127.0.0.1:8787");
  await settings.write({ serverUrls: serverUrlsFromInput("https://colors.example:8443") });
  const saved = await settings.read();
  assert.deepEqual(saved.serverUrls, ["https://colors.example:8443"]);
  assert.equal(saved.preferredHost, "");
  await settings.write({ serverUrls: saved.serverUrls, preferredHost: "http://192.168.0.112:8787" });
  assert.equal((await settings.read()).preferredHost, "http://192.168.0.112:8787");
  await settings.write({ serverUrls: saved.serverUrls });
  assert.equal((await settings.read()).preferredHost, "http://192.168.0.112:8787");
  assert.equal(Object.prototype.hasOwnProperty.call(saved, "pluginKey"), false);

  const legacy = createMemorySettings({
    "pixofix-color-library-v1:studio": "{\"pluginKey\":\"legacy\",\"serverUrls\":[\"http://127.0.0.1:8787\"]}"
  });
  const legacySettings = createStudioSettings({ storage: legacy, namespace: "pixofix-color-library-v1" });
  const legacyRead = await legacySettings.read();
  assert.deepEqual(legacyRead.serverUrls, ["http://127.0.0.1:8787"]);
  assert.equal(legacyRead.preferredHost, "");
  assert.equal(Object.prototype.hasOwnProperty.call(legacyRead, "pluginKey"), false);

  console.log("Studio settings tests passed.");
})().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
