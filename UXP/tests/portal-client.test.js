const assert = require("node:assert/strict");
const { createPortalClient } = require("../portal-client.js");

function fakeFetch(routes) {
  const calls = [];
  async function fetchImpl(url, options) {
    calls.push({ url, options });
    const route = routes[url];
    if (!route) throw new Error("Failed to fetch");
    if (route.throw) throw new Error(route.throw);
    return {
      ok: route.status ? route.status < 400 : true,
      status: route.status || 200,
      async json() {
        if (route.invalidJson) throw new Error("invalid json");
        return route.json;
      },
      async arrayBuffer() {
        return route.bytes;
      }
    };
  }
  return { fetchImpl, calls };
}

(async function main() {
  const down = fakeFetch({});
  const client = createPortalClient({
    hosts: ["http://127.0.0.1:8787", "http://localhost:8787"],
    fetchImpl: down.fetchImpl
  });
  await assert.rejects(
    function () { return client.getJson("/api/plugin/clients"); },
    /127\.0\.0\.1:8787 or http:\/\/localhost:8787/
  );
  assert.equal(down.calls.length, 2);
  assert.deepEqual(down.calls[0].options.headers, { "Accept": "application/json" });
  assert.equal(Object.prototype.hasOwnProperty.call(down.calls[0].options.headers, "X-Plugin-Key"), false);

  const failover = fakeFetch({
    "http://localhost:8787/api/plugin/clients": { json: { clients: [{ id: "c1" }] } },
    "http://localhost:8787/api/plugin/swatches": { json: { colors: [] } }
  });
  const second = createPortalClient({
    hosts: ["http://127.0.0.1:8787", "http://localhost:8787"],
    fetchImpl: failover.fetchImpl
  });
  const payload = await second.getJson("/api/plugin/clients");
  assert.deepEqual(payload.clients, [{ id: "c1" }]);
  assert.equal(second.activeHost(), "http://localhost:8787");
  await second.getJson("/api/plugin/swatches");
  assert.equal(failover.calls[failover.calls.length - 1].url, "http://localhost:8787/api/plugin/swatches");

  const denied = fakeFetch({
    "http://127.0.0.1:8787/api/plugin/clients": { status: 401, json: { error: "Plugin key was rejected" } }
  });
  const rejected = createPortalClient({
    hosts: ["http://127.0.0.1:8787", "http://localhost:8787"],
    fetchImpl: denied.fetchImpl
  });
  await assert.rejects(
    function () { return rejected.getJson("/api/plugin/clients"); },
    /Plugin key was rejected/
  );
  assert.equal(denied.calls.length, 1);

  const open = fakeFetch({
    "http://127.0.0.1:8787/api/plugin/clients": { json: { clients: [] } }
  });
  const missing = createPortalClient({
    hosts: ["http://127.0.0.1:8787"],
    fetchImpl: open.fetchImpl
  });
  await missing.getJson("/api/plugin/clients");
  assert.equal(Object.prototype.hasOwnProperty.call(open.calls[0].options.headers, "X-Plugin-Key"), false);

  const image = fakeFetch({
    "http://127.0.0.1:8787/api/plugin/swatches/red/image": { bytes: new Uint8Array([1, 2, 3]).buffer }
  });
  const images = createPortalClient({
    hosts: ["http://127.0.0.1:8787"],
    fetchImpl: image.fetchImpl
  });
  const bytes = await images.getBytes("/api/plugin/swatches/red/image");
  assert.equal(bytes.byteLength, 3);
  assert.equal(image.calls[0].options.headers.Accept, "image/png");

  const broken = fakeFetch({
    "http://127.0.0.1:8787/api/plugin/clients": { status: 500, invalidJson: true }
  });
  const badBody = createPortalClient({
    hosts: ["http://127.0.0.1:8787"],
    fetchImpl: broken.fetchImpl
  });
  await assert.rejects(
    function () { return badBody.getJson("/api/plugin/clients"); },
    /Color server request failed/
  );

  console.log("Portal client tests passed.");
})().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
