const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
const start = source.indexOf("function previewFitScale");
const end = source.indexOf("function bindColorPreview");
assert.ok(start > 0 && end > start, "preview zoom helpers are present");
const context = {};
vm.runInNewContext(source.slice(start, end), context);

const fit = context.previewFitScale(4000, 3000, 700, 800);
assert.ok(Math.abs(fit - 700 / 4000) < 1e-9);
assert.strictEqual(context.previewFitScale(0, 100, 100, 100), 1);

const bounds = context.previewScaleBounds(fit);
assert.strictEqual(bounds.min, 0.05);
assert.strictEqual(bounds.max, 4);

const centered = context.previewClampPan(fit, 4000, 3000, 700, 800, -20, 0);
assert.strictEqual(centered.x, 0);
assert.ok(centered.y > 0);

const zoomed = context.previewZoomAt({ scale: fit, x: centered.x, y: centered.y }, 2, 350, 400, bounds);
assert.ok(Math.abs(zoomed.scale - fit * 2) < 1e-9);
const clamped = context.previewClampPan(zoomed.scale, 4000, 3000, 700, 800, zoomed.x, zoomed.y);
assert.ok(clamped.x < 0 && clamped.y < 0);

const rect = context.previewNavigatorRect(
  { scale: zoomed.scale, x: clamped.x, y: clamped.y },
  4000, 3000, 700, 800, 160, 120
);
assert.ok(rect.width > 0 && rect.width < 160);
assert.ok(rect.height > 0 && rect.height < 120);
assert.ok(rect.left >= 0 && rect.top >= 0);
assert.ok(rect.left + rect.width <= 160.001);
assert.ok(rect.top + rect.height <= 120.001);

const panned = context.previewPanFromNavigator({ x: -100, y: -40 }, 16, 8, 160, 120, 4000, 3000, zoomed.scale);
assert.ok(panned.x < -100);
assert.ok(panned.y < -40);

const limited = context.previewZoomAt({ scale: bounds.max, x: 0, y: 0 }, 2, 10, 10, bounds);
assert.strictEqual(limited.scale, bounds.max);

const wide = context.previewComparePlacement(2000, 1000, 400, 200, 1, 0, 0);
const square = context.previewComparePlacement(500, 500, 400, 200, 1, 0, 0);
assert.strictEqual(wide.x + wide.width / 2, square.x + square.width / 2);
assert.strictEqual(wide.y + wide.height / 2, square.y + square.height / 2);
const wideZoom = context.previewComparePlacement(2000, 1000, 400, 200, 2, 0, 0);
const squareZoom = context.previewComparePlacement(500, 500, 400, 200, 2, 0, 0);
assert.strictEqual(wideZoom.width, wide.width * 2);
assert.strictEqual(squareZoom.height, square.height * 2);
assert.strictEqual(wideZoom.x + wideZoom.width / 2, squareZoom.x + squareZoom.width / 2);

const compareBounds = context.previewScaleBounds(1);
const toward = context.previewCompareZoomAt(1, 0, 0, 2, 80, 40, 400, 200, compareBounds);
assert.strictEqual(toward.zoom, 2);
const before = context.previewComparePlacement(500, 500, 400, 200, 1, 0, 0);
const after = context.previewComparePlacement(500, 500, 400, 200, toward.zoom, toward.x, toward.y);
const localX = (80 - before.x) / before.width;
const localY = (40 - before.y) / before.height;
assert.ok(Math.abs(after.x + localX * after.width - 80) < 1e-6);
assert.ok(Math.abs(after.y + localY * after.height - 40) < 1e-6);
const capped = context.previewClampComparePan(2, 400, 200, 999, -999);
assert.strictEqual(capped.x, 200);
assert.strictEqual(capped.y, -100);
const fittedPan = context.previewClampComparePan(1, 400, 200, 40, -20);
assert.strictEqual(fittedPan.x, 0);
assert.strictEqual(fittedPan.y, 0);

console.log("Preview zoom tests passed.");
