function hostList(hosts) {
  var list = typeof hosts === "function" ? hosts() : hosts;
  return (list || []).filter(Boolean);
}

function binaryStringToBuffer(text) {
  var buffer = new ArrayBuffer(text.length);
  var view = new Uint8Array(buffer);
  for (var index = 0; index < text.length; index += 1) view[index] = text.charCodeAt(index) & 255;
  return buffer;
}

function xhrFetch(url, requestOptions) {
  return new Promise(function (resolve, reject) {
    if (typeof XMLHttpRequest === "undefined") {
      if (typeof fetch === "function") {
        Promise.resolve(fetch(url, requestOptions)).then(resolve, reject);
        return;
      }
      reject(new Error("Failed to fetch"));
      return;
    }
    var xhr = new XMLHttpRequest();
    var accept = requestOptions && requestOptions.headers && requestOptions.headers.Accept;
    var binary = Boolean(accept && accept !== "application/json");
    try {
      xhr.open("GET", url, true);
    } catch (error) {
      reject(error);
      return;
    }
    if (binary) {
      try { xhr.responseType = "arraybuffer"; } catch (error) {}
    }
    xhr.onload = function () {
      var body = xhr.response;
      var textBody = "";
      try { textBody = typeof xhr.responseText === "string" ? xhr.responseText : ""; } catch (error) { textBody = ""; }
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        json: function () {
          var text = typeof body === "string" ? body : textBody;
          if (!text && body && typeof body.byteLength === "number" && typeof TextDecoder !== "undefined") {
            text = new TextDecoder().decode(body);
          }
          try { return Promise.resolve(JSON.parse(text)); } catch (error) { return Promise.reject(error); }
        },
        arrayBuffer: function () {
          if (body && typeof body.byteLength === "number") return Promise.resolve(body);
          if (textBody) return Promise.resolve(binaryStringToBuffer(textBody));
          return Promise.resolve(new ArrayBuffer(0));
        }
      });
    };
    xhr.onerror = function () { reject(new Error("Failed to fetch")); };
    xhr.ontimeout = function () { reject(new Error("timeout")); };
    try { xhr.send(null); } catch (error) { reject(error); }
  });
}

function fetchWithTimeout(fetchImpl, url, requestOptions, ms) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () {
      reject(new Error("timeout"));
    }, ms);
    Promise.resolve(fetchImpl(url, requestOptions)).then(function (response) {
      clearTimeout(timer);
      resolve(response);
    }, function (error) {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function createPortalClient(options) {
  var fetchImpl = options.fetchImpl;
  var preferred = "";

  function orderedHosts() {
    var list = hostList(options.hosts);
    if (preferred && list.indexOf(preferred) > 0) {
      return [preferred].concat(list.filter(function (host) { return host !== preferred; }));
    }
    return list;
  }

  async function request(path, accept, readBody) {
    var hosts = orderedHosts();
    var lastError = null;
    for (var index = 0; index < hosts.length; index += 1) {
      var host = hosts[index];
      try {
        var headers = { "Accept": accept };
        var requestOptions = { headers: headers };
        var response = await fetchWithTimeout(fetchImpl, host + path, requestOptions, 4000);
        if (!response.ok) {
          var payload = null;
          if (accept === "application/json" && response.json) {
            try { payload = await response.json(); } catch (error) { payload = null; }
          }
          var failure = new Error(payload && payload.error ? payload.error : (accept === "application/json" ? "Color server request failed" : "Could not download this file"));
          failure.http = true;
          failure.permanent = response.status === 401 || response.status === 403;
          throw failure;
        }
        var body = await readBody(response);
        preferred = host;
        return body;
      } catch (error) {
        lastError = error;
        if (error && error.permanent) break;
      }
    }
    if (lastError && lastError.http) throw lastError;
    var detail = lastError && lastError.message ? " (" + lastError.message + ")" : "";
    throw new Error("Cannot reach the color server at " + hosts.join(" or ") + detail);
  }

  return {
    getJson: function (path) {
      return request(path, "application/json", function (response) { return response.json(); });
    },
    getBytes: function (path) {
      return request(path, "image/png", function (response) { return response.arrayBuffer(); });
    },
    getFile: function (path) {
      return request(path, "*/*", function (response) { return response.arrayBuffer(); });
    },
    activeHost: function () { return preferred; }
  };
}

module.exports = {
  createPortalClient: createPortalClient,
  fetchWithTimeout: fetchWithTimeout,
  xhrFetch: xhrFetch
};
