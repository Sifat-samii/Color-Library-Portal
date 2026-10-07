function hostList(hosts) {
  var list = typeof hosts === "function" ? hosts() : hosts;
  return (list || []).filter(Boolean);
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
        if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
          requestOptions.signal = AbortSignal.timeout(2500);
        }
        var response = await fetchImpl(host + path, requestOptions);
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
    throw new Error("Cannot reach the color server at " + hosts.join(" or "));
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

module.exports = { createPortalClient: createPortalClient };
