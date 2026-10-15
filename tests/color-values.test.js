const assert = require("assert");
const { colorValuesFromHex, labFromHex } = require("../public/adobe-rgb");

const samples = {
  DDD06A: {
    rgb: "221, 208, 106",
    cmyk: "0, 6, 52, 13",
    hsb: "53, 52, 87",
    hsl: "53, 63, 64",
    lab: "83, -7, 56",
    xyz: "57, 63, 21",
    lch: "83, 57, 98",
    luv: "83, 17, 70",
    hwb: "53, 42, 13"
  },
  FFFFFF: {
    rgb: "255, 255, 255",
    cmyk: "0, 0, 0, 0",
    hsb: "0, 0, 100",
    hsl: "0, 0, 100",
    lab: "100, 0, 0",
    xyz: "95, 100, 109",
    lch: "100, 0, 0",
    luv: "100, 0, 0",
    hwb: "0, 100, 0"
  },
  "000000": {
    rgb: "0, 0, 0",
    cmyk: "0, 0, 0, 100",
    hsb: "0, 0, 0",
    hsl: "0, 0, 0",
    lab: "0, 0, 0",
    xyz: "0, 0, 0",
    lch: "0, 0, 0",
    luv: "0, 0, 0",
    hwb: "0, 0, 100"
  },
  FF0000: {
    rgb: "255, 0, 0",
    cmyk: "0, 100, 100, 0",
    hsb: "0, 100, 100",
    hsl: "0, 100, 50",
    lab: "61, 90, 75",
    xyz: "58, 30, 3",
    lch: "61, 117, 40",
    luv: "61, 202, 44",
    hwb: "0, 0, 0"
  },
  "00FF00": {
    rgb: "0, 255, 0",
    cmyk: "100, 0, 100, 0",
    hsb: "120, 100, 100",
    hsl: "120, 100, 50",
    lab: "83, -138, 91",
    xyz: "19, 63, 7",
    lch: "83, 165, 147",
    luv: "83, -132, 116",
    hwb: "120, 0, 0"
  },
  "0000FF": {
    rgb: "0, 0, 255",
    cmyk: "100, 100, 0, 0",
    hsb: "240, 100, 100",
    hsl: "240, 100, 50",
    lab: "33, 80, -109",
    xyz: "19, 8, 99",
    lch: "33, 136, 306",
    luv: "33, -10, -133",
    hwb: "240, 0, 0"
  },
  808080: {
    rgb: "128, 128, 128",
    cmyk: "0, 0, 0, 50",
    hsb: "0, 0, 50",
    hsl: "0, 0, 50",
    lab: "54, 0, 0",
    xyz: "21, 22, 24",
    lch: "54, 0, 0",
    luv: "54, 0, 0",
    hwb: "0, 50, 50"
  }
};

for (const [hex, expected] of Object.entries(samples)) {
  assert.deepStrictEqual(colorValuesFromHex(`#${hex}`), expected, hex);
  assert.deepStrictEqual(colorValuesFromHex(hex.toLowerCase()), expected, hex);
}

assert.notStrictEqual(colorValuesFromHex("#DDD06A").lab, "83, -9, 52");
assert.equal(colorValuesFromHex(null), null);
assert.equal(colorValuesFromHex("red"), null);
assert.equal(colorValuesFromHex("#GG0000"), null);

const expanded = colorValuesFromHex("#abc");
assert.equal(expanded.rgb, colorValuesFromHex("#AABBCC").rgb);

const nearBlack = labFromHex("#010000");
assert.ok(nearBlack[0] > 0 && nearBlack[0] < 0.5);
assert.deepStrictEqual(colorValuesFromHex("#010000"), {
  rgb: "1, 0, 0",
  cmyk: "0, 100, 100, 100",
  hsb: "0, 100, 0",
  hsl: "0, 100, 0",
  lab: "0, 0, 0",
  xyz: "0, 0, 0",
  lch: "0, 0, 0",
  luv: "0, 0, 0",
  hwb: "0, 0, 100"
});

console.log("Color value tests passed.");
