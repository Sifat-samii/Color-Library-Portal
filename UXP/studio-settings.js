var pluginConfig = require("./config.js");

function defaultServerUrls() {
  return pluginConfig.portalHosts.slice();
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

function normalizeRecord(parsed) {
  var serverUrls = defaultServerUrls();
  if (parsed && Array.isArray(parsed.serverUrls) && parsed.serverUrls.length) {
    try {
      serverUrls = parsed.serverUrls.map(function (item) { return serverUrlsFromInput(item)[0]; });
    } catch (error) {
      serverUrls = defaultServerUrls();
    }
  }
  return { serverUrls: serverUrls };
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
        return { serverUrls: defaultServerUrls() };
      }
    },
    async write(next) {
      var serverUrls = next && Array.isArray(next.serverUrls) && next.serverUrls.length
        ? next.serverUrls.map(function (item) { return serverUrlsFromInput(item)[0]; })
        : defaultServerUrls();
      await storage.setItem(storageKey, JSON.stringify({ serverUrls: serverUrls }));
      return { serverUrls: serverUrls };
    }
  };
}

module.exports = {
  createMemorySettings: createMemorySettings,
  createStudioSettings: createStudioSettings,
  defaultServerUrls: defaultServerUrls,
  serverUrlsFromInput: serverUrlsFromInput
};
