const { storage } = require("uxp");
const { app, core } = require("photoshop");
const config = require("./config.js");
const catalogTools = require("./catalog.js");
const { createPortalClient } = require("./portal-client.js");
const { createStudioSettings } = require("./studio-settings.js");
const { createLibrarySession } = require("./library-session.js");
const { createApprovedList, createSwatchList, cardPlan } = require("./library-list.js");
const { scanLibraryFolder } = require("./folder-scan.js");

const fs = storage.localFileSystem;
const SEARCH_DELAY = 150;

const studio = { serverUrls: [] };
const approvedList = createApprovedList({ pageSize: 0 });
const swatchList = createSwatchList({ pageSize: 0 });
const ui = {
  library: "approved",
  selectedId: null,
  selectedSwatchId: null,
  scanning: false,
  swatchLoading: false
};
let current = emptySnapshot();
let approvedCards = [];
let swatchCards = [];
let searchTimer = 0;
let swatchSearchTimer = 0;
let copyHexTimer = 0;

const settings = createStudioSettings({ storage: createSecretStorage(), namespace: config.storageNamespace });
const portal = createPortalClient({
  hosts: function () {
    var hosts = (studio.serverUrls || []).slice();
    config.portalHosts.forEach(function (host) {
      if (hosts.indexOf(host) === -1) hosts.push(host);
    });
    return hosts;
  },
  fetchImpl: fetch
});
const session = createLibrarySession({
  portal: portal,
  storage: {
    get: function (key) {
      try { return localStorage.getItem(key); } catch (error) { return null; }
    },
    set: function (key, value) { localStorage.setItem(key, value); }
  },
  files: {
    openFolder: openLibraryFolder,
    scan: function (folder) {
      return scanLibraryFolder(folder, {
        extensions: config.supportedExtensions,
        fileUrl: function (entry) { return fs.getFsUrl(entry); }
      });
    }
  },
  namespace: config.storageNamespace
});

function emptySnapshot() {
  return {
    clients: [],
    selectedClient: null,
    serverOnline: false,
    cacheSavedAt: null,
    catalog: [],
    files: [],
    favorites: {},
    baseline: null,
    rootReady: false,
    localFolder: false,
    connectionError: null,
    notice: null,
    swatches: null,
    swatchOffline: false,
    swatchNotice: ""
  };
}

function createSecretStorage() {
  var secure = null;
  try { secure = storage.secureStorage; } catch (error) { secure = null; }
  return {
    async getItem(key) {
      if (secure && secure.getItem) {
        try {
          var stored = await secure.getItem(key);
          if (stored) return typeof stored === "string" ? stored : new TextDecoder().decode(stored);
        } catch (error) {}
      }
      try { return localStorage.getItem(key); } catch (error) { return null; }
    },
    async setItem(key, value) {
      if (secure && secure.setItem) {
        try {
          await secure.setItem(key, value);
          try { localStorage.removeItem(key); } catch (error) {}
          return;
        } catch (error) {
          try {
            await secure.setItem(key, new TextEncoder().encode(value));
            try { localStorage.removeItem(key); } catch (ignored) {}
            return;
          } catch (again) {}
        }
      }
      localStorage.setItem(key, value);
    }
  };
}

function $(selector) { return document.querySelector(selector); }

function starIcon(filled) {
  return "<span class=\"star-glyph\" style=\"color:" + (filled ? "#1a1204" : "#f4f4f5") + "\" aria-hidden=\"true\">" + (filled ? "★" : "☆") + "</span>";
}

function savedButtonStyle(filled) {
  return filled ? " style=\"background-color:#ffc94d;color:#1a1204;border-color:#ffc94d\"" : "";
}

var EMPTY_ICONS = {
  search: "<span class=\"empty-glyph\">⌕</span>",
  check: "<span class=\"empty-glyph\">✓</span>",
  star: "<span class=\"empty-glyph\">★</span>"
};

