var catalogTools = require("./catalog.js");

function createLibrarySession(options) {
  var portal = options.portal;
  var storage = options.storage;
  var files = options.files;
  var clock = options.clock || function () { return Date.now(); };
  var namespace = options.namespace;
  var state = {
    clients: [],
    selectedClient: null,
    rootFolder: null,
    portalCatalog: null,
    files: [],
    catalog: [],
    favorites: {},
    baseline: null,
    serverOnline: false,
    cacheSavedAt: null,
    connectionError: null,
    notice: null,
    swatches: null,
    swatchOffline: false,
    swatchNotice: ""
  };
  var tail = Promise.resolve();

  function enqueue(task) {
    var run = tail.then(task, task);
    tail = run.then(function () { return null; }, function () { return null; });
    return run;
  }

  function storageKey(suffix) {
    return namespace + ":" + suffix;
  }

  function clientKey(kind, clientId) {
    return namespace + ":" + kind + ":" + clientId;
  }

  async function readJson(key, fallback) {
    try {
      var value = await storage.get(key);
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  async function writeJson(key, value) {
    await storage.set(key, JSON.stringify(value));
  }

  function snapshot() {
    return {
      clients: state.clients.slice(),
      selectedClient: state.selectedClient,
      serverOnline: state.serverOnline,
      cacheSavedAt: state.cacheSavedAt,
      catalog: state.catalog,
      files: state.files.slice(),
      favorites: Object.assign({}, state.favorites),
      baseline: state.baseline,
      rootReady: Boolean(state.selectedClient && state.portalCatalog),
      localFolder: Boolean(state.rootFolder),
      connectionError: state.connectionError,
      notice: state.notice,
      swatches: state.swatches,
      swatchOffline: state.swatchOffline,
      swatchNotice: state.swatchNotice
    };
  }

  async function scan() {
    if (!state.selectedClient || !state.portalCatalog) return;
    try {
      state.favorites = await readJson(clientKey("favorites", state.selectedClient.id), {});
      var found = state.rootFolder ? await files.scan(state.rootFolder) : [];
      state.baseline = await readJson(clientKey("baseline", state.selectedClient.id), null);
      state.catalog = catalogTools.buildManagedCatalog(found, state.baseline, state.portalCatalog);
      var migrated = false;
      state.catalog.forEach(function (group) {
        if (!state.favorites[group.id] && state.favorites[group.normalizedKey]) {
          state.favorites[group.id] = true;
          migrated = true;
        }
      });
      if (migrated) await writeJson(clientKey("favorites", state.selectedClient.id), state.favorites);
      state.files = [];
      state.catalog.forEach(function (group) {
        (group.refs || []).forEach(function (ref) { state.files.push(ref); });
      });
      state.notice = null;
    } catch (error) {
      state.notice = "Approved colors could not be scanned. Ask an administrator to verify the folder. " + error.message;
    }
  }

  async function openClient(clientId, offline) {
    var client = state.clients.find(function (item) { return item.id === clientId; });
    if (!client) return snapshot();
    state.connectionError = null;
    state.notice = null;
    state.selectedClient = client;
    await storage.set(storageKey("selected-client"), client.id);
    try {
      state.rootFolder = client.localFolderPath ? await files.openFolder(client.localFolderPath) : null;
    } catch (error) {
      state.rootFolder = null;
    }
    var cached = await readJson(storageKey("catalog-cache:" + client.id), null);
    var cachedCatalog = cached && cached.catalog && Array.isArray(cached.catalog.colors) ? cached : null;
    if (offline) {
      if (!cachedCatalog) {
        state.rootFolder = null;
        state.serverOnline = false;
        state.connectionError = client.code + ": No offline catalog has been saved for this client yet";
        return snapshot();
      }
      state.portalCatalog = cachedCatalog.catalog;
      state.cacheSavedAt = cachedCatalog.savedAt;
      state.serverOnline = false;
    } else {
      try {
        state.portalCatalog = await portal.getJson("/api/plugin/clients/" + encodeURIComponent(client.id) + "/catalog");
        state.serverOnline = true;
        state.cacheSavedAt = clock();
        await writeJson(storageKey("catalog-cache:" + client.id), { savedAt: state.cacheSavedAt, catalog: state.portalCatalog });
      } catch (error) {
        if (!cachedCatalog) {
          state.rootFolder = null;
          state.serverOnline = false;
          state.connectionError = client.code + ": " + error.message;
          return snapshot();
        }
        state.portalCatalog = cachedCatalog.catalog;
        state.cacheSavedAt = cachedCatalog.savedAt;
        state.serverOnline = false;
      }
    }
    await scan();
    return snapshot();
  }

  async function loadFromPortal() {
    state.connectionError = null;
    state.notice = null;
    try {
      var payload = await portal.getJson("/api/plugin/clients");
      var clients = payload.clients || [];
      if (!clients.length) throw new Error("No active client libraries are configured yet");
      state.clients = clients;
      state.serverOnline = true;
      await writeJson(storageKey("clients-cache"), { savedAt: clock(), clients: clients });
      var savedId = await storage.get(storageKey("selected-client"));
      var selected = clients.find(function (client) { return client.id === savedId; }) || clients[0];
      return openClient(selected.id, false);
    } catch (error) {
      state.serverOnline = false;
      var cached = await readJson(storageKey("clients-cache"), null);
      if (!cached || !Array.isArray(cached.clients) || !cached.clients.length) {
        state.clients = [];
        state.selectedClient = null;
        state.rootFolder = null;
        state.connectionError = error.message;
        return snapshot();
      }
      state.clients = cached.clients;
      var savedId = await storage.get(storageKey("selected-client"));
      var selected = state.clients.find(function (client) { return client.id === savedId; }) || state.clients[0];
      return openClient(selected.id, true);
    }
  }

  async function reloadCatalog() {
    if (!state.selectedClient) return loadFromPortal();
    state.connectionError = null;
    try {
      state.portalCatalog = await portal.getJson("/api/plugin/clients/" + encodeURIComponent(state.selectedClient.id) + "/catalog");
      state.serverOnline = true;
      state.cacheSavedAt = clock();
      await writeJson(storageKey("catalog-cache:" + state.selectedClient.id), { savedAt: state.cacheSavedAt, catalog: state.portalCatalog });
    } catch (error) {
      var cached = await readJson(storageKey("catalog-cache:" + state.selectedClient.id), null);
      var cachedCatalog = cached && cached.catalog && Array.isArray(cached.catalog.colors) ? cached : null;
      if (!cachedCatalog) {
        state.rootFolder = null;
        state.serverOnline = false;
        state.connectionError = error.message;
        return snapshot();
      }
      state.portalCatalog = cachedCatalog.catalog;
      state.cacheSavedAt = cachedCatalog.savedAt;
      state.serverOnline = false;
    }
    await scan();
    return snapshot();
  }

  return {
    start: function () { return enqueue(loadFromPortal); },
    selectClient: function (clientId) { return enqueue(function () { return openClient(clientId, false); }); },
    refresh: function () { return enqueue(reloadCatalog); },
    markReviewed: function () {
      return enqueue(async function () {
        if (!state.selectedClient) return snapshot();
        state.baseline = catalogTools.createBaseline(state.files, clock());
        await writeJson(clientKey("baseline", state.selectedClient.id), state.baseline);
        state.catalog = catalogTools.buildManagedCatalog(state.files, state.baseline, state.portalCatalog);
        state.files = [];
        state.catalog.forEach(function (group) {
          (group.refs || []).forEach(function (ref) { state.files.push(ref); });
        });
        state.notice = null;
        return snapshot();
      });
    },
    toggleFavorite: function (id) {
      return enqueue(async function () {
        if (!state.selectedClient) return snapshot();
        if (state.favorites[id]) delete state.favorites[id];
        else state.favorites[id] = true;
        await writeJson(clientKey("favorites", state.selectedClient.id), state.favorites);
        return snapshot();
      });
    },
    loadSwatches: function () {
      return enqueue(async function () {
        try {
          var payload = await portal.getJson("/api/plugin/swatches");
          state.swatches = payload.colors || [];
          state.swatchOffline = false;
          state.swatchNotice = "";
          await writeJson(storageKey("swatches"), { savedAt: clock(), colors: state.swatches });
        } catch (error) {
          var cached = await readJson(storageKey("swatches"), null);
          if (cached && Array.isArray(cached.colors) && cached.colors.length && !state.swatches) {
            state.swatches = cached.colors;
            state.swatchOffline = true;
            state.swatchNotice = "Could not refresh swatches.";
          } else if (!state.swatches || !state.swatches.length) {
            state.swatches = null;
            state.swatchOffline = false;
            state.swatchNotice = "";
          } else {
            state.swatchNotice = "Could not refresh swatches.";
          }
        }
        return snapshot();
      });
    },
    snapshot: snapshot
  };
}

module.exports = { createLibrarySession: createLibrarySession };
