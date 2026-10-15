const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { inventoryDataset } = require("../scripts/recolor-dataset");

test("benchmark pairs by product and explicit view, counts PSD/JPEG once, and respects Sample 1's JPG-only contract", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "recolor-dataset-"));
  async function touch(relative) {
    const filename = path.join(root, relative);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, "metadata disabled for pairing fixture");
  }
  try {
    await touch("Approved Color/CROP/WINE.jpg");
    await touch("Approved Color/FULL/WINE_FULL.jpg");
    for (const sample of [1, 2]) {
      for (const view of ["01", "02", "03", "04", "05", "06", "07", "08"]) {
        await touch("Recolor Sample " + sample + "/Input/PRODUCT_" + view + ".psd");
        const base = "Recolor Sample " + sample + "/Output/WINE/";
        await touch(base + (sample === 2 ? "JPG/" : "") + "PRODUCT_WIN_" + view + ".jpg");
        if (sample === 2) await touch(base + "PSD/PRODUCT_WIN_" + view + ".psd");
      }
    }
    const report = await inventoryDataset(root, { metadata: false });
    assert.equal(report.cases.length, 16);
    const fullBody = report.cases.find(c => c.sample === 2 && c.viewCode === "02");
    assert.equal(fullBody.view, "Full body");
    assert.ok(fullBody.source.endsWith("PRODUCT_02.psd"));
    assert.ok(fullBody.goldPsd.endsWith("PRODUCT_WIN_02.psd"));
    assert.ok(fullBody.reference.full.endsWith("WINE_FULL.jpg"));
    assert.ok(report.cases.filter(c => c.sample === 1).every(c => c.goldPsd === null));
    assert.equal(report.findings.filter(f => f.code === "MISSING_GOLD_PSD" && f.sample === 1).length, 0);
    assert.deepEqual(report.cases.filter(c => c.sample === 1 && ["06", "07", "08"].includes(c.viewCode)).map(c => c.view),
      ["Detailed view 1", "Detailed view 2", "Detailed view 3"]);
    await touch("Recolor Sample 2/Output/WINE/JPG/OTHER_WIN_03.jpg");
    const conflicted = await inventoryDataset(root, { metadata: false });
    assert.ok(conflicted.findings.some(f => f.code === "PRODUCT_MISMATCH"));
    assert.ok(conflicted.cases.find(c => c.sample === 2 && c.viewCode === "03").blockingFindings.length > 0);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("bounded PSD metadata reads identify header geometry and distinguish absent ICC without decoding pixels", async () => {
  const { inspectAsset } = require("../scripts/recolor-metadata");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "recolor-header-"));
  try {
    // PSD spec: 26-byte RGB header, empty mode/resources/layer sections.
    const bytes = Buffer.from("3842505300010000000000000003000000140000000a00080003000000000000000000000000", "hex");
    const filename = path.join(directory, "header-only.psd");
    await fs.writeFile(filename, bytes);
    const result = await inspectAsset(filename);
    assert.equal(result.width, 10); assert.equal(result.height, 20);
    assert.equal(result.depth, 8); assert.equal(result.mode, "RGB");
    assert.equal(result.profile, "Untagged");
    assert.equal(result.pixelDecodeVerified, false);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test("authorized CBI aliases are flagged, retain original labels and skip Heather Ash", async () => {
  const { canonicalLabel } = require("../scripts/recolor-dataset");
  for (const [original, expected] of [["Carribean Blue", "Caribbean Blue"], ["Ciel", "Ceil Blue"], ["CEIL", "Ceil Blue"],
    ["Hunter", "Hunter Green"], ["Teal", "Teal Blue"]]) {
    const result = canonicalLabel(original);
    assert.equal(result.label, expected); assert.equal(result.original, original);
    assert.equal(result.flaggedAlias, true);
  }
  assert.equal(canonicalLabel("Heather Ash").excluded, true);
  assert.equal(canonicalLabel("Caribbean Blue").flaggedAlias, false);
  assert.equal(canonicalLabel("Olive").label, "Olive");
});
