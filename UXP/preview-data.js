function bytesToDataUrl(buffer, mime) {
  var bytes = new Uint8Array(buffer || []);
  var binary = "";
  var chunk = 0x8000;
  for (var index = 0; index < bytes.length; index += chunk) {
    var slice = bytes.subarray(index, Math.min(index + chunk, bytes.length));
    var chars = [];
    for (var offset = 0; offset < slice.length; offset += 1) chars.push(slice[offset]);
    binary += String.fromCharCode.apply(null, chars);
  }
  var encoded = typeof btoa === "function" ? btoa(binary) : Buffer.from(binary, "binary").toString("base64");
  return "data:" + (mime || "image/jpeg") + ";base64," + encoded;
}

function createPreviewLoader(options) {
  var getBytes = options.getBytes;
  var getBatch = options.getBatch;
  var cachedFile = options.cachedFile;
  var toUrl = options.toUrl || function (_id, bytes) { return bytesToDataUrl(bytes); };
  var cache = {};
  var pending = {};
  var queue = [];
  var active = 0;
  var limit = options.limit || 4;
  var batchSize = options.batchSize || 12;
  var slots = options.slots || 1;
  var batchTimer = null;

  function deliver(item, url) {
    if (url) cache[item.versionId] = url;
    delete pending[item.versionId];
    item.resolve(url || "");
  }

  function run(item) {
    Promise.resolve(getBytes("/api/plugin/versions/" + encodeURIComponent(item.versionId) + "/preview")).then(function (bytes) {
      if (!bytes || !bytes.byteLength) throw new Error("empty");
      return Promise.resolve(toUrl(item.versionId, bytes));
    }).then(function (url) {
      if (!url) throw new Error("empty");
      active -= 1;
      deliver(item, url);
      pump();
    }, function () {
      active -= 1;
      deliver(item, "");
      pump();
    });
  }

  function runBatch(items) {
    Promise.resolve(getBatch(items.map(function (item) { return item.versionId; }))).then(function (rows) {
      var byUrl = {};
      var byBytes = {};
      (rows || []).forEach(function (row) {
        if (!row || !row.id) return;
        if (row.url) byUrl[row.id] = row.url;
        else if (row.bytes && row.bytes.byteLength) byBytes[row.id] = row.bytes;
      });
      return Promise.all(items.map(function (item) {
        if (byUrl[item.versionId]) return byUrl[item.versionId];
        var bytes = byBytes[item.versionId];
        if (!bytes) return "";
        return Promise.resolve(toUrl(item.versionId, bytes)).then(function (url) {
          return url || "";
        }, function () { return ""; });
      }));
    }).then(function (urls) {
      items.forEach(function (item, index) { deliver(item, urls[index]); });
    }, function () {
      items.forEach(function (item) { deliver(item, ""); });
    }).then(function () {
      active -= 1;
      pump();
    });
  }

  function pump() {
    if (getBatch) {
      if (batchTimer || active >= slots || !queue.length) return;
      batchTimer = setTimeout(function () {
        batchTimer = null;
        while (active < slots && queue.length) {
          var items = [];
          while (items.length < batchSize && queue.length) items.push(queue.shift());
          active += 1;
          runBatch(items);
        }
      }, 30);
      return;
    }
    while (active < limit && queue.length) {
      active += 1;
      run(queue.shift());
    }
  }

  return {
    cached: function (versionId) {
      return cache[versionId] || "";
    },
    seed: function (versionId, url) {
      if (versionId && url) cache[versionId] = url;
    },
    load: function (versionId) {
      if (!versionId) return Promise.resolve("");
      if (Object.prototype.hasOwnProperty.call(cache, versionId)) return Promise.resolve(cache[versionId]);
      if (pending[versionId]) return pending[versionId];
      var job = new Promise(function (resolve) {
        var item = { versionId: versionId, resolve: resolve };
        var readLocal = Promise.resolve("");
        try {
          if (cachedFile) readLocal = Promise.resolve(cachedFile(versionId));
        } catch (error) {
          readLocal = Promise.resolve("");
        }
        readLocal.then(function (localUrl) {
          if (localUrl) {
            deliver(item, localUrl);
            return;
          }
          queue.push(item);
          pump();
        }, function () {
          queue.push(item);
          pump();
        });
      });
      pending[versionId] = job;
      return job;
    }
  };
}

module.exports = { bytesToDataUrl: bytesToDataUrl, createPreviewLoader: createPreviewLoader };
