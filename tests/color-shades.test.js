const assert = require("assert");
const { cssColorEntries } = require("../server/css-color-names");
const { colorShadeIds, normalizeShadeId, shadeIdForHex, shadeIdForName, shadeIdForColor, shadeFiltersMarkup } = require("../public/color-shades");

assert.deepStrictEqual(colorShadeIds(), ["red", "orange", "brown", "yellow", "green", "turquoise", "blue", "violet", "pink", "white", "gray", "black"]);
assert.strictEqual(normalizeShadeId(" Blue "), "blue");
assert.strictEqual(normalizeShadeId("nope"), "");

const named = Object.fromEntries(cssColorEntries().map(item => [item.name, item.hexCode]));
const expectedHex = {
  Red: "red",
  Orange: "orange",
  Brown: "brown",
  Yellow: "yellow",
  Green: "green",
  Turquoise: "turquoise",
  Blue: "blue",
  Violet: "violet",
  Pink: "pink",
  White: "white",
  Gray: "gray",
  Black: "black",
  Chocolate: "brown",
  Navy: "blue",
  Gold: "yellow",
  Maroon: "red",
  Tan: "brown",
  Purple: "violet"
};
for (const [name, shade] of Object.entries(expectedHex)) {
  assert.strictEqual(shadeIdForHex(named[name]), shade, name);
}
assert.strictEqual(shadeIdForHex(""), "");
assert.strictEqual(shadeIdForHex("#12345"), "");

assert.strictEqual(shadeIdForName("APPLE GREEN"), "green");
assert.strictEqual(shadeIdForName("TEAL BLUE"), "turquoise");
assert.strictEqual(shadeIdForName("AQUMARINE BLUE"), "turquoise");
assert.strictEqual(shadeIdForName("PLUM ROYAL"), "violet");
assert.strictEqual(shadeIdForName("PEPPERMINT PINK"), "pink");
assert.strictEqual(shadeIdForName("PINKERTON"), "pink");
assert.strictEqual(shadeIdForName("BLACK HEATHER"), "black");
assert.strictEqual(shadeIdForName("ROSE BROWN"), "brown");
assert.strictEqual(shadeIdForName("GUMDROP"), "");
assert.strictEqual(shadeIdForColor({ hexCode: "#0000FF", name: "APPLE GREEN" }), "blue");
assert.strictEqual(shadeIdForColor({ hexCode: "", name: "NAVY" }), "blue");

const markup = shadeFiltersMarkup("red");
assert.match(markup, /aria-label="Shade filters"/);
assert.match(markup, /data-shade="red"[^>]*aria-pressed="true"/);
assert.match(markup, /data-shade="blue"[^>]*aria-pressed="false"/);
for (const label of ["Red", "Orange", "Brown", "Yellow", "Green", "Turquoise", "Blue", "Violet", "Pink", "White", "Gray", "Black"]) {
  assert.match(markup, new RegExp(`>${label}</button>`));
}

console.log("Color shade tests passed.");
