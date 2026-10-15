const assert = require("node:assert/strict");
const { test } = require("node:test");
const color = require("../recolor/color");

test("recolor measurements use explicit profiles and unrounded Lab D50", () => {
  const white = color.rgbToLab([255, 255, 255], color.ADOBE_RGB);
  assert.ok(Math.abs(white[0] - 100) < 0.001);
  assert.ok(Math.abs(white[1]) < 0.001);
  assert.ok(Math.abs(white[2]) < 0.001);
  assert.deepEqual(color.rgbToLab([0, 0, 0], color.ADOBE_RGB), [0, 0, 0]);
  // ICC/CSS D50 sRGB red; this is deliberately not D65 Lab red.
  const red = color.rgbToLab([255, 0, 0], color.SRGB);
  assert.ok(Math.abs(red[0] - 54.29) < 0.02);
  assert.ok(Math.abs(red[1] - 80.81) < 0.03);
  assert.ok(Math.abs(red[2] - 69.89) < 0.03);
  assert.throws(() => color.rgbToLab([1, 2, 3]), /profile/i);
  assert.throws(() => color.rgbToLab([1, 2, 3], "Untagged"), /profile/i);
});

test("display conversion preserves Adobe RGB appearance rather than its code values", () => {
  const display = color.adobeRgbToDisplay([231, 98, 35]);
  assert.equal(display.hex, "#FF6216");
  assert.equal(display.clipped, true);
  const lab = color.rgbToLab([65, 100, 150], color.ADOBE_RGB);
  const roundTrip = color.labToRgb(lab, color.ADOBE_RGB);
  roundTrip.rgb.forEach((value, index) => assert.ok(Math.abs(value - [65, 100, 150][index]) < 0.001));
});

test("CIEDE2000 matches published Sharma reference pairs", () => {
  assert.ok(Math.abs(color.deltaE00([50, 2.6772, -79.7751], [50, 0, -82.7485]) - 2.0425) < 0.0001);
  assert.ok(Math.abs(color.deltaE00([50, 2.49, -0.001], [50, -2.49, 0.0011]) - 7.2195) < 0.0001);
});

test("material measurement excludes background and partial edge coverage", () => {
  const { measureMaterial, compareFrames } = require("../recolor/quality");
  const frame = { width: 4, height: 1, components: 3, maximum: 255, profile: color.ADOBE_RGB,
    bounds: { left: 10, top: 5, right: 14, bottom: 6 }, data: new Uint8Array([255,255,255, 65,100,150, 200,30,20, 0,0,0]) };
  const mask = { width: 2, height: 1, left: 11, top: 5, maximum: 255, data: new Uint8Array([255,128]) };
  const measured = measureMaterial(frame, mask, { minimumSamples: 1 });
  assert.equal(measured.available, true);
  assert.equal(measured.sampleCount, 1);
  measured.diffuseLab.forEach((v, i) => assert.ok(Math.abs(v - color.rgbToLab([65,100,150], color.ADOBE_RGB)[i]) < 0.00001));
  const after = { ...frame, data: new Uint8Array(frame.data) };
  after.data[3] = 95;
  assert.equal(compareFrames(frame, after, mask).protectedPixelsChanged, 0);
  after.data[0] = 254;
  assert.equal(compareFrames(frame, after, mask).protectedPixelsChanged, 1);
  assert.equal(measureMaterial(frame, { ...mask, data: new Uint8Array([0, 0]) }).available, false);
});

test("native candidate recipes use approved image measurements without requiring a HEX", () => {
  const { createCandidates, adjustRecipe } = require("../recolor/recipes");
  const source = { diffuseLab: [65, -32, 30] };
  const target = { id: "approved-image", measurementSpace: "CIELAB D50 2deg", diffuseLab: [35, 30, 4], material: "MATTE", revision: 2 };
  const candidates = createCandidates(source, target);
  assert.deepEqual(candidates.map(v => v.method), ["A", "B", "C"]);
  assert.equal(candidates[0].target.id, "approved-image");
  assert.equal(candidates[0].status, "EXPERIMENTAL");
  const tuned = adjustRecipe(candidates[0], "lightness", 10000);
  assert.equal(tuned.parameters.lightness, 60);
  assert.equal(candidates[0].parameters.lightness, 0);
  assert.throws(() => createCandidates(source, { ...target, material: "IRIDESCENT" }), /material/i);
  assert.throws(() => createCandidates(source, { ...target, measurementSpace: "Lab D65" }), /D50/i);
});

