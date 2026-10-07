var pluginConfig = require("./config.js");

function defaultServerUrls() {
  return pluginConfig.portalHosts.slice();
}

function connectionHosts(saved, portalHosts) {
  var list = [];
  function add(host) {
    if (!host || list.indexOf(host) !== -1) return;
    list.push(host);
  }
  (portalHosts || defaultServerUrls()).forEach(add);
  (saved || []).forEach(add);
  return list;
}

function isLoopbackHost(host) {
  try {
    var hostname = new URL(host).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch (error) {
    return false;
  }
}

function orderedConnectHosts(hosts, preferred) {
  var list = [];
  function add(host) {
    if (!host || list.indexOf(host) !== -1) return;
    list.push(host);
  }
  add(preferred);
  (hosts || []).forEach(add);
  var remote = [];
  var loopback = [];
  list.forEach(function (host) {
    if (isLoopbackHost(host)) loopback.push(host);
    else remote.push(host);
  });
  if (preferred && isLoopbackHost(preferred)) {
    return [preferred].concat(loopback.filter(function (host) { return host !== preferred; })).concat(remote);
  }
  return remote.concat(loopback);
}

function serverUrlsFromInput(text) {
  var value = String(text || "").trim().replace(/\/+$/, "");
  if (!value) return defaultServerUrls();
  var url;
  try { url = new URL(value); } catch (error) { throw new Error("Enter a server address."); }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("Enter a server address.");
  }
  return [url.origin];
}

function createMemorySettings(initial) {
  var data = Object.assign({}, initial || {});
  return {
    async getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    async setItem(key, value) {
      data[key] = String(value);
    }
  };
}

function normalizePreferredHost(value) {
  if (!value) return "";
  try { return serverUrlsFromInput(String(value))[0]; } catch (error) { return ""; }
}

function normalizeRecord(parsed) {
  var serverUrls = defaultServerUrls();
  if (parsed && Array.isArray(parsed.serverUrls) && parsed.serverUrls.length) {
    try {
      serverUrls = parsed.serverUrls.map(function (item) { return serverUrlsFromInput(item)[0]; });
    } catch (error) {
      serverUrls = defaultServerUrls();
    }
  }
  return {
    serverUrls: serverUrls,
    preferredHost: normalizePreferredHost(parsed && parsed.preferredHost)
  };
}

function createStudioSettings(options) {
  var storage = options.storage;
  var storageKey = options.namespace + ":studio";
  return {
    async read() {
      try {
        var raw = await storage.getItem(storageKey);
        return normalizeRecord(raw ? JSON.parse(raw) : null);
      } catch (error) {
        return { serverUrls: defaultServerUrls(), preferredHost: "" };
      }
    },
    async write(next) {
      var current = { preferredHost: "" };
      try {
        var raw = await storage.getItem(storageKey);
        current = normalizeRecord(raw ? JSON.parse(raw) : null);
      } catch (error) {}
      var serverUrls = next && Array.isArray(next.serverUrls) && next.serverUrls.length
        ? next.serverUrls.map(function (item) { return serverUrlsFromInput(item)[0]; })
        : defaultServerUrls();
      var preferredHost = next && Object.prototype.hasOwnProperty.call(next, "preferredHost")
        ? normalizePreferredHost(next.preferredHost)
        : current.preferredHost;
      await storage.setItem(storageKey, JSON.stringify({ serverUrls: serverUrls, preferredHost: preferredHost }));
      return { serverUrls: serverUrls, preferredHost: preferredHost };
    }
  };
}

module.exports = {
  createMemorySettings: createMemorySettings,
  createStudioSettings: createStudioSettings,
  connectionHosts: connectionHosts,
  orderedConnectHosts: orderedConnectHosts,
  isLoopbackHost: isLoopbackHost,
  defaultServerUrls: defaultServerUrls,
  serverUrlsFromInput: serverUrlsFromInput
};
