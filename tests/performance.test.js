const assert = require("assert");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { performance } = require("perf_hooks");
const sharp = require("sharp");
const catalog = require("../UXP/catalog");
const { cachedPreview } = require("../server/previews");

async function main() {
  const colorCount = 5000;
  const files = [];
  const colors = [];
  for (let index = 0; index < colorCount; index += 1) {
    const key = `COLOR ${String(index).padStart(5, "0")}`;
    const quickPath = `quick/${key}.jpg`;
    const fullPath = `full/${key}.jpg`;
    files.push(
      { baseName: `${key}.jpg`, relativePath: quickPath, pathKey: quickPath.toLowerCase(), extension: "jpg", size: 120000, modified: index, preference: 0 },
      { baseName: `${key}.jpg`, relativePath: fullPath, pathKey: fullPath.toLowerCase(), extension: "jpg", size: 3200000, modified: index, preference: 1 }
    );
    colors.push({
      id: `color-${index}`,
      name: key,
      normalizedKey: key,
      colorCode: `C-${index}`,
      aliases: [`Alias ${index}`],
      references: [
        { id: `quick-${index}`, kind: "QUICK", label: "Crop", version: { id: `qv-${index}`, number: 1, status: "APPROVED", localRelativePath: quickPath } },
        { id: `full-${index}`, kind: "FULL", label: "Full", version: { id: `fv-${index}`, number: 1, status: "APPROVED", localRelativePath: fullPath } }
      ]
    });
  }

  const catalogStart = performance.now();
  const groups = catalog.buildManagedCatalog(files, null, { colors });
  const catalogMs = performance.now() - catalogStart;
  assert.strictEqual(groups.length, colorCount);
  assert.ok(catalogMs < 2000, `Large catalog assembly took ${catalogMs.toFixed(1)} ms`);

  const searchStart = performance.now();
  const matches = groups.filter(group => catalog.matchesColor(group, "Alias 4999"));
  const searchMs = performance.now() - searchStart;
  assert.strictEqual(matches.length, 1);
  assert.ok(searchMs < 2000, `Large catalog search took ${searchMs.toFixed(1)} ms`);

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "acl-performance-"));
  try {
    const sourcePath = path.join(temporaryRoot, "large-source.jpg");
    await sharp({ create: { width: 4000, height: 4000, channels: 3, background: "#3c8f84" } }).jpeg({ quality: 92 }).toFile(sourcePath);
    const previewStart = performance.now();
    const previewPath = await cachedPreview(temporaryRoot, sourcePath, "benchmark-version");
    const previewMs = performance.now() - previewStart;
    const cachedStart = performance.now();
    await cachedPreview(temporaryRoot, sourcePath, "benchmark-version");
    const cachedMs = performance.now() - cachedStart;
    const [sourceStat, previewStat] = await Promise.all([fs.stat(sourcePath), fs.stat(previewPath)]);
    assert.ok(previewStat.size < sourceStat.size, "Preview should be smaller than its production source");
    assert.ok(cachedMs < 100, `Cached preview lookup took ${cachedMs.toFixed(1)} ms`);
    console.log(`Performance checks passed: 5,000-color build ${catalogMs.toFixed(1)} ms, search ${searchMs.toFixed(1)} ms, preview ${previewMs.toFixed(1)} ms, cached preview ${cachedMs.toFixed(1)} ms.`);
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
