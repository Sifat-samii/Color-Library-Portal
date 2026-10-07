const assert = require("node:assert/strict");
const { connectTimeoutMs, createWebviewBridge, pluginPathFromUrl } = require("../webview-bridge.js");

function fakeWebview(reply) {
  var listeners = {};
  return {
    src: "",
    addEventListener: function (type, fn) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    },
    removeEventListener: function (type, fn) {
      listeners[type] = (listeners[type] || []).filter(function (item) { return item !== fn; });
    },
    postMessage: function (raw) {
      var data = JSON.parse(raw);
      var self = this;
      setImmediate(function () {
        (listeners.message || []).forEach(function (fn) { fn({ data: JSON.stringify(reply(data)) }); });
      });
    },
    set src(url) {
      this._src = url;
      var self = this;
      setImmediate(function () {
        (listeners.load || []).forEach(function (fn) { fn(); });
      });
    },
    get src() { return this._src; }
  };
}

(async function main() {
  assert.equal(pluginPathFromUrl("http://192.168.0.112:8787/api/plugin/clients"), "/api/plugin/clients");
  assert.equal(connectTimeoutMs("http://192.168.0.112:8787/plugin-bridge.html", 0), 4000);
  assert.equal(connectTimeoutMs("http://tudb01:8787/plugin-bridge.html", 1), 1000);
  assert.equal(connectTimeoutMs("http://127.0.0.1:8787/plugin-bridge.html", 0), 800);
  const view = fakeWebview(function (data) {
    if (data.type === "ping") return { id: data.id, type: "pong" };
    if (data.type === "get" && data.path === "/api/plugin/clients") {
      return { id: data.id, type: "response", ok: true, status: 200, json: { clients: [{ id: "c1" }] } };
    }
    return { id: data.id, type: "error", error: "Blocked" };
  });
  const bridge = createWebviewBridge({
    element: view,
    pages: ["http://192.168.0.112:8787/plugin-bridge.html"]
  });
  const origin = await bridge.connect();
  assert.equal(origin, "http://192.168.0.112:8787");
  const response = await bridge.fetch("http://192.168.0.112:8787/api/plugin/clients", { headers: { Accept: "application/json" } });
  assert.equal(response.ok, true);
  assert.deepEqual(await response.json(), { clients: [{ id: "c1" }] });
  console.log("Webview bridge tests passed.");
})().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
