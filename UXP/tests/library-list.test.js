const assert = require("node:assert/strict");
const { createApprovedList, createSwatchList, cardPlan } = require("../library-list.js");

const catalog = [
  { id: "b", displayName: "Black", normalizedKey: "BLACK", colorCode: "", hexCode: "#111111", instructions: "", aliases: [], refs: [{ baseName: "Black.jpg", relativePath: "Black.jpg" }], missingRefs: [], changeKinds: [], latestApprovedAt: 20, latestModified: 20, preferredRef: { relativePath: "Black.jpg" } },
  { id: "a", displayName: "Aqua", normalizedKey: "AQUA", colorCode: "PMS", hexCode: "#00AAAA", instructions: "wash", aliases: ["Sea"], refs: [{ baseName: "Aqua.jpg", relativePath: "Aqua.jpg" }, { baseName: "Aqua-full.jpg", relativePath: "FULL/Aqua.jpg" }], missingRefs: [], changeKinds: ["updated"], latestApprovedAt: 50, latestModified: 40, preferredRef: { relativePath: "Aqua.jpg" } },
  { id: "c", displayName: "Cobalt", normalizedKey: "COBALT", colorCode: "", hexCode: "", instructions: "", aliases: [], refs: [], missingRefs: [{ baseName: "Cobalt.jpg" }], changeKinds: ["missing"], latestApprovedAt: 10, latestModified: 0, preferredRef: null }
];

const approved = createApprovedList();
approved.setCatalog(catalog);
approved.setFavorites({ a: true });
let view = approved.view();
assert.deepEqual(view.counts, { all: 3, review: 2, saved: 1 });
assert.equal(view.fileCount, 3);
assert.deepEqual(view.cards.map(function (card) { return card.id; }), ["a", "b", "c"]);
assert.equal(view.empty, null);

approved.setFilter("changes");
assert.deepEqual(approved.view().cards.map(function (card) { return card.id; }), ["a", "c"]);
approved.setFilter("favorites");
assert.deepEqual(approved.view().cards.map(function (card) { return card.id; }), ["a"]);
assert.equal(approved.view().empty, null);
approved.setFavorites({});
assert.equal(approved.view().empty.title, "No saved colors");

approved.setFilter("all");
approved.setSort("recent");
assert.deepEqual(approved.view().cards.map(function (card) { return card.id; }), ["a", "c", "b"]);
approved.setQuery("sea");
assert.deepEqual(approved.view().cards.map(function (card) { return card.id; }), ["a"]);
approved.setQuery("no-such-color");
assert.equal(approved.view().empty.title, "No matches");

const full = createApprovedList({ pageSize: 0 });
full.setCatalog(catalog);
assert.equal(full.view().cards.length, 3);
full.resetPage();
assert.equal(full.view().cards.length, 3);

const paged = createApprovedList({ pageSize: 1 });
paged.setCatalog(catalog);
assert.equal(paged.view().cards.length, 1);
assert.equal(paged.view().matchedCount, 3);
paged.showMore();
assert.equal(paged.view().cards.length, 2);
paged.setQuery("b");
assert.equal(paged.view().matchedCount, 2);
assert.equal(paged.view().cards.length, 1);

approved.setQuery("");
approved.setFilter("all");
const previous = approved.view().cards.map(function (card) { return { id: card.id, revision: card.revision }; });
assert.deepEqual(cardPlan(previous, previous), []);
const removed = previous.slice(0, 1);
const plan = cardPlan(previous, removed);
assert.deepEqual(plan.filter(function (action) { return action.type === "remove"; }).map(function (action) { return action.id; }), previous.slice(1).map(function (card) { return card.id; }));
const replaced = previous.map(function (card) { return Object.assign({}, card, { revision: card.revision + "x" }); });
assert.ok(cardPlan(previous, replaced).some(function (action) { return action.type === "replace"; }));

const swatches = createSwatchList({ pageSize: 1 });
swatches.setColors([
  { id: "red", name: "Maroon", hexCode: "#800000", shade: "red" },
  { id: "blue", name: "Navy", hexCode: "#000080", shade: "blue" }
]);
assert.equal(swatches.view().cards.length, 1);
swatches.showMore();
assert.equal(swatches.view().cards.length, 2);
swatches.setShade("blue");
assert.deepEqual(swatches.view().cards.map(function (card) { return card.id; }), ["blue"]);
swatches.setQuery("none");
assert.equal(swatches.view().empty, "search");

console.log("Library list tests passed.");