test("tinted Black & White candidates are opt-in, versioned separately and bounded without invalidating A/B/C recipes", () => {
  const { createCandidates, adjustRecipe, validateRecipe, ENGINE_VERSION } = require("../recolor/recipes");
  const source = { diffuseLab: [25, -15, 10] };
  const target = { id: "approved-image", material: "MATTE", measurementSpace: "CIELAB D50 2deg", diffuseLab: [45, 20, -5] };
  const baseline = createCandidates(source, target);
  const extended = createCandidates(source, target, { includeTintedBlackWhite: true });
  assert.deepEqual(extended.slice(0, 3), baseline);
  assert.equal(extended.length, 4);
  const d = extended[3];
  assert.equal(d.method, "D");
  assert.notEqual(d.engineVersion, ENGINE_VERSION);
  assert.equal(d.parameters.gamma, 1);
  assert.equal(adjustRecipe(d, "gamma", 20).parameters.gamma, 4);
  assert.equal(adjustRecipe(d, "gamma", -20).parameters.gamma, 0.25);
  assert.equal(d.parameters.gamma, 1);
  for (const recipe of baseline.concat(d)) validateRecipe(recipe);
  assert.throws(() => adjustRecipe(baseline[0], "gamma", 0.1), /parameter/i);
  assert.throws(() => validateRecipe({ ...d, engineVersion: ENGINE_VERSION }), /recipe/i);
});

test("fitting uses rendered evaluations, excludes integrity failures, and restores the winner", async () => {
  const { fit } = require("../recolor/fitting");
  const source = { diffuseLab: [60, -20, 20] };
  const target = { id: "reference", measurementSpace: "CIELAB D50 2deg", diffuseLab: [40, 25, 0], material: "MATTE" };
  let visible;
  const result = await fit(source, target, async recipe => {
    visible = recipe;
    return { available: true, score: recipe.method === "B" ? null : Math.abs(recipe.parameters.lightness - 6) + (recipe.method === "C" ? 10 : 0),
      integrity: { critical: recipe.method === "B" }, status: recipe.method === "B" ? "INTEGRITY_FAILURE" : "DESIGNER_REVIEW_REQUIRED" };
  }, { maxEvaluations: 12 });
  assert.equal(result.recipe.method, "A");
  assert.equal(result.recipe.parameters.lightness, 6);
  assert.deepEqual(visible, result.recipe);
  assert.ok(result.evaluations <= 12);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => fit(source, target, async () => { throw new Error("Should not render cancelled work"); }, { signal: controller.signal }), /cancel/i);
});

test("opt-in fitting renders all four candidates and reserves a winner verification within its budget", async () => {
  const { fit } = require("../recolor/fitting");
  const source = { diffuseLab: [25, -15, 10] };
  const target = { id: "reference", material: "MATTE", measurementSpace: "CIELAB D50 2deg", diffuseLab: [45, 20, -5] };
  const rendered = [];
  const evaluate = async recipe => {
    rendered.push(recipe.method);
    return { available: true, score: recipe.method === "D" ? 0.1 : 3, integrity: { critical: false }, status: "DESIGNER_REVIEW_REQUIRED" };
  };
  const result = await fit(source, target, evaluate, { includeTintedBlackWhite: true, maxEvaluations: 5 });
  assert.equal(result.recipe.method, "D");
  assert.deepEqual(rendered, ["A", "B", "C", "D", "D"]);
  assert.equal(result.evaluations, 5);
  rendered.length = 0;
  await assert.rejects(() => fit(source, target, evaluate, { includeTintedBlackWhite: true, maxEvaluations: 4 }), /budget/i);
  assert.deepEqual(rendered, []);
});

test("rapid preview requests coalesce without overlapping Photoshop transactions", async () => {
  const { latestQueue } = require("../recolor/fitting");
  let finishFirst, active = 0, overlap = false;
  const rendered = [];
  const queue = latestQueue(async value => {
    active += 1; if (active > 1) overlap = true;
    if (value === 1) await new Promise(resolve => { finishFirst = resolve; });
    rendered.push(value); active -= 1; return value;
  });
  const one = queue(1), two = queue(2), three = queue(3);
  finishFirst();
  assert.deepEqual(await Promise.all([one, two, three]), [1, { superseded: true }, 3]);
  assert.deepEqual(rendered, [1, 3]);
  assert.equal(overlap, false);
});

