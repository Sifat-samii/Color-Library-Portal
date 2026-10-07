const assert = require("node:assert/strict");
const { scanLibraryFolder } = require("../folder-scan.js");

function file(name, size, modified) {
  return {
    name: name,
    isFile: true,
    isFolder: false,
    getMetadata: async function () { return { size: size, dateModified: new Date(modified) }; }
  };
}

function folder(name, children) {
  return {
    name: name,
    isFile: false,
    isFolder: true,
    getEntries: async function () { return children; }
  };
}

(async function main() {
  const root = folder("", [
    file("Note.txt", 10, 1000),
    file("Ceil.jpg", 100, 2000),
    folder("FULL", [file("Ceil.jpg", 500, 3000), file("Skip.db", 1, 1000)])
  ]);
  const files = await scanLibraryFolder(root, {
    extensions: ["jpg", "png"],
    fileUrl: function (entry) { return "fs:" + entry.name; }
  });
  const byPath = {};
  files.forEach(function (item) { byPath[item.relativePath] = item; });
  assert.deepEqual(Object.keys(byPath).sort(), ["Ceil.jpg", "FULL/Ceil.jpg"]);
  assert.equal(byPath["Ceil.jpg"].pathKey, "ceil.jpg");
  assert.equal(byPath["Ceil.jpg"].size, 100);
  assert.equal(byPath["Ceil.jpg"].modified, 2000);
  assert.equal(byPath["Ceil.jpg"].preference, 0);
  assert.equal(byPath["FULL/Ceil.jpg"].preference, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(byPath["Ceil.jpg"], "colorId"), false);
  console.log("Folder scan tests passed.");
})().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
