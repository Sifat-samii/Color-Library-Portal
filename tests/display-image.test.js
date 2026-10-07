const assert = require("assert");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const sharp = require("sharp");
const { cachedPreview, displayImage } = require("../server/previews");

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "acl-display-"));
  try {
    const jpegPath = path.join(root, "photo.jpg");
    await sharp({ create: { width: 1400, height: 900, channels: 3, background: "#c45b2d" } }).jpeg({ quality: 95 }).toFile(jpegPath);
    const jpegDisplay = await displayImage(root, jpegPath, "jpeg-version");
    assert.strictEqual(jpegDisplay.path, jpegPath);
    assert.strictEqual(jpegDisplay.contentType, "image/jpeg");
    const jpegMeta = await sharp(jpegDisplay.path).metadata();
    assert.strictEqual(jpegMeta.width, 1400);
    assert.strictEqual(jpegMeta.height, 900);

    const thumbPath = await cachedPreview(root, jpegPath, "jpeg-version");
    const thumbMeta = await sharp(thumbPath).metadata();
    assert.ok(thumbMeta.width <= 720 && thumbMeta.height <= 720);
    assert.ok(thumbMeta.width < jpegMeta.width);

    const tiffPath = path.join(root, "scan.tif");
    await sharp({ create: { width: 960, height: 640, channels: 3, background: "#2d6b4f" } }).tiff().toFile(tiffPath);
    const tiffDisplay = await displayImage(root, tiffPath, "tiff-version");
    assert.strictEqual(tiffDisplay.contentType, "image/png");
    assert.notStrictEqual(tiffDisplay.path, tiffPath);
    const tiffMeta = await sharp(tiffDisplay.path).metadata();
    assert.strictEqual(tiffMeta.width, 960);
    assert.strictEqual(tiffMeta.height, 640);

    const cached = await displayImage(root, tiffPath, "tiff-version");
    assert.strictEqual(cached.path, tiffDisplay.path);

    await assert.rejects(() => displayImage(root, jpegPath, "../not-an-id"));
    console.log("Display image tests passed.");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
