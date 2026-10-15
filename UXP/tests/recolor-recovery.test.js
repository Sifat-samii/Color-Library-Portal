const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { fingerprintFile } = require("../recolor/file-identity");
const { sealCheckpoint, verifyCheckpoint } = require("../recolor/source-checkpoint");
const { createSourcePreparation } = require("../recolor/source-preparation");
function cleanup(directory) {
  if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith("recolor-identity-")) throw new Error("Refused cleanup outside owned test directory");
  fs.rmSync(directory, { recursive: true, force: true });
}

// Real Node file I/O adapted to the documented UXP ArrayBuffer interface.
function nodeIO(onRead) {
  return { lstat: filename => fs.promises.lstat(filename),
    open: filename => new Promise((resolve, reject) => fs.open(filename, "r", (error, fd) => error ? reject(error) : resolve(fd))),
    close: fd => new Promise((resolve, reject) => fs.close(fd, error => error ? reject(error) : resolve())),
    read: (fd, buffer, offset, length, position) => new Promise((resolve, reject) => {
      if (onRead) onRead(length);
      fs.read(fd, Buffer.from(buffer), offset, length, position, (error, bytesRead) => error ? reject(error) : resolve({ bytesRead, buffer }));
    }) };
}

test("file identity matches independent SHA-256 for multi-chunk binary data with bounded reads", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "recolor-identity-"));
  try {
    const filename = path.join(directory, "source.bin"), bytes = Buffer.alloc(3 * 1024 * 1024 + 71);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 31 + 17) % 256;
    fs.writeFileSync(filename, bytes);
    let maximumRead = 0;
    const identity = await fingerprintFile(filename, nodeIO(length => { maximumRead = Math.max(maximumRead, length); }), { chunkBytes: 65536 });
    assert.equal(identity.sha256, crypto.createHash("sha256").update(bytes).digest("hex"));
    assert.equal(identity.bytes, bytes.length);
    assert.ok(maximumRead <= 65536);
    assert.equal(identity.algorithm, "SHA-256");
  } finally { cleanup(directory); }
});

test("same-size changes within one timestamp second invalidate a file verification", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "recolor-identity-"));
  try {
    const filename = path.join(directory, "changing.bin"); fs.writeFileSync(filename, Buffer.alloc(131072, 7));
    const initialTime = new Date("2026-01-01T00:00:00.001Z"); fs.utimesSync(filename, initialTime, initialTime);
    let changed = false;
    await assert.rejects(() => fingerprintFile(filename, nodeIO(), { chunkBytes: 65536, onProgress() {
      if (!changed) { changed = true; fs.writeFileSync(filename, Buffer.alloc(131072, 8)); const later = new Date(initialTime.getTime() + 1); fs.utimesSync(filename, later, later); }
    } }), /changed/i);
  } finally { cleanup(directory); }
});

test("checkpoint manifests detect altered roles and reject artifact path escapes", () => {
  const inspection = { schemaVersion: 1, binding: { id: 1, width: 96, height: 64 }, layers: [{ indices: [0], path: ["Photo"], kind: "pixel", visible: true }] };
  const preparation = createSourcePreparation(inspection, { roles: [{ indices: [0], role: "KEEP_BASE" }], insertion: { kind: "TOP" },
    review: { status: "ACCEPTED", reviewer: "Contract fixture", reviewedAt: "2026-10-16T00:00:00Z" } });
  const payload = { id: "fixture", revision: 1, createdAt: "2026-10-16T00:00:00Z", artifact: { name: "source-fixture.psb", bytes: 20, sha256: "a".repeat(64) },
    frozen: { profile: "Adobe RGB (1998)", width: 96, height: 64, layers: inspection.layers }, sourcePreparation: preparation };
  const checkpoint = sealCheckpoint(payload);
  assert.deepEqual(verifyCheckpoint(JSON.parse(JSON.stringify(checkpoint))), payload);
  const changed = JSON.parse(JSON.stringify(checkpoint)); changed.payload.sourcePreparation.roles[0].role = "DISABLE_RECOLOR";
  assert.throws(() => verifyCheckpoint(changed), /checksum/i);
  assert.throws(() => sealCheckpoint({ ...payload, artifact: { ...payload.artifact, name: "../source-fixture.psb" } }), /identity/i);
});

test("cancelled file verification preserves source bytes", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "recolor-identity-"));
  try {
    const filename = path.join(directory, "cancelled.bin"), bytes = Buffer.alloc(131072, 11); fs.writeFileSync(filename, bytes);
    const signal = { aborted: false };
    await assert.rejects(() => fingerprintFile(filename, nodeIO(), { chunkBytes: 65536, signal, onProgress() { signal.aborted = true; } }), error => error.code === "CANCELLED");
    assert.deepEqual(fs.readFileSync(filename), bytes);
  } finally { cleanup(directory); }
});
