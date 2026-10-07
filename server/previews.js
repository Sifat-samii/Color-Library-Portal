const fs = require("fs/promises");
const path = require("path");
const sharp = require("sharp");

const inFlight = new Map();
const queue = [];
let activeJobs = 0;
const MAX_PREVIEW_JOBS = 2;

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

async function cachedPreview(storageRoot, sourcePath, versionId) {
  if (!/^[a-z0-9-]+$/i.test(versionId)) throw new Error("Invalid preview identifier");
  const previewRoot = path.join(storageRoot, "previews");
  const previewPath = path.join(previewRoot, `${versionId}.jpg`);
  if (await exists(previewPath)) return previewPath;
  if (inFlight.has(versionId)) return inFlight.get(versionId);

  const pending = schedule(async () => {
    await fs.mkdir(previewRoot, { recursive: true });
    const temporaryPath = `${previewPath}.${process.pid}-${Date.now()}.tmp`;
    try {
      await sharp(sourcePath, { failOn: "none", pages: 1 })
        .rotate()
        .resize({ width: 720, height: 720, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#24282d" })
        .jpeg({ quality: 78, progressive: true, mozjpeg: true })
        .toFile(temporaryPath);
      await fs.rename(temporaryPath, previewPath);
      return previewPath;
    } catch (error) {
      await fs.unlink(temporaryPath).catch(() => {});
      throw error;
    }
  }).finally(() => inFlight.delete(versionId));

  inFlight.set(versionId, pending);
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

module.exports = { cachedPreview, displayImage };
