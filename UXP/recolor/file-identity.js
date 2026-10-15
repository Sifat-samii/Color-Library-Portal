const sha256 = require("./vendor/sha256");

function cancelled(signal) {
  if (signal && signal.aborted) throw Object.assign(new Error("File verification cancelled; completed artifacts were retained"), { code: "CANCELLED" });
}
function modifiedAt(stats) {
  const time = Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : new Date(stats.mtime).getTime();
  if (!Number.isFinite(time)) throw new Error("File modification time is unavailable on this host");
  return time;
}

async function fingerprintFile(filename, io, options = {}) {
  const chunkBytes = options.chunkBytes || 1024 * 1024;
  if (!Number.isInteger(chunkBytes) || chunkBytes < 64 || chunkBytes > 4 * 1024 * 1024) throw new Error("Invalid bounded file-read size");
  cancelled(options.signal);
  const before = await io.lstat(filename);
  if (!before.isFile() || !Number.isSafeInteger(before.size) || before.size < 0) throw new Error("A regular source artifact is required");
  const beforeTime = modifiedAt(before);
  const fd = await io.open(filename, "r"), buffer = new ArrayBuffer(chunkBytes), hash = sha256.create();
  let position = 0;
  try {
    while (position < before.size) {
      cancelled(options.signal);
      const result = await io.read(fd, buffer, 0, Math.min(chunkBytes, before.size - position), position);
      if (!result || !Number.isInteger(result.bytesRead) || result.bytesRead < 1 || result.bytesRead > Math.min(chunkBytes, before.size - position)) throw new Error("Source artifact changed or returned an incomplete read");
      hash.update(new Uint8Array(result.buffer || buffer, 0, result.bytesRead));
      position += result.bytesRead;
      if (options.onProgress) options.onProgress({ bytes: position, total: before.size });
    }
    cancelled(options.signal);
    const after = await io.lstat(filename);
    if (after.size !== before.size || modifiedAt(after) !== beforeTime) throw new Error("Source artifact changed during verification");
    return { algorithm: "SHA-256", sha256: hash.hex(), bytes: position };
  } finally { await io.close(fd); }
}

function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  throw new Error("Recovery manifests require finite JSON values");
}

const digestObject = value => sha256.create().update(canonical(value)).hex();
module.exports = { fingerprintFile, digestObject };
