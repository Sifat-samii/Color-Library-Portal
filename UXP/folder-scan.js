function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

function extensionOf(name) {
  var match = String(name || "").toLowerCase().match(/\.([^.]+)$/);
  return match ? match[1] : "";
}

function isFullReference(relativePath, baseName) {
  var parts = normalizePath(relativePath).split("/");
  return parts.indexOf("full") !== -1 || /[ _-]+full\.[^.]+$/i.test(baseName);
}

async function runLimited(items, limit, worker) {
  var cursor = 0;
  var workers = [];
  async function runWorker() {
    while (cursor < items.length) {
      var index = cursor;
      cursor += 1;
      await worker(items[index]);
    }
  }
  var workerCount = Math.min(limit, items.length);
  for (var index = 0; index < workerCount; index += 1) workers.push(runWorker());
  await Promise.all(workers);
}

async function scanLibraryFolder(folder, options) {
  var extensions = options.extensions || [];
  var fileUrl = options.fileUrl || function () { return ""; };
  var output = [];

  async function readFile(item) {
    var entry = item.entry;
    try {
      var metadata = await entry.getMetadata();
      var extension = extensionOf(entry.name);
      output.push({
        entry: entry,
        baseName: entry.name,
        relativePath: item.relativePath,
        pathKey: normalizePath(item.relativePath),
        extension: extension,
        size: Number(metadata.size || 0),
        modified: metadata.dateModified ? new Date(metadata.dateModified).getTime() : 0,
        fsUrl: fileUrl(entry),
        preference: isFullReference(item.relativePath, entry.name) ? 1 : 0
      });
    } catch (error) {
      console.warn("Skipped unreadable reference", item.relativePath);
    }
  }

  async function walk(current, parentPath) {
    var entries = await current.getEntries();
    entries.sort(function (a, b) { return a.name.localeCompare(b.name); });
    var folders = [];
    var files = [];
    entries.forEach(function (entry) {
      var relativePath = parentPath ? parentPath + "/" + entry.name : entry.name;
      if (entry.isFolder) folders.push({ entry: entry, relativePath: relativePath });
      else if (entry.isFile && extensions.indexOf(extensionOf(entry.name)) !== -1) files.push({ entry: entry, relativePath: relativePath });
    });
    await runLimited(folders, 4, async function (item) { await walk(item.entry, item.relativePath); });
    await runLimited(files, 12, async function (item) { await readFile(item); });
  }

  await walk(folder, "");
  return output;
}

module.exports = { scanLibraryFolder: scanLibraryFolder };
