const assert = require("assert");
const { normalizeRepresentativeDrafts, REPRESENTATIVE_ROW_LIMIT } = require("../public/client-representatives");

const ready = normalizeRepresentativeDrafts([
  { displayName: " Emma Stone ", email: "Emma@Gmail.com" },
  { displayName: " ", email: " " }
]);
assert.strictEqual(ready.error, "");
assert.deepStrictEqual(ready.representatives, [{ displayName: "Emma Stone", email: "emma@gmail.com" }]);
assert.deepStrictEqual(ready.invalid, []);

const empty = normalizeRepresentativeDrafts([{ displayName: "", email: "" }]);
assert.strictEqual(empty.error, "Add at least one representative.");
assert.strictEqual(empty.representatives.length, 0);
assert.ok(empty.invalid.some(item => item.field === "name"));
assert.ok(empty.invalid.some(item => item.field === "email"));

const nameOnly = normalizeRepresentativeDrafts([{ displayName: "Ada", email: "" }]);
assert.strictEqual(nameOnly.error, "Enter a valid email for every representative.");
assert.ok(nameOnly.invalid.some(item => item.index === 0 && item.field === "email"));

const emailOnly = normalizeRepresentativeDrafts([{ displayName: "", email: "ada@example.com" }]);
assert.strictEqual(emailOnly.error, "Enter a name for each representative.");
assert.ok(emailOnly.invalid.some(item => item.field === "name"));

const invalidEmail = normalizeRepresentativeDrafts([{ displayName: "Ada", email: "not-an-email" }]);
assert.strictEqual(invalidEmail.error, "Enter a valid email for every representative.");

const mixed = normalizeRepresentativeDrafts([
  { displayName: "", email: "ada@example.com" },
  { displayName: "Grace", email: "not-an-email" }
]);
assert.strictEqual(mixed.error, "Enter a name and a valid email for each representative.");

const duplicate = normalizeRepresentativeDrafts([
  { displayName: "Ada", email: "ada@example.com" },
  { displayName: "Ada Lovelace", email: "Ada@Example.com" }
]);
assert.strictEqual(duplicate.error, "Each representative email can only be added once.");
assert.strictEqual(duplicate.invalid.filter(item => item.field === "email").length, 2);

const tooMany = normalizeRepresentativeDrafts(
  Array.from({ length: REPRESENTATIVE_ROW_LIMIT + 1 }, (_, index) => ({
    displayName: `Person ${index}`,
    email: `person${index}@example.com`
  })),
  REPRESENTATIVE_ROW_LIMIT
);
assert.match(tooMany.error, /up to 20/);

console.log("client representative draft tests passed");
