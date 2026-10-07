function toArrayBuffer(buffer) {
  if (!buffer) return new ArrayBuffer(0);
  if (buffer instanceof ArrayBuffer) return buffer;
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function nodeFetch(url, requestOptions) {
  var http = require("http");
  var https = require("https");
  var lib = String(url).indexOf("https:") === 0 ? https : http;
  var headers = (requestOptions && requestOptions.headers) || {};
  return new Promise(function (resolve, reject) {
    var settled = false;
    function fail(error) {
      if (settled) return;
      settled = true;
      reject(error);
    }
    var req = lib.get(url, { headers: headers }, function (res) {
      var chunks = [];
      res.on("data", function (chunk) { chunks.push(chunk); });
      res.on("end", function () {
        if (settled) return;
        settled = true;
        var body = Buffer.concat(chunks);
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          json: function () {
            try { return Promise.resolve(JSON.parse(body.toString("utf8"))); } catch (error) { return Promise.reject(error); }
          },
          arrayBuffer: function () {
            return Promise.resolve(toArrayBuffer(body));
          }
        });
      });
    });
    req.on("error", fail);
    if (typeof req.setTimeout === "function") {
      req.setTimeout(8000, function () {
        try { req.destroy(); } catch (error) {}
        fail(new Error("timeout"));
      });
    }
  });
}

module.exports = { nodeFetch: nodeFetch, toArrayBuffer: toArrayBuffer };
