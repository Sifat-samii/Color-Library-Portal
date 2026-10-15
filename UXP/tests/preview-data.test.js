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

  let diskReads = 0;
  const disk = createPreviewLoader({
    cachedFile: async function (id) { return id === "warm" ? "file:warm" : ""; },
    getBytes: async function () {
      diskReads += 1;
      return jpeg;
    }
  });
  assert.equal(await disk.load("warm"), "file:warm");
  assert.equal(diskReads, 0);
  assert.match(await disk.load("cold"), /^data:image\/jpeg;base64,/);
  assert.equal(diskReads, 1);

  const seen = [];
  const batched = createPreviewLoader({
    batchSize: 8,
    getBatch: async function (ids) {
      seen.push(ids.slice());
      return ids.filter(function (id) { return id !== "gone"; }).map(function (id) {
        return { id: id, bytes: jpeg };
      });
    },
    toUrl: async function (id) { return "batch:" + id; }
  });
  const [one, two, gone] = await Promise.all([
    batched.load("one"),
    batched.load("two"),
    batched.load("gone")
  ]);
  assert.equal(one, "batch:one");
  assert.equal(two, "batch:two");
  assert.equal(gone, "");
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].sort(), ["gone", "one", "two"]);
  assert.equal(await batched.load("one"), "batch:one");
  assert.equal(seen.length, 1);

  let wrote = 0;
  const linked = createPreviewLoader({
    getBatch: async function (ids) {
      return ids.map(function (id) { return { id: id, url: "data:" + id }; });
    },
    toUrl: async function () {
      wrote += 1;
      return "file";
    }
  });
  assert.equal(await linked.load("pic"), "data:pic");
  assert.equal(wrote, 0);

  console.log("Preview data tests passed.");
})().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
