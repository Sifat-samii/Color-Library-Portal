const assert = require("node:assert/strict");
const { bytesToDataUrl, createPreviewLoader } = require("../preview-data.js");

(async function main() {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer;
  const url = bytesToDataUrl(jpeg);
  assert.match(url, /^data:image\/jpeg;base64,/);
  assert.ok(url.length > "data:image/jpeg;base64,".length);

  const calls = [];
  const loader = createPreviewLoader({
    limit: 2,
    getBytes: async function (path) {
      calls.push(path);
      const id = path.split("/")[4];
      if (id === "missing") throw new Error("Preview unavailable");
      return new Uint8Array([id.charCodeAt(0)]).buffer;
    }
  });
  const [a, b, missing] = await Promise.all([
    loader.load("aaa"),
    loader.load("bbb"),
    loader.load("missing")
  ]);
  assert.match(a, /^data:image\/jpeg;base64,/);
  assert.match(b, /^data:image\/jpeg;base64,/);
  assert.notEqual(a, b);
  assert.equal(missing, "");
  assert.equal(loader.cached("aaa"), a);
  assert.equal(await loader.load("aaa"), a);
  assert.equal(calls.filter(function (path) { return path.indexOf("aaa") !== -1; }).length, 1);
  assert.ok(calls.indexOf("/api/plugin/versions/aaa/preview") !== -1);
  assert.equal(loader.cached("missing"), "");

  let failOnce = true;
  const retry = createPreviewLoader({
    getBytes: async function () {
      if (failOnce) {
        failOnce = false;
        throw new Error("offline");
      }
      return jpeg;
    }
  });
  assert.equal(await retry.load("later"), "");
  assert.equal(retry.cached("later"), "");
  const recovered = await retry.load("later");
  assert.match(recovered, /^data:image\/jpeg;base64,/);

  const mapped = createPreviewLoader({
    getBytes: async function () { return jpeg; },
    toUrl: async function (id) { return "file:" + id; }
  });
  assert.equal(await mapped.load("saved"), "file:saved");
  assert.equal(mapped.cached("saved"), "file:saved");

  console.log("Preview data tests passed.");
})().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
