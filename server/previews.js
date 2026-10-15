const fs = require("fs/promises");
const path = require("path");
const sharp = require("sharp");

const inFlight = new Map();
const queue = [];
let activeJobs = 0;
const MAX_PREVIEW_JOBS = 4;

function schedule(task) {
  return new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    drain();
  });
}

function drain() {
  while (activeJobs < MAX_PREVIEW_JOBS && queue.length) {
    const job = queue.shift();
    activeJobs += 1;
    Promise.resolve().then(job.task).then(job.resolve, job.reject).finally(() => {
      activeJobs -= 1;
      drain();
    });
  }
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

const previewWarned = new Set();
const CARD_PREVIEW_EDGE = 360;

function previewEdge(options) {
  return options && Number(options.maxEdge) === CARD_PREVIEW_EDGE ? CARD_PREVIEW_EDGE : 720;
}

function previewCacheRelativePaths(versionId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(versionId || ""))) return [];
  return [
    `previews/${versionId}.jpg`,
    `previews/${versionId}.w${CARD_PREVIEW_EDGE}.jpg`,
    `previews/${versionId}.full.png`
  ];
}

async function writePreviewJpeg(source, destination, options) {
  const quality = options && options.quality ? options.quality : 78;
  const mozjpeg = !options || options.mozjpeg !== false;
  const temporaryPath = `${destination}.${process.pid}-${Date.now()}.tmp`;
  try {
    await source.jpeg({ quality, progressive: true, mozjpeg }).toFile(temporaryPath);
    await fs.rename(temporaryPath, destination);
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

async function writePlaceholderPreview(previewPath, edge) {
  const size = edge || 720;
  await writePreviewJpeg(
    sharp({ create: { width: size, height: size, channels: 3, background: "#24282d" } }),
    previewPath,
    { quality: 70, mozjpeg: false }
  );
}

async function cachedPreview(storageRoot, sourcePath, versionId, options) {
  if (!/^[a-z0-9-]+$/i.test(versionId)) throw new Error("Invalid preview identifier");
  const edge = previewEdge(options);
  const previewRoot = path.join(storageRoot, "previews");
  const previewPath = path.join(previewRoot, edge === 720 ? `${versionId}.jpg` : `${versionId}.w${edge}.jpg`);
  const flightKey = edge === 720 ? versionId : `${versionId}:${edge}`;
  if (await exists(previewPath)) return previewPath;
  if (inFlight.has(flightKey)) return inFlight.get(flightKey);

  const pending = schedule(async () => {
    if (await exists(previewPath)) return previewPath;
    await fs.mkdir(previewRoot, { recursive: true });
    const fullPreview = path.join(previewRoot, `${versionId}.jpg`);
    const input = edge < 720 && await exists(fullPreview) ? fullPreview : sourcePath;
    try {
      await writePreviewJpeg(
        sharp(input, { failOn: "none", pages: 1 })
          .rotate()
          .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
          .flatten({ background: "#24282d" }),
        previewPath,
        edge < 720 ? { quality: 55, mozjpeg: false } : undefined
      );
      return previewPath;
    } catch (error) {
      if (!previewWarned.has(flightKey)) {
        previewWarned.add(flightKey);
        console.warn("Preview unavailable", versionId, error.message);
      }
      await writePlaceholderPreview(previewPath, edge);
      return previewPath;
    }
  }).finally(() => inFlight.delete(flightKey));

  inFlight.set(flightKey, pending);
  return pending;
}

const nativeDisplayTypes = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".gif", "image/gif"],
  [".webp", "image/webp"]
]);

function displayImage(storageRoot, sourcePath, versionId) {
  if (!/^[a-z0-9-]+$/i.test(versionId)) return Promise.reject(new Error("Invalid preview identifier"));
  const contentType = nativeDisplayTypes.get(path.extname(sourcePath).toLowerCase());
  if (contentType) return Promise.resolve({ path: sourcePath, contentType });
  return cachedFullDisplay(storageRoot, sourcePath, versionId);
}

async function cachedFullDisplay(storageRoot, sourcePath, versionId) {
  const key = `display:${versionId}`;
  const displayPath = path.join(storageRoot, "previews", `${versionId}.full.png`);
  if (await exists(displayPath)) return { path: displayPath, contentType: "image/png" };
  if (inFlight.has(key)) return inFlight.get(key);

  const pending = schedule(async () => {
    if (await exists(displayPath)) return { path: displayPath, contentType: "image/png" };
    await fs.mkdir(path.dirname(displayPath), { recursive: true });
    const temporaryPath = `${displayPath}.${process.pid}-${Date.now()}.tmp`;
    try {
      await sharp(sourcePath, { failOn: "none", pages: 1, limitInputPixels: false })
        .rotate()
        .withMetadata()
        .png()
        .toFile(temporaryPath);
      await fs.rename(temporaryPath, displayPath);
      return { path: displayPath, contentType: "image/png" };
    } catch (error) {
      await fs.unlink(temporaryPath).catch(() => {});
      throw error;
    }
  }).finally(() => inFlight.delete(key));

  inFlight.set(key, pending);
  return pending;
}

module.exports = { cachedPreview, displayImage, previewCacheRelativePaths, CARD_PREVIEW_EDGE };
