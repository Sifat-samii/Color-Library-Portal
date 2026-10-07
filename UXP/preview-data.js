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
  var toUrl = options.toUrl || function (_id, bytes) { return bytesToDataUrl(bytes); };
  var cache = {};
  var pending = {};
  var queue = [];
  var active = 0;
  var limit = options.limit || 4;

  function run(item) {
    Promise.resolve(getBytes("/api/plugin/versions/" + encodeURIComponent(item.versionId) + "/preview")).then(function (bytes) {
      if (!bytes || !bytes.byteLength) throw new Error("empty");
      return Promise.resolve(toUrl(item.versionId, bytes));
    }).then(function (url) {
      if (!url) throw new Error("empty");
      cache[item.versionId] = url;
      return url;
    }).then(function (url) {
      active -= 1;
      delete pending[item.versionId];
      item.resolve(url);
      pump();
    }, function () {
      active -= 1;
      delete pending[item.versionId];
      item.resolve("");
      pump();
    });
  }

  function pump() {
    while (active < limit && queue.length) {
      active += 1;
      run(queue.shift());
    }
  }

  return {
    cached: function (versionId) {
      return cache[versionId] || "";
    },
    load: function (versionId) {
      if (!versionId) return Promise.resolve("");
      if (Object.prototype.hasOwnProperty.call(cache, versionId)) return Promise.resolve(cache[versionId]);
      if (pending[versionId]) return pending[versionId];
      var job = new Promise(function (resolve) {
        queue.push({ versionId: versionId, resolve: resolve });
        pump();
      });
      pending[versionId] = job;
      return job;
    }
  };
}

module.exports = { bytesToDataUrl: bytesToDataUrl, createPreviewLoader: createPreviewLoader };