function swatchColor(hex) {
  var value = String(hex || "").trim().replace(/^#/, "");
  return /^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? "#" + value : "";
}

function plural(count, word) {
  return count + " " + word + (count === 1 ? "" : "s");
}

function referenceSummary(group) {
  var present = group.refs.length;
  var missing = group.missingRefs ? group.missingRefs.length : 0;
  if (!present && missing) return "Not synced";
  return plural(present, "reference");
}

var OPEN_ICON = "<span class=\"card-open\" aria-hidden=\"true\">›</span>";

function nativePathToFileUrl(nativePath) {
  var normalized = String(nativePath || "").replace(/\\/g, "/");
  return "file:/" + normalized;
}

async function openLibraryFolder(nativePath) {
  var folder = await fs.getEntryWithUrl(nativePathToFileUrl(nativePath));
  if (!folder || !folder.isFolder) throw new Error("The configured local folder is unavailable");
  return folder;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setBusy(isBusy, title, detail) {
  ui.scanning = isBusy;
  $("#busyOverlay").classList.toggle("is-hidden", !isBusy);
  $("#busyTitle").textContent = title || "Scanning approved colors…";
  $("#busyDetail").textContent = detail || "Checking references and updates";
  $("#retryConnectionButton").disabled = isBusy;
  $("#clientSelect").disabled = isBusy || current.clients.length === 0;
  if ($("#clientSelect").disabled) setClientMenuOpen(false);
  $("#refreshButton").disabled = isBusy || (ui.library !== "swatches" && !current.rootReady);
}

function clientLabel(client) {
  var code = String(client.code || "").trim();
  var name = String(client.name || "").trim();
  return code.toLowerCase() === name.toLowerCase() ? code : code + " — " + name;
}

function renderClientOptions(selectedId) {
  var selectedClient = current.clients.find(function (client) { return client.id === selectedId; });
  $("#clientSelectLabel").textContent = selectedClient ? clientLabel(selectedClient) : (current.clients.length ? clientLabel(current.clients[0]) : "No workspaces");
  $("#clientMenu").innerHTML = current.clients.map(function (client) {
    var selected = client.id === selectedId;
    return "<div tabindex=\"0\" class=\"client-option" + (selected ? " is-selected" : "") +
      "\" role=\"option\" aria-selected=\"" + (selected ? "true" : "false") +
      "\" data-client-id=\"" + escapeHtml(client.id) + "\"><span class=\"client-option-label\">" +
      escapeHtml(clientLabel(client)) + "</span></div>";
  }).join("");
  $("#clientSelect").disabled = ui.scanning || current.clients.length === 0;
  setClientMenuOpen(false);
}

function clientMenuOptions() {
  return Array.prototype.slice.call($("#clientMenu").querySelectorAll(".client-option"));
}

function setClientMenuOpen(open) {
  var button = $("#clientSelect");
  var menu = $("#clientMenu");
  var shouldOpen = Boolean(open && !button.disabled && current.clients.length);
  if (shouldOpen) setSortMenuOpen(false);
  button.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
  menu.classList.toggle("is-hidden", !shouldOpen);
  $(".app-shell").classList.toggle("is-client-menu-open", shouldOpen);
  if (shouldOpen) {
    var selected = menu.querySelector(".client-option.is-selected");
    var options = clientMenuOptions();
    (selected || options[0]).focus();
  }
}

function clientOptionFromTarget(node) {
  var menu = $("#clientMenu");
  while (node && node !== menu) {
    if (node.classList && node.classList.contains("client-option")) return node;
    node = node.parentNode;
  }
  return null;
}

function chooseClientOption(option) {
  var clientId = option && option.getAttribute("data-client-id");
  var clientExists = current.clients.some(function (client) { return client.id === clientId; });
  if (!clientId || !clientExists) return;
  setClientMenuOpen(false);
  $("#clientSelect").focus();
  if (option.classList.contains("is-selected")) return;
  selectClient(clientId);
}

function moveClientOptionFocus(direction) {
  var options = clientMenuOptions();
  if (!options.length) return;
  var index = options.indexOf(document.activeElement);
  var next = index < 0 ? 0 : (index + direction + options.length) % options.length;
  options[next].focus();
}

var SORT_LABELS = { name: "A–Z", recent: "Recent" };

function sortMenuOptions() {
  return Array.prototype.slice.call($("#sortMenu").querySelectorAll(".sort-option"));
}

function setSortMenuOpen(open) {
  var button = $("#sortSelect");
  var menu = $("#sortMenu");
  var shouldOpen = Boolean(open);
  if (shouldOpen) setClientMenuOpen(false);
  button.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
  menu.classList.toggle("is-hidden", !shouldOpen);
  $(".app-shell").classList.toggle("is-sort-menu-open", shouldOpen);
  if (shouldOpen) {
    var selected = menu.querySelector(".sort-option.is-selected");
    var options = sortMenuOptions();
    (selected || options[0]).focus();
  }
}

function sortOptionFromTarget(node) {
  var menu = $("#sortMenu");
  while (node && node !== menu) {
    if (node.classList && node.classList.contains("sort-option")) return node;
    node = node.parentNode;
  }
  return null;
}

function chooseSortOption(option) {
  var sortValue = option && option.getAttribute("data-sort");
  if (!SORT_LABELS[sortValue]) return;
  sortMenuOptions().forEach(function (item) {
    var selected = item === option;
    item.classList.toggle("is-selected", selected);
    item.setAttribute("aria-selected", selected ? "true" : "false");
  });
  $("#sortSelectLabel").textContent = SORT_LABELS[sortValue];
  $("#sortSelect").setAttribute("aria-label", "Sort colors: " + SORT_LABELS[sortValue]);
  setSortMenuOpen(false);
  $("#sortSelect").focus();
  approvedList.setSort(sortValue);
  render();
}

function moveSortOptionFocus(direction) {
  var options = sortMenuOptions();
  if (!options.length) return;
  var index = options.indexOf(document.activeElement);
  var next = index < 0 ? 0 : (index + direction + options.length) % options.length;
  options[next].focus();
}

function updateConnection() {
  var dot = $("#connectionDot");
  if (current.connectionError) {
    dot.classList.remove("is-linked");
    $("#connectionTitle").textContent = "Offline";
    setConnectionPath(studio.serverUrls[0] || "");
    $("#welcomeTitle").textContent = "Color server unavailable";
    setWelcomeCopy(current.connectionError);
    $("#retryConnectionButton").classList.remove("is-hidden");
    return;
  }
  dot.classList.toggle("is-linked", current.serverOnline);
  $("#connectionTitle").textContent = current.serverOnline ? "Synced" : "Offline cache";
  setConnectionPath(current.serverOnline || !current.cacheSavedAt ? "" : "Last synced " + formatDate(current.cacheSavedAt));
  $("#retryConnectionButton").classList.remove("is-hidden");
}

function setWelcomeCopy(text) {
  $("#welcomeCopy").textContent = text || "";
  $("#welcomeCopy").classList.toggle("is-hidden", !text);
}

function setConnectionPath(text) {
  $("#connectionPath").textContent = text;
  $("#connectionPath").classList.toggle("is-hidden", !text);
}

function noticeMarkup(title, copy, action) {
  return "<div class=\"notice-copy\"><strong>" + title + "</strong><span>" + copy + "</span></div>" +
    "<button id=\"reviewButton\" class=\"secondary-button\">" + action + "</button>";
}

function renderNotice() {
  var notice = $("#notice");
  if (current.notice) {
    notice.textContent = current.notice;
    notice.classList.add("is-error");
    notice.classList.remove("is-hidden");
    return;
  }
  var changes = (current.catalog || []).filter(function (group) { return group.changeKinds.length > 0; }).length;
  notice.classList.remove("is-error");
  if (!current.rootReady || !current.localFolder) {
    notice.classList.add("is-hidden");
    notice.innerHTML = "";
    return;
  }
  if (!current.baseline) {
    notice.innerHTML = noticeMarkup("First sync", "Save a snapshot to track file changes.", "Save snapshot");
    notice.classList.remove("is-hidden");
  } else if (changes > 0) {
    notice.innerHTML = noticeMarkup(plural(changes, "color") + " to review", "Check the local files, then update the snapshot.", "Update snapshot");
    notice.classList.remove("is-hidden");
  } else {
    notice.classList.add("is-hidden");
    notice.innerHTML = "";
  }
}

function paint(snap) {
  current = snap;
  approvedList.setCatalog(current.catalog || []);
  approvedList.setFavorites(current.favorites || {});
  if (current.swatches) swatchList.setColors(current.swatches);
  renderClientOptions(current.selectedClient ? current.selectedClient.id : "");
  updateConnection();
  applyLibraryView();
  renderNotice();
  render();
  if (ui.library === "swatches") renderSwatches();
}

async function boot() {
  setBusy(true, "Connecting to color server…", "Loading managed client libraries");
  try {
    var snap = await session.start();
    approvedList.resetPage();
    paint(snap);
  } finally {
    setBusy(false);
  }
}

async function refreshLibrary() {
  if (!current.selectedClient) return boot();
  setBusy(true, "Scanning approved colors…", "Checking " + (current.selectedClient.code || "library") + " approved colors");
  try {
    var snap = await session.refresh();
    approvedList.resetPage();
    paint(snap);
  } finally {
    setBusy(false);
  }
}

async function selectClient(clientId) {
  var client = current.clients.find(function (item) { return item.id === clientId; });
  setBusy(true, "Loading " + (client ? client.name : "library") + "…", "Opening approved colors");
  try {
    closeDetails();
    var snap = await session.selectClient(clientId);
    approvedList.resetPage();
    paint(snap);
  } finally {
    setBusy(false);
  }
}

async function markReviewed() {
  var snap = await session.markReviewed();
  paint(snap);
}

function changeLabel(group) {
  if (group.changeKinds.indexOf("updated") !== -1) return "UPDATED";
  if (group.changeKinds.indexOf("missing") !== -1) return "MISSING";
  if (group.changeKinds.indexOf("added") !== -1) return "NEW";
  return "";
}

function previewUrl(ref) {
  if (!ref || !ref.versionId) return "";
  var host = portal.activeHost();
  if (!host) return "";
  return host + "/api/plugin/versions/" + encodeURIComponent(ref.versionId) + "/preview";
}

function managedCardMarkup(group) {
  var ref = group.preferredRef;
  var preview = previewUrl(ref);
  var thumbnail = preview
    ? "<img src=\"" + escapeHtml(preview) + "\" alt=\"\" loading=\"lazy\" decoding=\"async\">"
    : "";
  var label = changeLabel(group);
  var badge = label ? "<span class=\"change-badge " + (label === "MISSING" ? "is-missing" : "") + "\">" + label + "</span>" : "";
  var swatch = swatchColor(group.hexCode);
  var fallbackStyle = swatch ? " style=\"background-color: " + swatch + "\"" : "";
  var dot = swatch ? "<span class=\"color-swatch\" style=\"background-color: " + swatch + "\" aria-hidden=\"true\"></span>" : "";
  var code = group.colorCode ? "<span class=\"color-code\" title=\"" + escapeHtml(group.colorCode) + "\">" + escapeHtml(group.colorCode) + "</span>" : "";
  var favorite = Boolean(current.favorites[group.id]);
  var summary = referenceSummary(group);
  var accessible = "Open " + group.displayName + ", " + summary + (group.colorCode ? ", " + group.colorCode : "");
  var savedMark = favorite ? "<span class=\"saved-chip\">Saved</span>" : "";
  return "<article class=\"color-card" + (favorite ? " is-saved" : "") + "\" data-id=\"" + escapeHtml(group.id) + "\" tabindex=\"0\" role=\"link\" aria-label=\"" + escapeHtml(accessible) + "\">" +
    "<div class=\"thumb-wrap\">" + thumbnail + "<div class=\"thumb-fallback\"" + fallbackStyle + ">" + (swatch ? "" : escapeHtml(group.displayName.charAt(0) || "")) + "</div>" + badge + "</div>" +
    "<div class=\"card-body\"><div class=\"color-title-row\">" + dot + "<h3 class=\"color-name\" title=\"" + escapeHtml(group.displayName) + "\">" + escapeHtml(group.displayName) + "</h3>" + OPEN_ICON + "</div>" +
    "<div class=\"color-meta-row\"><span class=\"color-meta\">" + escapeHtml(summary) + savedMark + "</span>" + code + "</div></div>" +
    "<button type=\"button\" class=\"favorite-button" + (favorite ? " is-favorite" : "") + "\"" + savedButtonStyle(favorite) + " aria-pressed=\"" + (favorite ? "true" : "false") + "\" aria-label=\"" + (favorite ? "Remove from saved" : "Save color") + "\" title=\"" + (favorite ? "Remove from saved" : "Save color") + "\">" + starIcon(favorite) + "</button></article>";
}

function renderEmptyState(view) {
  $("#noResults").classList.toggle("is-hidden", view.cards.length !== 0);
  if (view.cards.length) return;
  $("#noResultsIcon").innerHTML = EMPTY_ICONS[view.empty.icon];
  $("#noResultsTitle").textContent = view.empty.title;
  $("#noResultsCopy").textContent = view.empty.copy;
  $("#noResultsCopy").classList.toggle("is-hidden", !view.empty.copy);
}

function elementFromMarkup(html) {
  var holder = document.createElement("div");
  holder.innerHTML = html;
  var node = holder.firstChild;
  while (node && node.nodeType !== 1) node = node.nextSibling;
  return node;
}

function applyCards(grid, previous, cards, markup) {
  var actions = cardPlan(previous, cards);
  var byId = {};
  Array.prototype.forEach.call(grid.children, function (node) {
    var id = node.getAttribute && node.getAttribute("data-id");
    if (id) byId[id] = node;
  });
  actions.forEach(function (action) {
    if (action.type === "remove" && byId[action.id] && byId[action.id].parentNode) {
      byId[action.id].parentNode.removeChild(byId[action.id]);
      delete byId[action.id];
    }
  });
  actions.forEach(function (action) {
    if (action.type !== "create" && action.type !== "replace") return;
    var node = elementFromMarkup(markup(action.id));
    if (!node) return;
    if (action.type === "replace" && byId[action.id] && byId[action.id].parentNode) {
      byId[action.id].parentNode.replaceChild(node, byId[action.id]);
    }
    byId[action.id] = node;
    bindBrokenImages(node);
  });
  cards.forEach(function (card, index) {
    var node = byId[card.id];
    if (!node) return;
    var occupant = grid.children[index];
    if (occupant !== node) grid.insertBefore(node, occupant || null);
  });
  while (grid.children.length > cards.length) grid.removeChild(grid.lastChild);
}

function render() {
  var view = approvedList.view();
  var byId = {};
  view.cards.forEach(function (card) { byId[card.id] = card; });
  applyCards($("#colorGrid"), approvedCards, view.cards, function (id) {
    return managedCardMarkup(byId[id].group);
  });
  approvedCards = view.cards.map(function (card) { return { id: card.id, revision: card.revision }; });
  renderEmptyState(view);
  $("#allCount").textContent = view.counts.all;
  $("#favoriteCount").textContent = view.counts.saved;
  $("#summaryBar").innerHTML = "<strong>" + view.matchedCount + "</strong> color" + (view.matchedCount === 1 ? "" : "s") + " · " + plural(view.fileCount, "file");
}

function bindBrokenImages(root) {
  if (!root || !root.querySelectorAll) return;
  Array.prototype.forEach.call(root.querySelectorAll("img"), function (image) {
    if (image.dataset.bound === "1") return;
    image.dataset.bound = "1";
    function markReady() {
      if (image.naturalWidth > 0) image.classList.add("is-ready");
    }
    if (image.complete) markReady();
    image.addEventListener("load", markReady);
    image.addEventListener("error", function () { image.classList.add("is-broken"); });
  });
}

function findGroup(id) {
  return (current.catalog || []).find(function (group) { return group.id === id; });
}

function controlFromEvent(event, className) {
  var node = event.target;
  while (node) {
    if (node.classList && node.classList.contains(className)) return node;
    node = node.parentNode;
  }
  return null;
}

function cardIdFromEvent(event) {
  var node = event.target;
  while (node && node !== event.currentTarget) {
    if (node.getAttribute && node.getAttribute("data-id")) return node.getAttribute("data-id");
    node = node.parentNode;
  }
  return "";
}

async function toggleFavorite(id) {
  var snap = await session.toggleFavorite(id);
  paint(snap);
  if (ui.selectedId === id) updateDetailFavorite();
}

function formatBytes(bytes) {
  if (!bytes) return "0 KB";
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return Math.max(1, Math.round(bytes / 1024)) + " KB";
}

function formatDate(timestamp) {
  if (!timestamp) return "Unknown date";
  return new Date(timestamp).toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function managedReferenceMarkup(ref) {
  var previewSrc = previewUrl(ref);
  var typeName = catalogTools.referenceDisplayName(ref);
  var approval = ref.approvedAt ? "Approved " + formatDate(ref.approvedAt) : "Approved version";
  var format = ref.extension.toUpperCase();
  var preview = previewSrc
    ? "<div class=\"reference-preview\"><img src=\"" + escapeHtml(previewSrc) + "\" alt=\"\" loading=\"lazy\" decoding=\"async\"><div class=\"thumb-fallback\">" + escapeHtml(format) + "</div><span class=\"open-hint\">Open</span></div>"
    : "<div class=\"reference-preview is-file\"><div class=\"thumb-fallback\">" + escapeHtml(format) + "</div><span class=\"open-hint\">Open</span></div>";
  return "<article class=\"reference-item\" tabindex=\"0\" role=\"button\" aria-label=\"Open " + escapeHtml(ref.baseName) + "\">" + preview +
    "<div class=\"reference-info\"><div class=\"reference-topline\"><span class=\"reference-type\">" + escapeHtml(typeName) + "</span><span class=\"file-format\">" + escapeHtml(format) + "</span></div>" +
    "<div class=\"reference-file\" title=\"" + escapeHtml(ref.relativePath) + "\">" + escapeHtml(ref.baseName) + "</div>" +
    "<div class=\"reference-meta\">v" + escapeHtml(ref.versionNumber || 1) + " · " + formatBytes(ref.size) + " · " + escapeHtml(approval) + "</div>" +
    "</div></article>";
}

function showManagedDetails(id) {
  var group = findGroup(id);
  if (!group) return;
  ui.selectedId = id;
  $("#detailTitle").textContent = group.displayName;
  var label = changeLabel(group);
  $("#detailStatus").innerHTML = "<span class=\"status-dot\"></span>" + (label ? label.charAt(0) + label.slice(1).toLowerCase() + " · Needs review" : "Approved for use");
  $("#detailStatus").classList.toggle("needs-review", Boolean(label));
  var identifiers = $("#detailIdentifiers");
  var swatch = swatchColor(group.hexCode);
  identifiers.innerHTML = [
    group.hexCode ? "<span class=\"detail-code\">" + (swatch ? "<i class=\"code-swatch\" style=\"background-color: " + swatch + "\"></i>" : "") + "<span>Hex</span> " + escapeHtml(group.hexCode) + "</span>" : "",
    group.colorCode ? "<span class=\"detail-code\"><span>Pantone</span> " + escapeHtml(group.colorCode) + "</span>" : ""
  ].join("");
  identifiers.classList.toggle("is-hidden", !group.hexCode && !group.colorCode);
  $("#detailInstructionCopy").textContent = "";
  $("#detailInstructions").classList.add("is-hidden");
  var html = group.refs.map(managedReferenceMarkup).join("");
  group.missingRefs.forEach(function (missing) {
    html += "<div class=\"missing-reference\"><strong>Approved file unavailable</strong><span class=\"missing-path\">" + escapeHtml(missing.relativePath) + "</span><span>Sync the portal or contact an administrator.</span></div>";
  });
  $("#referenceList").innerHTML = html;
  $("#referenceCount").textContent = group.refs.length + group.missingRefs.length;
  bindBrokenImages($("#referenceList"));
  Array.prototype.forEach.call($("#referenceList").querySelectorAll(".reference-item"), function (item, index) {
    function open() { openReference(group.refs[index]); }
    item.addEventListener("click", open);
    item.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      open();
    });
  });
  updateDetailFavorite();
  $(".app-shell").classList.add("is-detail");
  $("#detailPanel").classList.remove("is-hidden");
}

function updateDetailFavorite() {
  var button = $("#detailFavoriteButton");
  var favorite = Boolean(ui.selectedId && current.favorites[ui.selectedId]);
  button.innerHTML = starIcon(favorite) + (favorite ? "<span class=\"saved-label\">Saved</span>" : "");
  button.classList.toggle("is-favorite", favorite);
  button.style.backgroundColor = favorite ? "#ffc94d" : "";
  button.style.color = favorite ? "#1a1204" : "";
  button.style.borderColor = favorite ? "#ffc94d" : "";
  button.setAttribute("aria-pressed", favorite ? "true" : "false");
  button.setAttribute("aria-label", favorite ? "Remove from saved" : "Save color");
  button.setAttribute("title", favorite ? "Remove from saved" : "Save color");
}

function closeDetails() {
  $("#detailPanel").classList.add("is-hidden");
  if (!ui.selectedSwatchId) $(".app-shell").classList.remove("is-detail");
  ui.selectedId = null;
}

async function openPortalFile(ref) {
  var folder = await fs.getTemporaryFolder();
  var name = catalogTools.remoteFileName(ref);
  try {
    var existing = await folder.getEntry(name);
    if (existing && existing.isFile) {
      var metadata = await existing.getMetadata();
      if (catalogTools.cachedDownloadIsComplete(metadata && metadata.size, ref.size)) return existing;
    }
  } catch (error) {}
  var bytes = await portal.getFile("/api/plugin/versions/" + encodeURIComponent(ref.versionId) + "/file");
  var file = await folder.createFile(name, { overwrite: true });
  await file.write(bytes, { format: storage.formats.binary });
  return file;
}

async function openReference(ref) {
  if (!ref || (!ref.entry && !ref.versionId)) return;
  setBusy(true, "Opening " + ref.baseName, ref.entry ? "Photoshop is preparing the approved reference" : "Downloading the approved reference");
  try {
    var entry = ref.entry || await openPortalFile(ref);
    await core.executeAsModal(async function () {
      await app.open(entry);
    }, { commandName: "Open approved color reference" });
  } catch (error) {
    showError("Photoshop could not open this reference. " + error.message);
  } finally {
    setBusy(false);
  }
}

function applyLibraryView() {
  var swatches = ui.library === "swatches";
  var approvedButton = $("#showApprovedButton");
  var swatchButton = $("#showSwatchesButton");
  approvedButton.classList.toggle("is-active", !swatches);
  swatchButton.classList.toggle("is-active", swatches);
  approvedButton.setAttribute("aria-pressed", swatches ? "false" : "true");
  swatchButton.setAttribute("aria-pressed", swatches ? "true" : "false");
  $("#libraryTitle").textContent = "Color Library";
  $("#refreshButton").setAttribute("aria-label", swatches ? "Sync swatches" : "Sync approved colors");
  $("#refreshButton").setAttribute("title", swatches ? "Sync swatches" : "Sync approved colors");
  $("#clientBar").classList.toggle("is-hidden", swatches);
  $("#workspace").classList.toggle("is-hidden", swatches || !current.rootReady);
  $("#welcome").classList.toggle("is-hidden", swatches || Boolean(current.rootReady));
  $("#swatchWorkspace").classList.toggle("is-hidden", !swatches || Boolean(ui.selectedSwatchId));
  if (!swatches) $("#swatchDetail").classList.add("is-hidden");
}

function setLibrary(next) {
  if (ui.library === next) return;
  if (next === "swatches") closeDetails();
  else closeSwatchDetail();
  ui.library = next;
  applyLibraryView();
  if (next === "swatches" && !current.swatches) loadSwatches();
}

function swatchFileName(color) {
  var base = String(color.name || "swatch").replace(/[<>:"/\\|?*\x00-\x1F]/g, " ").replace(/\s+/g, " ").trim() || "swatch";
  return base.slice(0, 60) + "-" + String(color.id || "").slice(0, 8) + ".png";
}

function setSwatchStatus(mode, title, copy) {
  var status = $("#swatchStatus");
  var grid = $("#swatchGrid");
  status.classList.toggle("is-hidden", mode === "ready");
  grid.classList.toggle("is-hidden", mode !== "ready");
  $("#swatchStatusTitle").textContent = title || "";
  $("#swatchStatusCopy").textContent = copy || "";
  $("#swatchStatusCopy").classList.toggle("is-hidden", !copy);
  $("#retrySwatchesButton").classList.toggle("is-hidden", mode !== "error");
  $("#retrySwatchesButton").disabled = ui.swatchLoading;
}

function renderSwatches() {
  $("#swatchNotice").textContent = current.swatchNotice || "";
  $("#swatchNotice").classList.toggle("is-hidden", !current.swatchNotice);
  if (current.swatches == null) {
    setSwatchStatus(ui.swatchLoading ? "loading" : "error", ui.swatchLoading ? "Loading swatches" : "Could not load swatches", "");
    return;
  }
  swatchList.setColors(current.swatches);
  var view = swatchList.view();
  var summary = $("#swatchSummary");
  summary.innerHTML = "<strong>" + view.matchedCount + "</strong> swatch" + (view.matchedCount === 1 ? "" : "es") + (current.swatchOffline ? " · Offline cache" : "");
  if (view.empty === "empty") {
    swatchCards = [];
    $("#swatchGrid").innerHTML = "";
    setSwatchStatus("empty", "No swatches yet", "");
    return;
  }
  if (view.empty === "search") {
    swatchCards = [];
    $("#swatchGrid").innerHTML = "";
    setSwatchStatus("empty", "No matches", "");
    return;
  }
  setSwatchStatus("ready");
  var byId = {};
  view.cards.forEach(function (card) { byId[card.id] = card; });
  applyCards($("#swatchGrid"), swatchCards, view.cards, function (id) {
    var color = byId[id].color;
    var fill = swatchColor(color.hexCode);
    var style = fill ? " style=\"background-color: " + fill + "\"" : "";
    return "<article class=\"color-card swatch-card\" data-id=\"" + escapeHtml(color.id) + "\" tabindex=\"0\" role=\"link\" aria-label=\"View " + escapeHtml(color.name) + ", " + escapeHtml(color.hexCode) + "\">" +
      "<div class=\"thumb-wrap\"><div class=\"thumb-fallback\"" + style + "></div></div>" +
      "<div class=\"card-body\"><div class=\"color-title-row\"><h3 class=\"color-name\" title=\"" + escapeHtml(color.name) + "\">" + escapeHtml(color.name) + "</h3>" + OPEN_ICON + "</div>" +
      "<div class=\"color-meta-row\"><span class=\"color-meta\">" + escapeHtml(color.hexCode) + "</span></div></div></article>";
  });
  swatchCards = view.cards.map(function (card) { return { id: card.id, revision: card.revision }; });
}

async function loadSwatches() {
  if (ui.swatchLoading) return;
  ui.swatchLoading = true;
  $("#swatchWorkspace").setAttribute("aria-busy", "true");
  $("#refreshButton").disabled = true;
  $("#retrySwatchesButton").disabled = true;
  if (!current.swatches) setSwatchStatus("loading", "Loading swatches", "");
  try {
    var snap = await session.loadSwatches();
    current = snap;
    swatchList.resetPage();
    renderSwatches();
  } finally {
    ui.swatchLoading = false;
    $("#swatchWorkspace").setAttribute("aria-busy", "false");
    $("#refreshButton").disabled = ui.scanning || (ui.library === "approved" ? !current.rootReady : false);
    $("#retrySwatchesButton").disabled = false;
  }
}

function showSwatchDetail(id) {
  var color = (current.swatches || []).find(function (item) { return item.id === id; });
  if (!color) return;
  ui.selectedSwatchId = id;
  $("#swatchTitle").textContent = color.name;
  var fill = swatchColor(color.hexCode);
  $("#swatchStage").style.backgroundColor = fill || "transparent";
  var hex = String(color.hexCode || "").trim();
  $("#swatchIdentifiers").innerHTML = hex
    ? "<span class=\"detail-code\">" + (fill ? "<i class=\"code-swatch\" style=\"background-color: " + fill + "\"></i>" : "") + "<span>Hex</span> " + escapeHtml(hex) + "</span>"
    : "";
  $("#swatchCodeRow").classList.toggle("is-hidden", !hex);
  resetCopyHexButton(Boolean(hex));
  $("#swatchOpenError").textContent = "";
  $("#swatchOpenError").classList.add("is-hidden");
  $("#openSwatchButton").disabled = false;
  $("#swatchWorkspace").classList.add("is-hidden");
  $("#swatchDetail").classList.remove("is-hidden");
  $(".app-shell").classList.add("is-detail");
}

function resetCopyHexButton(enabled) {
  clearTimeout(copyHexTimer);
  var button = $("#copyHexButton");
  button.textContent = "Copy";
  button.classList.toggle("is-hidden", !enabled);
  button.classList.remove("is-copied");
  button.disabled = !enabled;
  button.removeAttribute("aria-busy");
  button.setAttribute("aria-label", "Copy hex");
}

async function writeClipboardText(text) {
  var api = null;
  try { api = navigator.clipboard; } catch (error) { api = null; }
  var attempts = [];
  if (api && typeof api.setContent === "function") attempts.push(function () { return api.setContent({ "text/plain": text }); });
  if (api && typeof api.writeText === "function") attempts.push(function () { return api.writeText(text); });
  var legacy = null;
  try { legacy = require("uxp").clipboard; } catch (error) { legacy = null; }
  if (legacy && typeof legacy.copyText === "function") attempts.push(function () { return legacy.copyText(text); });
  attempts.push(function () {
    var field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("aria-hidden", "true");
    document.body.appendChild(field);
    field.focus();
    field.select();
    var copied = document.execCommand("copy");
    document.body.removeChild(field);
    if (!copied) throw new Error("Clipboard unavailable");
  });
  var lastError = null;
  for (var index = 0; index < attempts.length; index += 1) {
    try {
      await attempts[index]();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Clipboard unavailable");
}

async function copySwatchHex() {
  var button = $("#copyHexButton");
  var color = (current.swatches || []).find(function (item) { return item.id === ui.selectedSwatchId; });
  var hex = color ? String(color.hexCode || "").trim() : "";
  if (!hex || button.disabled) return;
  var swatchId = ui.selectedSwatchId;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  $("#swatchOpenError").textContent = "";
  $("#swatchOpenError").classList.add("is-hidden");
  try {
    await writeClipboardText(hex);
    if (ui.selectedSwatchId !== swatchId) return;
    button.removeAttribute("aria-busy");
    button.textContent = "Copied";
    button.classList.add("is-copied");
    button.setAttribute("aria-label", "Copied");
    copyHexTimer = setTimeout(function () { resetCopyHexButton(true); }, 1200);
  } catch (error) {
    if (ui.selectedSwatchId !== swatchId) return;
    resetCopyHexButton(true);
    $("#swatchOpenError").textContent = "Could not copy hex.";
    $("#swatchOpenError").classList.remove("is-hidden");
  }
}

function closeSwatchDetail() {
  ui.selectedSwatchId = null;
  resetCopyHexButton(false);
  $("#swatchDetail").classList.add("is-hidden");
  if (ui.library === "swatches") $("#swatchWorkspace").classList.remove("is-hidden");
  if (!ui.selectedId) $(".app-shell").classList.remove("is-detail");
}

async function openSwatch() {
  var color = (current.swatches || []).find(function (item) { return item.id === ui.selectedSwatchId; });
  if (!color) return;
  $("#openSwatchButton").disabled = true;
  $("#swatchOpenError").classList.add("is-hidden");
  setBusy(true, "Opening " + color.name, "Photoshop is preparing the swatch");
  try {
    var bytes = await portal.getBytes("/api/plugin/swatches/" + encodeURIComponent(color.id) + "/image");
    var folder = await fs.getTemporaryFolder();
    var file = await folder.createFile(swatchFileName(color), { overwrite: true });
    await file.write(bytes, { format: storage.formats.binary });
    await core.executeAsModal(async function () {
      await app.open(file);
    }, { commandName: "Open swatch" });
  } catch (error) {
    $("#swatchOpenError").textContent = "Photoshop could not open this swatch.";
    $("#swatchOpenError").classList.remove("is-hidden");
    console.error("Swatch open failed");
  } finally {
    $("#openSwatchButton").disabled = false;
    setBusy(false);
  }
}

function showError(message) {
  console.error(message);
  $("#notice").textContent = message;
  $("#notice").classList.add("is-error");
  $("#notice").classList.remove("is-hidden");
}

function bindEvents() {
  $("#retryConnectionButton").addEventListener("click", boot);
  $("#refreshButton").addEventListener("click", function () {
    if (ui.library === "swatches") loadSwatches();
    else refreshLibrary();
  });
  [
    { button: $("#showApprovedButton"), library: "approved" },
    { button: $("#showSwatchesButton"), library: "swatches" }
  ].forEach(function (item) {
    function selectLibrary() { setLibrary(item.library); }
    item.button.addEventListener("click", selectLibrary);
    item.button.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectLibrary();
      }
    });
  });
  $("#swatchSearch").addEventListener("input", function (event) {
    var value = event.target.value;
    $("#clearSwatchSearchButton").classList.toggle("is-hidden", !value);
    clearTimeout(swatchSearchTimer);
    swatchSearchTimer = setTimeout(function () {
      swatchList.setQuery(value);
      renderSwatches();
    }, SEARCH_DELAY);
  });
  $("#clearSwatchSearchButton").addEventListener("click", function () {
    clearTimeout(swatchSearchTimer);
    $("#swatchSearch").value = "";
    $("#clearSwatchSearchButton").classList.add("is-hidden");
    $("#swatchSearch").focus();
    swatchList.setQuery("");
    renderSwatches();
  });
  Array.prototype.forEach.call($("#shadeFilters").querySelectorAll(".shade-chip"), function (chip) {
    chip.addEventListener("click", function () {
      swatchList.setShade(chip.getAttribute("data-shade") || "");
      Array.prototype.forEach.call($("#shadeFilters").querySelectorAll(".shade-chip"), function (item) {
        var selected = item === chip;
        item.classList.toggle("is-selected", selected);
        item.setAttribute("aria-pressed", selected ? "true" : "false");
      });
      renderSwatches();
    });
  });
  $("#retrySwatchesButton").addEventListener("click", loadSwatches);
  $("#closeSwatchButton").addEventListener("click", closeSwatchDetail);
  $("#openSwatchButton").addEventListener("click", openSwatch);
  $("#copyHexButton").addEventListener("click", copySwatchHex);
  $("#clientSelect").addEventListener("click", function () {
    setClientMenuOpen($("#clientSelect").getAttribute("aria-expanded") !== "true");
  });
  $("#clientSelect").addEventListener("keydown", function (event) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setClientMenuOpen(true);
        break;
      case "ArrowUp":
        event.preventDefault();
        setClientMenuOpen(true);
        var options = clientMenuOptions();
        if (options.length) options[options.length - 1].focus();
        break;
      case "Escape":
        setClientMenuOpen(false);
        break;
    }
  });
  $("#clientMenu").addEventListener("click", function (event) {
    chooseClientOption(clientOptionFromTarget(event.target));
  });
  $("#clientMenu").addEventListener("keydown", function (event) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveClientOptionFocus(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveClientOptionFocus(-1);
        break;
      case "Home":
        event.preventDefault();
        var first = clientMenuOptions()[0];
        if (first) first.focus();
        break;
      case "End":
        event.preventDefault();
        var options = clientMenuOptions();
        if (options.length) options[options.length - 1].focus();
        break;
      case "Escape":
        event.preventDefault();
        setClientMenuOpen(false);
        $("#clientSelect").focus();
        break;
      case "Tab":
        event.preventDefault();
        setClientMenuOpen(false);
        var tabTarget = event.shiftKey ? $("#clientSelect") : $(ui.library === "swatches" ? "#swatchSearch" : "#searchInput");
        tabTarget.focus();
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        chooseClientOption(clientOptionFromTarget(event.target));
        break;
    }
  });
  document.addEventListener("click", function (event) {
    if ($("#clientSelect").getAttribute("aria-expanded") === "true" && !$("#clientDropdown").contains(event.target)) {
      setClientMenuOpen(false);
    }
    if ($("#sortSelect").getAttribute("aria-expanded") === "true" && !$("#sortDropdown").contains(event.target)) {
      setSortMenuOpen(false);
    }
  });
  $("#searchInput").addEventListener("input", function (event) {
    var value = event.target.value;
    $("#clearSearchButton").classList.toggle("is-hidden", !value);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      approvedList.setQuery(value);
      render();
    }, SEARCH_DELAY);
  });
  $("#clearSearchButton").addEventListener("click", function () {
    clearTimeout(searchTimer);
    $("#searchInput").value = "";
    $("#clearSearchButton").classList.add("is-hidden");
    $("#searchInput").focus();
    approvedList.setQuery("");
    render();
  });
  $("#sortSelect").addEventListener("click", function () {
    setSortMenuOpen($("#sortSelect").getAttribute("aria-expanded") !== "true");
  });
  $("#sortSelect").addEventListener("keydown", function (event) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setSortMenuOpen(true);
        break;
      case "ArrowUp":
        event.preventDefault();
        setSortMenuOpen(true);
        var options = sortMenuOptions();
        if (options.length) options[options.length - 1].focus();
        break;
      case "Escape":
        setSortMenuOpen(false);
        break;
    }
  });
  $("#sortMenu").addEventListener("click", function (event) {
    chooseSortOption(sortOptionFromTarget(event.target));
  });
  $("#sortMenu").addEventListener("keydown", function (event) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveSortOptionFocus(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveSortOptionFocus(-1);
        break;
      case "Home":
        event.preventDefault();
        var first = sortMenuOptions()[0];
        if (first) first.focus();
        break;
      case "End":
        event.preventDefault();
        var options = sortMenuOptions();
        if (options.length) options[options.length - 1].focus();
        break;
      case "Escape":
        event.preventDefault();
        setSortMenuOpen(false);
        $("#sortSelect").focus();
        break;
      case "Tab":
        event.preventDefault();
        setSortMenuOpen(false);
        var sortTabTarget = event.shiftKey ? $("#sortSelect") : $("#filterAll");
        sortTabTarget.focus();
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        chooseSortOption(sortOptionFromTarget(event.target));
        break;
    }
  });
  [
    { button: $("#filterAll"), filter: "all" },
    { button: $("#filterFavorites"), filter: "favorites" }
  ].forEach(function (item) {
    function selectFilter() {
      approvedList.setFilter(item.filter);
      Array.prototype.forEach.call(document.querySelectorAll(".filter-tab"), function (tab) {
        tab.classList.toggle("is-active", tab === item.button);
        tab.setAttribute("aria-pressed", tab === item.button ? "true" : "false");
      });
      render();
    }
    item.button.addEventListener("click", selectFilter);
    item.button.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectFilter();
      }
    });
  });
  $("#colorGrid").addEventListener("click", function (event) {
    var id = cardIdFromEvent(event);
    if (!id) return;
    if (controlFromEvent(event, "favorite-button")) {
      event.preventDefault();
      toggleFavorite(id);
      return;
    }
    showManagedDetails(id);
  });
  $("#colorGrid").addEventListener("keydown", function (event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (controlFromEvent(event, "favorite-button")) return;
    var id = cardIdFromEvent(event);
    if (!id || event.target !== event.currentTarget && !event.target.classList.contains("color-card")) return;
    event.preventDefault();
    showManagedDetails(id);
  });
  $("#swatchGrid").addEventListener("click", function (event) {
    var id = cardIdFromEvent(event);
    if (id) showSwatchDetail(id);
  });
  $("#swatchGrid").addEventListener("keydown", function (event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    var id = cardIdFromEvent(event);
    if (!id) return;
    event.preventDefault();
    showSwatchDetail(id);
  });
  $("#notice").addEventListener("click", function (event) {
    if (event.target && event.target.id === "reviewButton") markReviewed();
  });
  $("#closeDetailButton").addEventListener("click", closeDetails);
  $("#detailFavoriteButton").addEventListener("click", function () {
    if (ui.selectedId) toggleFavorite(ui.selectedId);
  });
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    if (ui.selectedSwatchId) closeSwatchDetail();
    else closeDetails();
  });
}

async function initialize() {
  bindEvents();
  var saved = await settings.read();
  studio.serverUrls = saved.serverUrls.slice();
  await boot();
}

document.addEventListener("DOMContentLoaded", initialize);
