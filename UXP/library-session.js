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

  async function scan(useDisk) {
    if (!state.selectedClient || !state.portalCatalog) return;
    try {
      state.favorites = await readJson(clientKey("favorites", state.selectedClient.id), {});
      var found = useDisk && state.rootFolder ? await files.scan(state.rootFolder) : [];
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

  async function openClient(clientId, offline, warmedCatalog) {
    var client = state.clients.find(function (item) { return item.id === clientId; });
    if (!client) return snapshot();
    state.connectionError = null;
    state.notice = null;
    state.selectedClient = client;
    state.rootFolder = null;
    await storage.set(storageKey("selected-client"), client.id);
    var cached = await readJson(storageKey("catalog-cache:" + client.id), null);
    var cachedCatalog = cached && cached.catalog && Array.isArray(cached.catalog.colors) ? cached : null;
    if (offline) {
      if (!cachedCatalog) {
        state.serverOnline = false;
        state.connectionError = client.code + ": No offline catalog has been saved for this client yet";
        return snapshot();
      }
      state.portalCatalog = cachedCatalog.catalog;
      state.cacheSavedAt = cachedCatalog.savedAt;
      state.serverOnline = false;
    } else if (warmedCatalog && Array.isArray(warmedCatalog.colors)) {
      state.portalCatalog = warmedCatalog;
      state.serverOnline = true;
      state.cacheSavedAt = clock();
      await writeJson(storageKey("catalog-cache:" + client.id), { savedAt: state.cacheSavedAt, catalog: state.portalCatalog });
    } else {
      try {
        state.portalCatalog = await portal.getJson("/api/plugin/clients/" + encodeURIComponent(client.id) + "/catalog");
        state.serverOnline = true;
        state.cacheSavedAt = clock();
        await writeJson(storageKey("catalog-cache:" + client.id), { savedAt: state.cacheSavedAt, catalog: state.portalCatalog });
      } catch (error) {
        if (!cachedCatalog) {
          state.serverOnline = false;
          state.connectionError = client.code + ": " + error.message;
          return snapshot();
        }
        state.portalCatalog = cachedCatalog.catalog;
        state.cacheSavedAt = cachedCatalog.savedAt;
        state.serverOnline = false;
      }
    }
    await scan(false);
    return snapshot();
  }

  async function attachLocal() {
    if (!state.selectedClient || !state.selectedClient.localFolderPath) return snapshot();
    try {
      state.rootFolder = await files.openFolder(state.selectedClient.localFolderPath);
    } catch (error) {
      state.rootFolder = null;
      return snapshot();
    }
    await scan(true);
    return snapshot();
  }

  async function hydrateFromCache() {
    var cached = await readJson(storageKey("clients-cache"), null);
    if (!cached || !Array.isArray(cached.clients) || !cached.clients.length) return null;
    state.clients = cached.clients;
    state.serverOnline = false;
    state.connectionError = null;
    var savedId = await storage.get(storageKey("selected-client"));
    var selected = state.clients.find(function (client) { return client.id === savedId; }) || state.clients[0];
    if (!selected) return null;
    state.selectedClient = selected;
    var catalogCache = await readJson(storageKey("catalog-cache:" + selected.id), null);
    if (!catalogCache || !catalogCache.catalog || !Array.isArray(catalogCache.catalog.colors)) return snapshot();
    state.portalCatalog = catalogCache.catalog;
    state.cacheSavedAt = catalogCache.savedAt;
    state.rootFolder = null;
    state.favorites = await readJson(clientKey("favorites", selected.id), {});
    state.catalog = catalogTools.buildManagedCatalog([], null, state.portalCatalog);
    state.files = [];
    state.catalog.forEach(function (group) {
      (group.refs || []).forEach(function (ref) { state.files.push(ref); });
    });
    return snapshot();
  }

  async function loadFromPortal() {
    state.connectionError = null;
    state.notice = null;
    var savedId = await storage.get(storageKey("selected-client"));
    try {
      var catalogPromise = savedId
        ? portal.getJson("/api/plugin/clients/" + encodeURIComponent(savedId) + "/catalog").then(function (catalog) { return catalog; }, function () { return null; })
        : Promise.resolve(null);
      var payload = await portal.getJson("/api/plugin/clients");
      var warmed = await catalogPromise;
      var clients = payload.clients || [];
      if (!clients.length) throw new Error("No active client libraries are configured yet");
      state.clients = clients;
      state.serverOnline = true;
      await writeJson(storageKey("clients-cache"), { savedAt: clock(), clients: clients });
      var selected = clients.find(function (client) { return client.id === savedId; }) || clients[0];
      return openClient(selected.id, false, selected && selected.id === savedId ? warmed : null);
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
    await scan(false);
    return snapshot();
  }

  return {
    hydrate: function () { return enqueue(hydrateFromCache); },
    start: function () { return enqueue(loadFromPortal); },
    attachLocal: function () { return enqueue(attachLocal); },
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
