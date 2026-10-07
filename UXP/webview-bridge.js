function decodeBase64(text) {
  var binary = typeof atob === "function" ? atob(text) : Buffer.from(text, "base64").toString("binary");
  var buffer = new ArrayBuffer(binary.length);
  var view = new Uint8Array(buffer);
  for (var index = 0; index < binary.length; index += 1) view[index] = binary.charCodeAt(index) & 255;
  return buffer;
}

function pluginPathFromUrl(url) {
  var value = String(url || "");
  var cut = value.indexOf("/api/");
  return cut === -1 ? value : value.slice(cut);
}

function originFromPage(url) {
  return String(url || "").replace(/\/plugin-bridge\.html(?:\?.*)?$/, "");
}

function isLoopbackPage(url) {
  try {
    var hostname = new URL(url).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch (error) {
    return false;
  }
}

function connectTimeoutMs(url, index) {
  if (isLoopbackPage(url)) return 800;
  return index === 0 ? 4000 : 1000;
}

function createWebviewBridge(options) {
  var origin = "";
  var seq = 0;
  var connectGen = 0;
  var waiters = {};
  var listening = false;

  function pageList() {
    var list = typeof options.pages === "function" ? options.pages() : options.pages;
    return (list || []).filter(Boolean);
  }

  function element() {
    return typeof options.element === "function" ? options.element() : options.element;
  }

  function onMessage(event) {
    var data = event && event.data;
    if (typeof data === "string") {
      try { data = JSON.parse(data); } catch (error) { return; }
    }
    if (!data) return;
    var waiter = data.id ? waiters[data.id] : null;
    if (data.type === "ready" && waiters.connect && !waiter) waiter = waiters.connect;
    if (data.type === "pong" && waiters.connect) waiter = waiters.connect;
    if (!waiter) return;
    if (data.id) delete waiters[data.id];
    waiter.settle(data);
  }

  function ensureListener(view) {
    if (listening || !view || typeof view.addEventListener !== "function") return;
    view.addEventListener("message", onMessage);
    listening = true;
  }

  function post(view, message) {
    if (!view || typeof view.postMessage !== "function") throw new Error("Failed to fetch");
    view.postMessage(JSON.stringify(message));
  }

  function loadPage(url, ms) {
    return new Promise(function (resolve, reject) {
      var view = element();
      if (!view) {
        reject(new Error("Failed to fetch"));
        return;
      }
      var gen = (connectGen += 1);
      ensureListener(view);
      var timer = setTimeout(function () {
        if (gen !== connectGen) return;
        delete waiters.connect;
        reject(new Error("timeout"));
      }, ms || connectTimeoutMs(url, 0));
      waiters.connect = {
        settle: function () {
          if (gen !== connectGen) return;
          clearTimeout(timer);
          delete waiters.connect;
          resolve(true);
        }
      };
      if (typeof view.addEventListener === "function") {
        var onLoad = function () {
          view.removeEventListener("load", onLoad);
          if (gen !== connectGen) return;
          try { post(view, { id: "connect", type: "ping" }); } catch (error) {}
        };
        view.addEventListener("load", onLoad);
      }
      view.src = url;
    });
  }

  async function connect() {
    var pages = pageList();
    var lastError = null;
    for (var index = 0; index < pages.length; index += 1) {
      try {
        await loadPage(pages[index], connectTimeoutMs(pages[index], index));
        origin = originFromPage(pages[index]);
        return origin;
      } catch (error) {
        lastError = error;
        connectGen += 1;
      }
    }
    throw lastError || new Error("Cannot reach the color server");
  }

  function fetchImpl(url, requestOptions) {
    var view = element();
    var path = pluginPathFromUrl(url);
    var accept = requestOptions && requestOptions.headers && requestOptions.headers.Accept;
    var id = "r" + (seq += 1);
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        delete waiters[id];
        reject(new Error("timeout"));
      }, path.indexOf("/file") !== -1 ? 120000 : 8000);
      waiters[id] = {
        settle: function (data) {
          clearTimeout(timer);
          if (data.type === "error") {
            reject(new Error(data.error || "Failed to fetch"));
            return;
          }
          resolve({
            ok: Boolean(data.ok),
            status: data.status || 0,
            json: function () { return Promise.resolve(data.json); },
            arrayBuffer: function () {
              if (data.base64) return Promise.resolve(decodeBase64(data.base64));
              return Promise.resolve(new ArrayBuffer(0));
            }
          });
        }
      };
      try {
        post(view, { id: id, type: "get", path: path, accept: accept || "application/json" });
      } catch (error) {
        clearTimeout(timer);
        delete waiters[id];
        reject(error);
      }
    });
  }

  return {
    connect: connect,
    fetch: fetchImpl,
    origin: function () { return origin; }
  };
}

module.exports = {
  createWebviewBridge: createWebviewBridge,
  pluginPathFromUrl: pluginPathFromUrl,
  connectTimeoutMs: connectTimeoutMs,
  originFromPage: originFromPage
};
