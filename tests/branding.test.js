const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const exists = relative => fs.existsSync(path.join(root, relative));

assert.equal(JSON.parse(read("package.json")).name, "pixofix-color-library");
assert.match(read("public/index.html"), /Pixofix Color Library/);
assert.match(read("public/index.html"), /href="\/color-details\.css"/);
assert.match(read("public/index.html"), /brand\/pixofix-logo-white\.png/);
assert.doesNotMatch(read("public/index.html"), />ACL</);
assert.match(read("UXP/manifest.json"), /Pixofix Color Library/);
assert.match(read("UXP/index.html"), /Pixofix Color Library/);
assert.doesNotMatch(read("UXP/index.html"), />ACL</);
assert.match(read("server/index.js"), /pixofix-color-library/);
assert.match(read("Start Pixofix Color Library.cmd"), /Pixofix Color Library/);

const requiredAssets = [
  "public/brand/pixofix-logo.png",
  "public/brand/pixofix-logo-white.png",
  "public/brand/pixofix-mark.png",
  "public/brand/favicon.png",
  "UXP/icons/pixofix-logo-white.png",
  "UXP/icons/icon.png"
];
for (const asset of requiredAssets) {
  assert.ok(exists(asset), `Missing brand asset: ${asset}`);
}

assert.ok(exists("public/tokens.css"), "Missing tokens.css");
assert.match(read("public/tokens.css"), /--px-orange-500:\s*#e76223/);
assert.match(read("public/tokens.css"), /--mint:\s*var\(--px-orange-50\)/);

const portalCss = ["public/tokens.css", "public/styles.css", "public/brand.css", "public/color-details.css"]
  .map(read)
  .join("\n");
const leftoverTeal = [
  "#e2eae8",
  "#9ccdc5",
  "#b9d8d2",
  "#d8f1ec",
  "#7dbfb5",
  "#9fe0d6",
  "#123f39",
  "rgba(69,161,148",
  "rgba(218,246,239",
  "rgba(23,61,56"
];
for (const token of leftoverTeal) {
  assert.ok(!portalCss.includes(token), `Leftover teal palette token still present: ${token}`);
}

console.log("Pixofix Color Library branding tests passed.");
