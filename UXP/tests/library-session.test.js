const assert = require("node:assert/strict");
const { createLibrarySession } = require("../library-session.js");

const NAMESPACE = "pixofix-color-library-v1";
const CLOCK = 1_700_000_000_000;

function memoryStorage(seed) {
  const data = Object.assign({}, seed || {});
  return {
    data: data,
    async get(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    async set(key, value) { data[key] = String(value); }
  };
}

function portal(routes) {
  const calls = [];
  return {
    calls: calls,
    async getJson(path) {
      calls.push(path);
      if (!Object.prototype.hasOwnProperty.call(routes, path)) throw new Error("Cannot reach the local color server at http://127.0.0.1:8787");
      const route = routes[path];
      if (route instanceof Error) throw route;
      return route;
    }
  };
}

const clients = [{ id: "client-1", code: "CBI", name: "Careismatic Brands", localFolderPath: "D:\\Library\\CBI" }];
const catalog = {
  colors: [{
    id: "color-1",
    name: "Ceil",
    normalizedKey: "CEIL",
    colorCode: "",
    hexCode: "#AABBCC",
    aliases: [],
    references: [{
      id: "ref-1",
      kind: "QUICK",
      label: "Crop",
      version: { id: "v1", number: 2, status: "APPROVED", localRelativePath: "CEIL.jpg", originalFilename: "CEIL.jpg", approvedAt: "2026-09-18T10:00:00.000Z" }
    }]
  }]
};

function filesFor(found) {
  return {
    opened: [],
    async openFolder(nativePath) {
      this.opened.push(nativePath);
      if (String(nativePath).indexOf("missing") !== -1) throw new Error("The configured local folder is unavailable");
      return { path: nativePath };
    },
    async scan() { return found; }
  };
}

const localFiles = [{
  baseName: "CEIL.jpg",
  relativePath: "CEIL.jpg",
  pathKey: "ceil.jpg",
  extension: "jpg",
  size: 100,
  modified: 2000,
  entry: { name: "CEIL.jpg" },
  fsUrl: "fs:ceil"
}, {
  baseName: "WHITE1.psb",
  relativePath: "WHITE1.psb",
  pathKey: "white1.psb",
  extension: "psb",
  size: 50,
  modified: 1000
}];

(async function main() {
  const storage = memoryStorage();
  const source = portal({
    "/api/plugin/clients": { clients: clients },
    "/api/plugin/clients/client-1/catalog": catalog,
    "/api/plugin/swatches": { colors: [{ id: "red", name: "Maroon", hexCode: "#800000", shade: "red" }] }
  });
  const disk = filesFor(localFiles);
  const session = createLibrarySession({
    portal: source,
    storage: storage,
    files: disk,
    clock: function () { return CLOCK; },
    namespace: NAMESPACE
  });

  let snap = await session.start();
  assert.equal(snap.connectionError, null);
  assert.equal(snap.serverOnline, true);
  assert.equal(snap.selectedClient.id, "client-1");
  assert.equal(snap.rootReady, true);
  assert.equal(snap.catalog.length, 1);
  assert.equal(snap.catalog[0].id, "color-1");
  assert.equal(snap.catalog[0].refs.length, 1);
  assert.equal(snap.files.length, 1);
  assert.equal(snap.localFolder, false);
  assert.equal(disk.opened.length, 0);
  assert.equal(snap.catalog[0].refs.some(function (ref) { return ref.remote && ref.versionId === "v1"; }), true);
  snap = await session.attachLocal();
  assert.equal(disk.opened[0], "D:\\Library\\CBI");
  assert.equal(snap.localFolder, true);
  assert.equal(snap.catalog[0].refs[0].remote, undefined);
  assert.equal(storage.data[NAMESPACE + ":selected-client"], "client-1");

  storage.data[NAMESPACE + ":favorites:client-1"] = JSON.stringify({ CEIL: true });
  snap = await session.refresh();
  assert.equal(snap.favorites["color-1"], true);
  assert.equal(snap.favorites.CEIL, true);
  snap = await session.attachLocal();
  assert.equal(snap.localFolder, true);

  snap = await session.toggleFavorite("color-1");
  assert.equal(snap.favorites["color-1"], undefined);
  snap = await session.markReviewed();
  assert.deepEqual(snap.catalog[0].changeKinds, []);
  assert.equal(snap.baseline.reviewedAt, CLOCK);

  snap = await session.loadSwatches();
  assert.equal(snap.swatches.length, 1);
  assert.equal(snap.swatchOffline, false);

  const offlineStorage = memoryStorage();
  offlineStorage.data[NAMESPACE + ":clients-cache"] = JSON.stringify({ savedAt: CLOCK - 1000, clients: clients });
  offlineStorage.data[NAMESPACE + ":catalog-cache:client-1"] = JSON.stringify({ savedAt: CLOCK - 500, catalog: catalog });
  const offline = createLibrarySession({
    portal: portal({}),
    storage: offlineStorage,
    files: filesFor(localFiles),
    clock: function () { return CLOCK; },
    namespace: NAMESPACE
  });
  const hydrated = createLibrarySession({
    portal: portal({}),
    storage: offlineStorage,
    files: filesFor(localFiles),
    clock: function () { return CLOCK; },
    namespace: NAMESPACE
  });
  snap = await hydrated.hydrate();
  assert.equal(snap.rootReady, true);
  assert.equal(snap.serverOnline, false);
  assert.equal(snap.localFolder, false);
  assert.equal(snap.catalog[0].id, "color-1");
  assert.equal(hydrated.snapshot().selectedClient.id, "client-1");

  snap = await offline.start();
  assert.equal(snap.serverOnline, false);
  assert.equal(snap.cacheSavedAt, CLOCK - 500);
  assert.equal(snap.catalog[0].id, "color-1");
  assert.equal(snap.connectionError, null);

  const empty = createLibrarySession({
    portal: portal({}),
    storage: memoryStorage(),
    files: filesFor(localFiles),
    clock: function () { return CLOCK; },
    namespace: NAMESPACE
  });
  snap = await empty.start();
  assert.match(snap.connectionError, /Cannot reach the local color server/);
  assert.equal(snap.rootReady, false);

  const remoteDisk = filesFor([]);
  remoteDisk.openFolder = async function () { throw new Error("The configured local folder is unavailable"); };
  const remoteSession = createLibrarySession({
    portal: source,
    storage: memoryStorage(),
    files: remoteDisk,
    clock: function () { return CLOCK; },
    namespace: NAMESPACE
  });
  snap = await remoteSession.start();
  assert.equal(snap.connectionError, null);
  assert.equal(snap.serverOnline, true);
  assert.equal(snap.rootReady, true);
  assert.equal(snap.localFolder, false);
  assert.equal(snap.catalog[0].refs.some(function (ref) { return ref.remote && ref.versionId === "v1"; }), true);

  snap = await offline.loadSwatches();
  assert.equal(snap.swatches, null);
  offlineStorage.data[NAMESPACE + ":swatches"] = JSON.stringify({ savedAt: CLOCK, colors: [{ id: "red", name: "Maroon", hexCode: "#800000" }] });
  snap = await offline.loadSwatches();
  assert.equal(snap.swatchOffline, true);
  assert.equal(snap.swatches[0].id, "red");
  assert.equal(snap.swatchNotice, "Could not refresh swatches.");

  console.log("Library session tests passed.");
})().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});