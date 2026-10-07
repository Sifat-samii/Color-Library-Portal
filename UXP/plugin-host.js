function isCep() {
  return typeof window !== "undefined" && Boolean(window.__adobe_cep__);
}

function hasNodeHttp() {
  try {
    var http = require("http");
    return Boolean(http && typeof http.get === "function");
  } catch (error) {
    return false;
  }
}

function createFetchImpl() {
  if (hasNodeHttp()) return require("./node-http.js").nodeFetch;
  return require("./portal-client.js").xhrFetch;
}

function jsxPath(nativePath) {
  return JSON.stringify(String(nativePath || "").replace(/\\/g, "/"));
}

function evalExtendScript(script) {
  return new Promise(function (resolve, reject) {
    if (!window.__adobe_cep__ || typeof window.__adobe_cep__.evalScript !== "function") {
      reject(new Error("Photoshop scripting is unavailable"));
      return;
    }
    window.__adobe_cep__.evalScript(script, function (result) {
      var text = result == null ? "" : String(result);
      if (!text || text === "undefined" || text.indexOf("EvalScript error") !== -1) {
        reject(new Error("Photoshop could not open this file"));
        return;
      }
      resolve(text);
    });
  });
}

function nodeEntry(nativePath) {
  var fs = require("fs");
  var path = require("path");
  var stat = fs.statSync(nativePath);
  var entry = {
    nativePath: nativePath,
    name: path.basename(nativePath),
    isFolder: stat.isDirectory(),
    isFile: stat.isFile(),
    getMetadata: function () {
      return Promise.resolve({
        size: stat.size,
        dateModified: stat.mtime
      });
    },
    getEntries: function () {
      if (!entry.isFolder) return Promise.resolve([]);
      var names = fs.readdirSync(nativePath);
      var children = [];
      names.forEach(function (name) {
        if (name === "." || name === "..") return;
        try { children.push(nodeEntry(path.join(nativePath, name))); } catch (error) {}
      });
      return Promise.resolve(children);
    }
  };
  return entry;
}

function createNodeFileHost() {
  var fs = require("fs");
  var os = require("os");
  var path = require("path");
  var tempRoot = path.join(os.tmpdir(), "pixofix-color-library");
  fs.mkdirSync(tempRoot, { recursive: true });
  return {
    openLibraryFolder: function (nativePath) {
      if (!nativePath || !fs.existsSync(nativePath) || !fs.statSync(nativePath).isDirectory()) {
        return Promise.reject(new Error("The configured local folder is unavailable"));
      }
      return Promise.resolve(nodeEntry(nativePath));
    },
    fileUrl: function (entry) {
      return entry && entry.nativePath ? "file:///" + String(entry.nativePath).replace(/\\/g, "/") : "";
    },
    writeTempFile: function (name, bytes) {
      var filePath = path.join(tempRoot, name);
      var buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes && bytes.byteLength ? new Uint8Array(bytes) : []);
      fs.writeFileSync(filePath, buffer);
      return Promise.resolve(nodeEntry(filePath));
    },
    cachedTempFile: function (name, expectedSize) {
      var filePath = path.join(tempRoot, name);
      try {
        var stat = fs.statSync(filePath);
        if (expectedSize && Number(stat.size) !== Number(expectedSize)) return Promise.resolve(null);
        return Promise.resolve(nodeEntry(filePath));
      } catch (error) {
        return Promise.resolve(null);
      }
    },
    openDocument: function (entry) {
      var nativePath = entry && entry.nativePath;
      if (!nativePath) return Promise.reject(new Error("Photoshop could not open this file"));
      return evalExtendScript("app.open(File(" + jsxPath(nativePath) + "))");
    },
    pluginFolderPath: function () {
      return __dirname;
    },
    startHelper: function () {
      return Promise.resolve();
    }
  };
}

function createUxpFileHost() {
  var uxp = require("uxp");
  var photoshop = require("photoshop");
  var fs = uxp.storage.localFileSystem;
  var formats = uxp.storage.formats;
  return {
    openLibraryFolder: async function (nativePath) {
      var normalized = String(nativePath || "").replace(/\\/g, "/");
      var folder = await fs.getEntryWithUrl("file:/" + normalized);
      if (!folder || !folder.isFolder) throw new Error("The configured local folder is unavailable");
      return folder;
    },
    fileUrl: function (entry) {
      return fs.getFsUrl(entry);
    },
    writeTempFile: async function (name, bytes) {
      var folder = await fs.getTemporaryFolder();
      var file = await folder.createFile(name, { overwrite: true });
      await file.write(bytes, { format: formats.binary });
      return file;
    },
    cachedTempFile: async function (name, expectedSize) {
      try {
        var folder = await fs.getTemporaryFolder();
        var existing = await folder.getEntry(name);
        if (!existing || !existing.isFile) return null;
        var metadata = await existing.getMetadata();
        if (expectedSize && Number(metadata.size) !== Number(expectedSize)) return null;
        return existing;
      } catch (error) {
        return null;
      }
    },
    openDocument: async function (entry) {
      await photoshop.core.executeAsModal(async function () {
        await photoshop.app.open(entry);
      }, { commandName: "Open approved color reference" });
    },
    pluginFolderPath: async function () {
      var folder = await fs.getPluginFolder();
      return folder.nativePath;
    },
    startHelper: async function (starterName) {
      var folder = await fs.getPluginFolder();
      var entry = await folder.getEntry(starterName);
      var nativePath = entry && entry.nativePath;
      if (!nativePath) return;
      if (uxp.shell && typeof uxp.shell.openPath === "function") {
        await uxp.shell.openPath(nativePath);
        return;
      }
      if (uxp.shell && typeof uxp.shell.openExternal === "function") {
        await uxp.shell.openExternal("file:///" + String(nativePath).replace(/\\/g, "/"));
      }
    }
  };
}

function hasUxpPhotoshop() {
  try {
    return Boolean(require("uxp") && require("photoshop"));
  } catch (error) {
    return false;
  }
}

function createFileHost() {
  if (isCep() || !hasUxpPhotoshop()) return createNodeFileHost();
  return createUxpFileHost();
}

module.exports = {
  createFetchImpl: createFetchImpl,
  createFileHost: createFileHost,
  hasNodeHttp: hasNodeHttp,
  isCep: isCep
};
