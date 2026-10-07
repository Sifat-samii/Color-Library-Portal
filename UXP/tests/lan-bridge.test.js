const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const config = require("../config.js");
const { bridgeOrigin, ensureLanBridge, portalLoopbackOrigin } = require("../lan-bridge.js");
const { fetchWithTimeout } = require("../portal-client.js");

(async function main() {
  assert.equal(portalLoopbackOrigin(config), "http://127.0.0.1:8787");
  assert.equal(bridgeOrigin(config), "http://127.0.0.1:18787");
  assert.equal(config.portalHosts[0], "http://192.168.0.112:8787");
  assert.ok(config.portalHosts.indexOf("http://127.0.0.1:8787") !== -1);
  assert.ok(config.portalHosts.indexOf("http://127.0.0.1:18787") !== -1);

  const starter = fs.readFileSync(path.join(__dirname, "..", config.lanBridge.starter), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "..", "lan-bridge.ps1"), "utf8");
  assert.match(starter, /lan-bridge\.ps1|powershell/);
  assert.match(script, new RegExp(config.lanBridge.listenHost.replace(/\./g, "\\.")));
  assert.match(script, new RegExp("\\b" + config.lanBridge.listenPort + "\\b"));
  assert.match(script, new RegExp(config.lanBridge.targetHost.replace(/\./g, "\\.")));
  assert.match(script, new RegExp("\\b" + config.lanBridge.targetPort + "\\b"));
  assert.match(script, /TcpListener/);

  const hits = [];
  async function fetchImpl(url) {
    hits.push(url);
    if (url.indexOf("127.0.0.1:8787") !== -1) return { ok: true, status: 200 };
    throw new Error("Failed to fetch");
  }
  const local = await ensureLanBridge({
    config: config,
    fetchImpl: fetchImpl,
    fetchWithTimeout: fetchWithTimeout,
    start: function () { throw new Error("should not start"); }
  });
  assert.equal(local.ready, "http://127.0.0.1:8787");
  assert.equal(local.started, false);
  assert.equal(hits.length, 1);

  let started = 0;
  let probes = 0;
  async function delayedBridge(url) {
    probes += 1;
    if (url.indexOf("127.0.0.1:8787") !== -1) throw new Error("Failed to fetch");
    if (started && url.indexOf("127.0.0.1:18787") !== -1) return { ok: true, status: 200 };
    throw new Error("Failed to fetch");
  }
  const bridged = await ensureLanBridge({
    config: config,
    fetchImpl: delayedBridge,
    fetchWithTimeout: fetchWithTimeout,
    start: async function () { started += 1; }
  });
  assert.equal(bridged.ready, "http://127.0.0.1:18787");
  assert.equal(bridged.started, true);
  assert.equal(started, 1);
  assert.ok(probes > 2);

  console.log("LAN bridge tests passed.");
})().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
