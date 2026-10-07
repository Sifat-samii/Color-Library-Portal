const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { parseAppRoute, appRouteUrl } = require("../public/navigation");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

assert.deepStrictEqual(parseAppRoute("/", ""), { view: "home" });
assert.deepStrictEqual(parseAppRoute("/library", "?client=client-1"), { view: "library", clientId: "client-1" });
assert.deepStrictEqual(parseAppRoute("/library/", ""), { view: "library", clientId: null });
assert.deepStrictEqual(parseAppRoute("/colors/color%2F1", "?client=client-1"), { view: "color", colorId: "color/1", clientId: "client-1" });
assert.deepStrictEqual(parseAppRoute("/pixofix", ""), { view: "pixofix" });
assert.deepStrictEqual(parseAppRoute("/pixofix", "?shade=red"), { view: "pixofix", shade: "red" });
assert.deepStrictEqual(parseAppRoute("/pixofix", "?shade=nope"), { view: "pixofix" });
assert.deepStrictEqual(parseAppRoute("/library", "?client=client-1&shade=blue"), { view: "library", clientId: "client-1" });
assert.deepStrictEqual(parseAppRoute("/pixofix/swatch-1", "?client=ignored"), { view: "pixofix", pixofixColorId: "swatch-1" });
assert.deepStrictEqual(parseAppRoute("/requests", "?client=client-1"), { view: "requests", clientId: "client-1" });
assert.deepStrictEqual(parseAppRoute("/requests/request-1", ""), { view: "request", requestId: "request-1", clientId: null });
assert.deepStrictEqual(parseAppRoute("/archived", "?client=client-1"), { view: "archived", clientId: "client-1" });
assert.deepStrictEqual(parseAppRoute("/activity", ""), { view: "activity" });
assert.deepStrictEqual(parseAppRoute("/notifications", ""), { view: "notifications" });
assert.deepStrictEqual(parseAppRoute("/clients", ""), { view: "clients" });
assert.deepStrictEqual(parseAppRoute("/profile", ""), { view: "profile", clientId: null });
assert.deepStrictEqual(parseAppRoute("/profile", "?client=client-1"), { view: "profile", clientId: "client-1" });
assert.deepStrictEqual(parseAppRoute("/unknown", ""), { view: "home" });

assert.strictEqual(appRouteUrl({ view: "library", clientId: "client 1" }), "/library?client=client%201");
assert.strictEqual(appRouteUrl({ view: "color", colorId: "color/1", clientId: "client-1" }), "/colors/color%2F1?client=client-1");
assert.strictEqual(appRouteUrl({ view: "pixofix", pixofixColorId: "swatch-1", clientId: "client-1" }), "/pixofix/swatch-1");
assert.strictEqual(appRouteUrl({ view: "pixofix", shade: "blue" }), "/pixofix?shade=blue");
assert.strictEqual(appRouteUrl({ view: "pixofix", pixofixColorId: "swatch-1", shade: "red" }), "/pixofix/swatch-1?shade=red");
assert.strictEqual(appRouteUrl({ view: "library", clientId: "c", shade: "pink" }), "/library?client=c");
assert.strictEqual(appRouteUrl({ view: "library", clientId: "c", shade: "nope" }), "/library?client=c");
assert.strictEqual(appRouteUrl({ view: "color", colorId: "color/1", clientId: "client-1", shade: "green" }), "/colors/color%2F1?client=client-1");
assert.strictEqual(appRouteUrl({ view: "request", requestId: "request-1", clientId: "client-1" }), "/requests/request-1?client=client-1");
assert.strictEqual(appRouteUrl({ view: "requests", clientId: "client-1" }), "/requests?client=client-1");
assert.strictEqual(appRouteUrl({ view: "archived", clientId: "client-1" }), "/archived?client=client-1");
assert.strictEqual(appRouteUrl({ view: "activity" }), "/activity");
assert.strictEqual(appRouteUrl({ view: "notifications" }), "/notifications");
assert.strictEqual(appRouteUrl({ view: "clients" }), "/clients");
assert.strictEqual(appRouteUrl({ view: "profile" }), "/profile");
assert.strictEqual(appRouteUrl({ view: "profile", clientId: "client-1" }), "/profile?client=client-1");
assert.strictEqual(appRouteUrl({ view: "home" }), "/");
assert.deepStrictEqual(parseAppRoute("/colors/color%2F1", "?client=client-1"), parseAppRoute(...(() => {
  const url = appRouteUrl({ view: "color", colorId: "color/1", clientId: "client-1" });
  const split = url.indexOf("?");
  return [url.slice(0, split), url.slice(split)];
})()));

for (const file of ["public/app.js", "public/requests.js", "public/pixofix-library.js"]) {
  assert.doesNotMatch(read(file), /history\.pushState\(null,\s*"",\s*"\/"\)/);
}

const portal = read("public/app.js");
const requests = read("public/requests.js");
const pixofix = read("public/pixofix-library.js");
assert.match(read("public/index.html"), /<script src="\/navigation\.js"><\/script>\s*<script src="\/app\.js"><\/script>/);
assert.match(read("public/index.html"), /<script src="\/client-profile\.js"><\/script>/);
assert.match(read("public/index.html"), /<script src="\/notifications\.js"><\/script>/);
assert.match(portal, /state\.view==="profile"/);
assert.match(portal, /\["library","archived","requests","request","color","profile"\]/);
assert.match(portal, /function openFromLocation/);
assert.match(portal, /openFromLocation\("replace"\)/);
assert.match(portal, /openFromLocation\("silent"\)/);
assert.match(portal, /state\.view==="archived"/);
assert.match(portal, /\{id:"library",label:"Approved colors"\},requests,pixofix,profile/);
assert.match(portal, /group:"client"/);
assert.match(portal, /items:\[\{id:"library",label:"Approved colors"\},requests,profile\]/);
assert.match(portal, /class="nav-group"/);
assert.match(read("public/brand.css"), /\.nav-group \{/);
assert.doesNotMatch(portal, /pixofix,requests/);
assert.match(requests, /syncAppRoute\(\)/);
assert.match(pixofix, /syncAppRoute\(\)/);
assert.match(read("server/index.js"), /sendFile\(path\.join\(config\.publicRoot, "index\.html"\)\)/);

console.log("Navigation restore tests passed.");
