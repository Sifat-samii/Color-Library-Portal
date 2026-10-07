var catalogTools = require("./catalog.js");

var DEFAULT_PAGE_SIZE = 20;

function pageLimit(pageSize) {
  return pageSize > 0 ? pageSize : Infinity;
}

function revisionFor(group, favorite) {
  var ref = group.preferredRef;
  return [
    favorite ? "1" : "0",
    (group.changeKinds || []).join(","),
    ref ? ref.relativePath : "",
    group.displayName || "",
    group.colorCode || "",
    String((group.refs || []).length),
    String((group.missingRefs || []).length)
  ].join("|");
}

function createApprovedList(options) {
  var pageSize = options && Object.prototype.hasOwnProperty.call(options, "pageSize") ? options.pageSize : DEFAULT_PAGE_SIZE;
  var catalog = [];
  var favorites = {};
  var query = "";
  var sort = "name";
  var filter = "all";
  var limit = pageLimit(pageSize);

  function matched() {
    return catalog.filter(function (group) {
      if (filter === "changes" && (!group.changeKinds || group.changeKinds.length === 0)) return false;
      if (filter === "favorites" && !favorites[group.id]) return false;
      return catalogTools.matchesColor(group, query);
    }).sort(function (a, b) {
      if (sort === "recent") {
        var aChanges = a.changeKinds ? a.changeKinds.length : 0;
        var bChanges = b.changeKinds ? b.changeKinds.length : 0;
        if (aChanges !== bChanges) return bChanges - aChanges;
        if (a.latestApprovedAt !== b.latestApprovedAt) return (b.latestApprovedAt || 0) - (a.latestApprovedAt || 0);
        if (a.latestModified !== b.latestModified) return (b.latestModified || 0) - (a.latestModified || 0);
      }
      return String(a.displayName || "").localeCompare(String(b.displayName || ""));
    });
  }

  function view() {
    var list = matched();
    var visible = list.slice(0, limit);
    var empty = null;
    if (!list.length) {
      if (query) empty = { icon: "search", title: "No matches", copy: "Try a different search." };
      else if (filter === "favorites") empty = { icon: "star", title: "No saved colors", copy: "" };
      else if (filter === "changes") empty = { icon: "check", title: "Nothing to review", copy: "" };
      else empty = { icon: "search", title: "No approved colors", copy: "" };
    }
    return {
      matchedCount: list.length,
      fileCount: catalog.reduce(function (sum, group) { return sum + (group.refs ? group.refs.length : 0); }, 0),
      counts: {
        all: catalog.length,
        review: catalog.filter(function (group) { return group.changeKinds && group.changeKinds.length > 0; }).length,
        saved: catalog.filter(function (group) { return favorites[group.id]; }).length
      },
      cards: visible.map(function (group) {
        return { id: group.id, revision: revisionFor(group, Boolean(favorites[group.id])), group: group };
      }),
      empty: empty
    };
  }

  return {
    setCatalog: function (next) { catalog = next || []; },
    setFavorites: function (next) { favorites = next || {}; },
    setQuery: function (next) { query = String(next || ""); limit = pageLimit(pageSize); },
    setSort: function (next) { sort = next || "name"; },
    setFilter: function (next) { filter = next || "all"; limit = pageLimit(pageSize); },
    showMore: function () { limit += pageSize; },
    resetPage: function () { limit = pageLimit(pageSize); },
    view: view
  };
}

function swatchRevision(color) {
  return [color.name || "", color.hexCode || "", color.shade || ""].join("|");
}

function createSwatchList(options) {
  var pageSize = options && Object.prototype.hasOwnProperty.call(options, "pageSize") ? options.pageSize : DEFAULT_PAGE_SIZE;
  var colors = [];
  var query = "";
  var shade = "";
  var limit = pageLimit(pageSize);

  function view() {
    var list = catalogTools.filterSwatches(colors, query, shade);
    var empty = null;
    if (!colors.length) empty = "empty";
    else if (!list.length) empty = "search";
    return {
      matchedCount: list.length,
      cards: list.slice(0, limit).map(function (color) {
        return { id: color.id, revision: swatchRevision(color), color: color };
      }),
      empty: empty
    };
  }

  return {
    setColors: function (next) { colors = next || []; },
    setQuery: function (next) { query = String(next || ""); limit = pageLimit(pageSize); },
    setShade: function (next) { shade = String(next || ""); limit = pageLimit(pageSize); },
    showMore: function () { limit += pageSize; },
    resetPage: function () { limit = pageLimit(pageSize); },
    view: view
  };
}

function cardPlan(previous, next) {
  var prevIndex = {};
  var prevRevision = {};
  (previous || []).forEach(function (card, index) {
    prevIndex[card.id] = index;
    prevRevision[card.id] = card.revision;
  });
  var nextIndex = {};
  (next || []).forEach(function (card, index) { nextIndex[card.id] = index; });
  var actions = [];
  (previous || []).forEach(function (card) {
    if (nextIndex[card.id] == null) actions.push({ type: "remove", id: card.id });
  });
  (next || []).forEach(function (card, index) {
    if (prevIndex[card.id] == null) actions.push({ type: "create", id: card.id, index: index });
    else if (prevRevision[card.id] !== card.revision) actions.push({ type: "replace", id: card.id, index: index });
  });
  return actions;
}

module.exports = {
  createApprovedList: createApprovedList,
  createSwatchList: createSwatchList,
  cardPlan: cardPlan
};
