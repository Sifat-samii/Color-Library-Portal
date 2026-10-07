const assert = require("assert");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { referenceTypeFolderName, approvedLocalRelativePath, ensureReferenceTypeFolder, isTransientFileError, replaceApprovedFile } = require("../server/sync");

assert.strictEqual(referenceTypeFolderName("QUICK", ""), "CROP Reference");
assert.strictEqual(referenceTypeFolderName("FULL", ""), "FULL Reference");
assert.strictEqual(referenceTypeFolderName("OTHER", "SIDE VIEW"), "SIDE VIEW Reference");
assert.strictEqual(referenceTypeFolderName("OTHER", "side view reference"), "SIDE VIEW Reference");
assert.strictEqual(
  approvedLocalRelativePath({ kind: "QUICK", label: "", color_name: "Navy", original_filename: "scan.PNG" }),
  path.join("CROP Reference", "Navy.png")
);
assert.strictEqual(
  approvedLocalRelativePath({ kind: "OTHER", label: "SIDE VIEW", color_name: "Navy", original_filename: "scan.jpg" }),
  path.join("SIDE VIEW Reference", "Navy.jpg")
);

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pixofix-sync-"));
  try {
    const created = await ensureReferenceTypeFolder(root, "CROP Reference");
    assert.strictEqual(created, "CROP Reference");
    const stat = await fs.stat(path.join(root, "CROP Reference"));
    assert.strictEqual(stat.isDirectory(), true);

    await fs.mkdir(path.join(root, "side view reference"));
    const reused = await ensureReferenceTypeFolder(root, "SIDE VIEW Reference");
    assert.strictEqual(reused, "side view reference");
    const names = (await fs.readdir(root)).filter(name => name.toLowerCase().includes("side view"));
    assert.deepStrictEqual(names, ["side view reference"]);

    await fs.writeFile(path.join(root, "full reference"), "not a folder");
    await assert.rejects(
      () => ensureReferenceTypeFolder(root, "FULL Reference"),
      error => error.message === "A file already uses the reference type folder name"
    );

    assert.strictEqual(isTransientFileError({ code: "EPERM" }), true);
    assert.strictEqual(isTransientFileError({ code: "ENOENT" }), false);
    const source = path.join(root, "next.jpg");
    const destination = path.join(root, "Library", "Navy.jpg");
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(source, "new-bytes");
    await fs.writeFile(destination, "old-bytes");
    await replaceApprovedFile(source, destination, root);
    assert.strictEqual(await fs.readFile(destination, "utf8"), "new-bytes");
    const archivedNames = await fs.readdir(path.join(root, ".archive"));
    assert.strictEqual(archivedNames.length, 1);
    assert.strictEqual(await fs.readFile(path.join(root, ".archive", archivedNames[0]), "utf8"), "old-bytes");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
  console.log("local reference-folder sync tests passed");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