test("unavailable measurements and changed protected pixels cannot be quality passes", () => {
  const { evaluateRender } = require("../recolor/quality");
  const frame = { width: 2, height: 1, components: 3, maximum: 255, profile: color.ADOBE_RGB,
    bounds: { left: 0, top: 0, right: 2, bottom: 1 }, data: new Uint8Array([100,100,100, 255,255,255]) };
  const mask = { width: 2, height: 1, left: 0, top: 0, maximum: 255, data: new Uint8Array([255, 0]) };
  assert.equal(evaluateRender(frame, frame, mask, null).status, "NOT_EVALUATED");
  const after = { ...frame, data: new Uint8Array([100,100,100, 250,255,255]) };
  assert.equal(evaluateRender(frame, after, mask, { measurementSpace: "CIELAB D50 2deg", diffuseLab: [50,0,0] }, { minimumSamples: 1 }).status, "INTEGRITY_FAILURE");
});

test("resampled pixel differences cannot certify or reject full-resolution mask integrity", () => {
  const { compareFrames } = require("../recolor/quality");
  const before = { width: 2, height: 1, components: 3, maximum: 255, profile: color.ADOBE_RGB,
    bounds: { left: 0, top: 0, right: 4, bottom: 2 }, data: new Uint8Array([90,90,90, 255,255,255]) };
  const after = { ...before, data: new Uint8Array([100,80,90, 254,255,255]) };
  const mask = { width: 4, height: 2, left: 0, top: 0, maximum: 255, data: new Uint8Array([255,255,0,0,255,255,0,0]) };
  const integrity = compareFrames(before, after, mask);
  assert.equal(integrity.protectedCheckAvailable, false);
  assert.equal(integrity.protectedPixelsChanged, null);
  assert.equal(integrity.critical, false);
  assert.equal(integrity.requiresFullResolutionCheck, true);
});

test("gold-image color differences require explicit alignment validity and never score geometry mismatches", () => {
  const { compareGold } = require("../recolor/quality");
  const frame = { width: 4, height: 4, components: 3, maximum: 255, profile: color.ADOBE_RGB,
    bounds: { left: 0, top: 0, right: 4, bottom: 4 }, data: new Uint8Array(4 * 4 * 3).fill(100) };
  const mask = { width: 4, height: 4, left: 0, top: 0, maximum: 255, data: new Uint8Array(16).fill(255) };
  const unverified = compareGold(frame, frame, mask);
  assert.equal(unverified.available, false);
  assert.equal(unverified.diagnostic.medianDeltaE00, 0);
  const valid = compareGold(frame, frame, mask, { alignmentValidated: true });
  assert.equal(valid.available, true); assert.equal(valid.diagnostic.p95DeltaE00, 0);
  assert.equal(compareGold(frame, { ...frame, bounds: { left: 1, top: 0, right: 5, bottom: 4 } }, mask).available, false);
});

test("gold comparison normalizes an 8-bit JPEG and a 16-bit RGBA master to the same measurement space", () => {
  const { compareGold } = require("../recolor/quality");
  const gold = { width: 4, height: 4, components: 3, maximum: 255, profile: color.ADOBE_RGB,
    bounds: { left: 0, top: 0, right: 4, bottom: 4 }, data: new Uint8Array(48).fill(100) };
  const rendered = { ...gold, components: 4, maximum: 65535, data: new Uint16Array(64) };
  for (let i = 0; i < 16; i += 1) rendered.data.set([25700, 25700, 25700, 65535], i * 4);
  const mask = { width: 4, height: 4, left: 0, top: 0, maximum: 255, data: new Uint8Array(16).fill(255) };
  const result = compareGold(rendered, gold, mask, { alignmentValidated: true });
  assert.equal(result.available, true);
  assert.equal(result.diagnostic.p95DeltaE00, 0);
});

test("a saturated channel remains a diagnostic rather than proof of lost tonal detail", () => {
  const { compareFrames } = require("../recolor/quality");
  const before = { width: 4, height: 4, components: 3, maximum: 255, profile: color.ADOBE_RGB,
    bounds: { left: 0, top: 0, right: 4, bottom: 4 }, data: new Uint8Array(48) };
  const after = { ...before, data: new Uint8Array(48) };
  for (let i = 0; i < 16; i += 1) {
    before.data.set([20 + i, 80 + i, 100 + i], i * 3);
    after.data.set([0, 80 + i, 100 + i], i * 3);
  }
  const mask = { width: 4, height: 4, left: 0, top: 0, maximum: 255, data: new Uint8Array(16).fill(255) };
  const result = compareFrames(before, after, mask);
  assert.equal(result.addedClippingFraction, 0);
  assert.equal(result.addedChannelClippingFraction, 1);
  assert.equal(compareFrames(before, { ...after, data: new Uint8Array(48) }, mask).addedClippingFraction, 1);
});
