const assert = require("assert");
const catalog = require("../catalog.js");

const files = [
  {
    baseName: "CEIL.jpg",
    relativePath: "CEIL.jpg",
    pathKey: "ceil.jpg",
    size: 100,
    modified: 1000,
    preference: 0
  },
  {
    baseName: "WHITE1.psb",
    relativePath: "WHITE1.psb",
    pathKey: "white1.psb",
    size: 50,
    modified: 900,
    preference: 2
  }
];

const portalCatalog = {
  colors: [{
    id: "color-1",
    name: "Ceil Blue",
    normalizedKey: "CEIL BLUE",
    colorCode: "CB-101",
    hexCode: "#6FA8C9",
    instructions: "Use for approved artwork",
    aliases: ["Sky"],
    references: [{
      id: "ref-1",
      kind: "QUICK",
      label: "Screen preview",
      instructions: "Use this for visual matching",
      version: {
        id: "version-1",
        number: 4,
        status: "APPROVED",
        localRelativePath: "CEIL.jpg",
        originalFilename: "CEIL.jpg",
        approvedAt: "2026-09-18T10:00:00.000Z"
      }
    }, {
      id: "ref-2",
      kind: "FULL",
      label: "Production master",
      version: {
        id: "version-2",
        number: 2,
        status: "APPROVED",
        localRelativePath: "FULL/missing.psd",
        originalFilename: "missing.psd"
      }
    }]
  }, {
    id: "color-2",
    name: "White",
    normalizedKey: "WHITE",
    references: [{
      id: "ref-3",
      kind: "WORKING",
      label: "Working",
      version: {
        id: "version-3",
        number: 1,
        status: "APPROVED",
        localRelativePath: "WHITE1.psb",
        originalFilename: "White1.psb"
      }
    }]
  }]
};

let managed = catalog.buildManagedCatalog(files, null, portalCatalog);
assert.strictEqual(managed.length, 2);
assert.strictEqual(managed[0].id, "color-1");
assert.strictEqual(managed[1].id, "color-2");
assert.strictEqual(managed[0].refs.length, 2);
assert.strictEqual(managed[0].refs[0].relativePath, "CEIL.jpg");
assert.strictEqual(managed[1].refs[0].relativePath, "WHITE1.psb");
assert.ok(managed[0].changeKinds.includes("added"));

const baseline = catalog.createBaseline(files, 5000);
managed = catalog.buildManagedCatalog(files, baseline, portalCatalog);
assert.deepEqual(managed[0].changeKinds, []);
assert.ok(!managed[0].changeKinds.includes("updated"));

const modified = files.map((file) => Object.assign({}, file));
modified[0].size = 101;
managed = catalog.buildManagedCatalog(modified, baseline, portalCatalog);
assert.ok(managed[0].changeKinds.includes("updated"));

managed = catalog.buildManagedCatalog(files, baseline, portalCatalog);
assert.strictEqual(managed[0].hexCode, "#6FA8C9");
assert.ok(catalog.matchesColor(managed[0], "#6fa8c9"));
assert.strictEqual(managed[0].refs[0].versionNumber, 4);
assert.strictEqual(managed[0].missingRefs.length, 0);
const remoteRef = managed[0].refs.find((ref) => ref.versionId === "version-2");
assert.strictEqual(remoteRef.remote, true);
assert.strictEqual(remoteRef.extension, "psd");
assert.strictEqual(remoteRef.entry, null);
assert.strictEqual(catalog.remoteFileName({ versionId: "version-2", checksumSha256: "abc123", extension: "psd" }), "version-2-abc123.psd");
assert.strictEqual(catalog.cachedDownloadIsComplete(1200, 1200), true);
assert.strictEqual(catalog.cachedDownloadIsComplete(400, 1200), false);
assert.strictEqual(catalog.cachedDownloadIsComplete(1200, 0), false);
assert.ok(catalog.matchesColor(managed[0], "sky"));
assert.ok(catalog.matchesColor(managed[0], "screen preview"));
assert.strictEqual(catalog.matchesColor(managed[0], "CK605"), false);

assert.strictEqual(catalog.referenceDisplayName({
  referenceKind: "QUICK",
  referenceLabel: "",
  relativePath: "CROP Reference/Maroon.jpg",
  variant: "Crop reference"
}), "Crop");
assert.strictEqual(catalog.referenceDisplayName({
  referenceKind: "FULL",
  referenceLabel: "",
  relativePath: "FULL Reference/Maroon.jpg",
  variant: "Crop reference"
}), "Full");
assert.strictEqual(catalog.referenceDisplayName({
  referenceKind: "FULL",
  referenceLabel: "Crop",
  variant: "Crop reference"
}), "Full");
assert.strictEqual(catalog.referenceDisplayName({
  referenceKind: "OTHER",
  referenceLabel: "Side view"
}), "Side view");
assert.strictEqual(catalog.referenceDisplayName({
  relativePath: "FULL Reference/Maroon.jpg",
  variant: "Crop reference"
}), "Full");

const swatches = [
  { id: "red", name: "Maroon", hexCode: "#800000", shade: "red" },
  { id: "blue", name: "Navy", hexCode: "#000080", shade: "blue" }
];
assert.deepStrictEqual(catalog.filterSwatches(swatches, "", "").map(item => item.id), ["red", "blue"]);
assert.deepStrictEqual(catalog.filterSwatches(swatches, "navy", "").map(item => item.id), ["blue"]);
assert.deepStrictEqual(catalog.filterSwatches(swatches, "#800000", "red").map(item => item.id), ["red"]);
assert.deepStrictEqual(catalog.filterSwatches(swatches, "maroon", "blue"), []);

console.log("Catalog tests passed.");
