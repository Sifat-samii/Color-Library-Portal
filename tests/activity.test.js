const assert = require("assert");
const { eventCopy, cleanPath } = require("../server/activity");

assert.deepStrictEqual(eventCopy("REQUEST_CREATED", { actorName: "Ema", colorName: "Solar Red" }), {
  title: "New color request",
  body: "Ema requested Solar Red."
});
assert.deepStrictEqual(eventCopy("CHANGES_REQUESTED", { actorName: "Jones", colorName: "Solar Red" }), {
  title: "Changes requested",
  body: "Jones requested changes for Solar Red."
});
assert.equal(cleanPath("/requests/abc?client=123"), "/requests/abc?client=123");
assert.equal(cleanPath("//evil.example"), "/");
assert.equal(cleanPath("https://evil.example"), "/");

console.log("Activity and notification copy tests passed.");
