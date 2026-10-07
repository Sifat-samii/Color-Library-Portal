const { normalizeHex } = require("./hex-code");

// English Wikipedia lists of colors (A–F, G–M, N–Z), vendored from
// https://github.com/meodai/wikipedia-color-names. See server/data/wikipedia-colors.LICENSE.
const WIKIPEDIA_COLORS = require("./data/wikipedia-colors.json");

function articleTitle(link) {
  let slug = "";
  try {
    slug = decodeURIComponent(new URL(link).pathname.split("/").pop() || "");
  } catch (_error) {
    return "";
  }
  return slug.replace(/_/g, " ").replace(/\s*\(color\)\s*$/i, "").trim();
}

function comparable(value) {
  return value.toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ").trim();
}

function preferredWikipediaName(entries) {
  return [...entries].sort((a, b) => {
    const aMatch = comparable(a.name) === comparable(articleTitle(a.link));
    const bMatch = comparable(b.name) === comparable(articleTitle(b.link));
    if (aMatch !== bMatch) return aMatch ? -1 : 1;
    if (a.name.length !== b.name.length) return a.name.length - b.name.length;
    return a.name.localeCompare(b.name);
  })[0].name;
}

const namesByHex = new Map();
const grouped = new Map();
for (const entry of WIKIPEDIA_COLORS) {
  const hexCode = normalizeHex(entry.hex);
  if (!hexCode || !entry.name || !entry.link) continue;
  if (!grouped.has(hexCode)) grouped.set(hexCode, []);
  grouped.get(hexCode).push(entry);
}
for (const [hexCode, entries] of grouped) {
  namesByHex.set(hexCode, preferredWikipediaName(entries));
}

function wikipediaColorEntries() {
  return [...namesByHex.entries()].map(([hexCode, name]) => ({ hexCode, name }));
}

function wikipediaNameForHex(value) {
  const hexCode = normalizeHex(value);
  if (!hexCode) return "";
  return namesByHex.get(hexCode) || "";
}

module.exports = { wikipediaColorEntries, wikipediaNameForHex };
