const assert = require("assert");
const { normalizeHex } = require("../server/hex-code");

assert.strictEqual(normalizeHex("#e76223"), "#E76223");
assert.strictEqual(normalizeHex("e76223"), "#E76223");
assert.strictEqual(normalizeHex("#abc"), "#AABBCC");
assert.strictEqual(normalizeHex("  #0a0 "), "#00AA00");
assert.strictEqual(normalizeHex(""), "");
assert.strictEqual(normalizeHex("red"), "");
assert.strictEqual(normalizeHex("#12345"), "");
assert.strictEqual(normalizeHex("#1234567"), "");

console.log("Hex code tests passed.");
