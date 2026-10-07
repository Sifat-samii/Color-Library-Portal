const assert = require("node:assert/strict");
const { createMemorySettings, createStudioSettings, defaultServerUrls, serverUrlsFromInput } = require("../studio-settings.js");
const { portalHosts } = require("../config.js");

(async function main() {
  assert.deepEqual(defaultServerUrls(), portalHosts);
  assert.ok(portalHosts.indexOf("http://pixofix-library:8787") !== -1);
  assert.ok(portalHosts.indexOf("https://pixofix-library") !== -1);
  assert.deepEqual(serverUrlsFromInput(""), defaultServerUrls());
  assert.deepEqual(serverUrlsFromInput("http://127.0.0.1:9000/"), ["http://127.0.0.1:9000"]);
  assert.throws(function () { serverUrlsFromInput("ftp://127.0.0.1"); }, /Enter a server address/);
  assert.throws(function () { serverUrlsFromInput("http://127.0.0.1:8787/portal"); }, /Enter a server address/);

  const memory = createMemorySettings();
  const settings = createStudioSettings({ storage: memory, namespace: "pixofix-color-library-v1" });
  const initial = await settings.read();
  assert.deepEqual(initial.serverUrls, defaultServerUrls());
  await settings.write({ serverUrls: serverUrlsFromInput("https://colors.example:8443") });
  const saved = await settings.read();
  assert.deepEqual(saved.serverUrls, ["https://colors.example:8443"]);
  assert.equal(Object.prototype.hasOwnProperty.call(saved, "pluginKey"), false);

  const legacy = createMemorySettings({
    "pixofix-color-library-v1:studio": "{\"pluginKey\":\"legacy\",\"serverUrls\":[\"http://127.0.0.1:8787\"]}"
  });
  const legacySettings = createStudioSettings({ storage: legacy, namespace: "pixofix-color-library-v1" });
  const legacyRead = await legacySettings.read();
  assert.deepEqual(legacyRead.serverUrls, ["http://127.0.0.1:8787"]);
  assert.equal(Object.prototype.hasOwnProperty.call(legacyRead, "pluginKey"), false);

  console.log("Studio settings tests passed.");
})().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
