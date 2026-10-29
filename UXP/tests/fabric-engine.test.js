const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ADOBE_RGB, SRGB, encodeChannel, decodeChannel, labToRgb, linearLuminance } = require('../recolor/color');
const { measureMaterial } = require('../recolor/quality');
const { analyze, publicAnalysis, signature } = require('../recolor/fabric-analysis');
const { candidates, toneCurve, zoneMasks } = require('../recolor/fabric-recipes');
const { evaluate, inspectStructure } = require('../recolor/fabric-quality');
const { createRecolorEngine } = require('../recolor/recolor-engine');
const { layerDescriptors } = require('../recolor/native-descriptors');
const { validateRecipe, adjustRecipe } = require('../recolor/recipes');
const { feedbackRecord } = require('../recolor/feedback-store');

function fixture(options = {}) {
  const width = 48, height = 48, frame = { width, height, components: 3, maximum: 65535, profile: ADOBE_RGB,
    bounds: { left: 0, top: 0, right: width, bottom: height }, data: new Uint16Array(width * height * 3) };
  const mask = { left: 4, top: 4, width: 40, height: 40, maximum: 255, data: new Uint8Array(1600).fill(255) };
  const rgb = options.rgb || [30, 40, 65];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const light = .65 + .45 * y / height + .08 * Math.sin(x / 4) + .025 * Math.sin(y * 1.6) + .015 * Math.cos(x * 2);
    for (let c = 0; c < 3; c++) frame.data[(y * width + x) * 3 + c] = Math.round(65535 * encodeChannel(Math.min(1, decodeChannel(rgb[c] / 255, ADOBE_RGB) * light), ADOBE_RGB));
  }
  const output = colorize(frame, mask, options.targetRgb || [185, 220, 225]);
  const target = { id: 'approved-target', material: 'MATTE', ...measureMaterial(output, mask), measurementSpace: 'CIELAB D50 2deg' };
  const analysis = analyze({ source: frame, mask, target });
  return { frame, mask, output, target, analysis };
}
function colorize(frame, mask, rgb, flat = false) {
  const output = { ...frame, data: new Uint16Array(frame.data) };
  const source = [];
  for (let y = mask.top; y < mask.top + mask.height; y++) for (let x = mask.left; x < mask.left + mask.width; x++) {
    const index = (y * frame.width + x) * 3;
    source.push(linearLuminance([0, 1, 2].map(c => frame.data[index + c] / 65535 * 255), frame.profile));
  }
  source.sort((a, b) => a - b); const median = source[Math.floor(source.length / 2)];
  for (let y = mask.top; y < mask.top + mask.height; y++) for (let x = mask.left; x < mask.left + mask.width; x++) {
    const index = (y * frame.width + x) * 3;
    const light = flat ? 1 : linearLuminance([0, 1, 2].map(c => frame.data[index + c] / 65535 * 255), frame.profile) / median;
    for (let c = 0; c < 3; c++) output.data[index + c] = Math.round(65535 * encodeChannel(Math.min(.999, decodeChannel(rgb[c] / 255, frame.profile) * light), frame.profile));
  }
  return output;
}
test('linear photometry decodes both supported profiles and separates brightness from RGB code values', () => {
  assert.ok(Math.abs(linearLuminance([128, 128, 128], ADOBE_RGB) - (128 / 255) ** (563 / 256)) < 1e-8);
  assert.ok(linearLuminance([128, 128, 128], SRGB) < .22);
  assert.ok(Math.abs(encodeChannel(decodeChannel(.42, ADOBE_RGB), ADOBE_RGB) - .42) < 1e-10);
});
test('analysis exposes bounded provenance and risks without embedding image buffers', () => {
  const { frame, mask, analysis, target } = fixture();
  assert.equal(analysis.transition.direction, 'DARK_TO_LIGHT');
  assert.equal(analysis.signatures.source, signature(frame));
  assert.ok(!JSON.stringify(publicAnalysis(analysis)).includes('luminance'));
  const satin = analyze({ source: frame, mask, target, material: 'SATIN' });
  assert.equal(satin.confidence, 'LIMITED'); assert.match(satin.risks.join(' '), /reflection/);
});
test('new clipping does not cancel against recovered clipping and reports its location', () => {
  const { frame, mask } = fixture();
  const before = { ...frame, data: new Uint16Array(frame.data) }, after = { ...frame, data: new Uint16Array(frame.data) };
  const a = 10 * frame.width + 10, b = 12 * frame.width + 12;
  for (let c = 0; c < 3; c++) { before.data[a * 3 + c] = 65535; after.data[b * 3 + c] = 65535; }
  const metrics = inspectStructure(before, after, mask);
  assert.equal(metrics.newClippingPixels, 1); assert.equal(metrics.recoveredClippingPixels, 1);
  assert.equal(metrics.regions[0].bounds.left, 12); assert.equal(metrics.regions[0].pixels, 1);
});

test('analysis flags a material mask that mixes dark cloth with a bright background', () => {
  const { frame, mask, target } = fixture();
  for (let y = 4; y < 6; y++) for (let x = 4; x < 44; x++) for (let c = 0; c < 3; c++) frame.data[(y * frame.width + x) * 3 + c] = 60000;
  assert.match(analyze({ source: frame, mask, target }).risks.join(' '), /brightness separation/);
});
test('vertical-only texture collapse and fold reversal are detected', () => {
  const { frame, mask, analysis } = fixture();
  for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) for (let c = 0; c < 3; c++) frame.data[(y * frame.width + x) * 3 + c] = 1000 + y * 500;
  const flat = colorize(frame, mask, [160, 160, 160], true), reversed = { ...frame, data: Uint16Array.from(frame.data, value => 50000 - value) };
  const collapsed = evaluate(frame, flat, mask, analysis);
  assert.equal(collapsed.report.checks.lighting.status, 'REVIEW');
  assert.equal(collapsed.integrity.fine.retention, 0);
  assert.ok(inspectStructure(frame, reversed, mask).broad.reversalFraction > .99);
});
test('noise is not rewarded as preserved fabric detail', () => {
  const { frame, output, mask, analysis } = fixture();
  const noisy = { ...output, data: new Uint16Array(output.data) };
  for (let y = 4; y < 44; y++) for (let x = 4; x < 44; x++) for (let c = 0; c < 3; c++) {
    const i = (y * frame.width + x) * 3 + c;
    noisy.data[i] = Math.max(0, Math.min(65000, noisy.data[i] + (((x * 7919 + y * 104729) % 97) - 48) * 140));
  }
  const report = evaluate(frame, noisy, mask, analysis).report;
  assert.equal(report.checks.noise.status, 'REVIEW'); assert.equal(report.checks.texture.status, 'REVIEW');
});
test('bright-region washout is detected without pure-white clipping', () => {
  const { frame, output, mask, analysis } = fixture({ targetRgb: [215, 214, 207] });
  const washed = { ...output, data: new Uint16Array(output.data) };
  for (let i = 0; i < frame.width * frame.height; i++) if (analysis.signals.interior[i] && analysis.signals.luminance[i] >= analysis.signals.highlight) {
    for (let c = 0; c < 3; c++) washed.data[i * 3 + c] = 60000;
  }
  const report = evaluate(frame, washed, mask, analysis).report;
  assert.equal(report.checks.highlights.status, 'REVIEW'); assert.equal(report.metrics.newClippingPixels, 0);
});
test('reference lighting does not change color/preservation scoring', () => {
  const { frame, output, mask, analysis } = fixture();
  const changed = { ...analysis, target: { ...analysis.target, lightness: { shadow: 0, median: 40, highlight: 100 }, zones: {} } };
  assert.equal(evaluate(frame, output, mask, analysis).score, evaluate(frame, output, mask, changed).score);
});
test('missing checks never pass and protected changes cannot be overridden', () => {
  const { frame, mask, target } = fixture();
  const flat = { ...frame, data: new Uint16Array(frame.data.length).fill(20000) };
  const a = analyze({ source: flat, mask, target });
  const result = evaluate(flat, flat, mask, a);
  assert.equal(result.report.checks.texture.status, 'UNAVAILABLE'); assert.equal(result.report.verdict, 'NEEDS_REVIEW');
  const changed = { ...flat, data: new Uint16Array(flat.data) }; changed.data[0]++;
  assert.equal(evaluate(flat, changed, mask, a).report.verdict, 'INTEGRITY_FAILURE');
});
test('Recipe v2 provides four families with monotonic photometric curves and genuine targeted hue falloff', () => {
  const { analysis } = fixture();
  const recipes = candidates(analysis);
  assert.deepEqual(recipes.map(recipe => recipe.method).sort(), ['A', 'B', 'C', 'D']);
  for (const recipe of recipes) {
    validateRecipe(recipe);
    for (const key of ['lightness', 'blackFloor', 'whiteCeiling', 'rolloff']) for (const value of [-1000, 1000]) {
      const curve = toneCurve(adjustRecipe(recipe, key, value));
      assert.ok(curve.every(([x, y], i) => x >= 0 && y >= 0 && x <= 255 && y <= 255 && (!i || y >= curve[i - 1][1])));
    }
    const native = layerDescriptors(recipe);
    assert.equal(native.layers.find(layer => layer.role === 'tone').command.using.mode._value, 'luminosity');
    if (recipe.method === 'C') assert.equal(native.layers.find(layer => layer.role === 'target').command.using.mode._value, 'color');
    if (recipe.method === 'B') assert.ok(native.layers.find(layer => layer.role === 'target').command.using.type.adjustment[1].localRange > 0);
  }
});
test('source-derived local masks preserve parent coverage rather than multiplying the material mask twice', () => {
  const { analysis } = fixture();
  const masks = zoneMasks(analysis);
  assert.equal(masks.shadowLocal.maximum, 65535); assert.equal(masks.highlightLocal.data.length, 1600);
  assert.ok(masks.shadowLocal.data.some(value => value > 0)); assert.ok(masks.highlightLocal.data.some(value => value > 0));
  assert.ok(!JSON.stringify(candidates(analysis)[0]).includes('data'));
});
test('constrained fitting compares every family, uses full-resolution patches, restores the winner and respects native budget', async () => {
  const { frame, mask, target, analysis } = fixture();
  let current, visible, checks = 0, renders = 0;
  const methods = new Set();
  const engine = createRecolorEngine({ sourceDocumentId: 1, previewDocumentId: 2,
    async render(recipe) {
      current = recipe; methods.add(recipe.method); renders++;
      const rgb = labToRgb(target.diffuseLab, ADOBE_RGB).rgb;
      // Preferred D is deliberately flat; the planner must choose another family.
      visible = colorize(frame, mask, rgb, recipe.method === 'D'); return { targetGamutClipped: false };
    }, async readPixels(){ return visible; }, async readRegion(id){ return id === 1 ? frame : visible; }, assertCurrent(){ checks++; } });
  const result = await engine.fit(analysis, { maxEvaluations: 16 });
  assert.deepEqual([...methods].sort(), ['A', 'B', 'C', 'D']); assert.notEqual(result.recipe.method, 'D');
  assert.equal(current.method, result.recipe.method); assert.ok(result.quality.patchReview); assert.ok(renders <= 16);
  assert.ok(checks > renders); assert.equal(result.quality.report.resolution, 'FULL');
});
test('cancel stops future native operations, and deadline still permits restoring/verifying a winner', async () => {
  const { analysis, output } = fixture(); let renders = 0; const signal = { aborted: false };
  const engine = createRecolorEngine({ async render(){renders++;signal.aborted=true;return{};}, async readPixels(){return output;} });
  await assert.rejects(() => engine.fit(analysis, { signal, maxEvaluations: 12 }), { code: 'CANCELLED' }); assert.equal(renders, 1);
  const timed = createRecolorEngine({ async render(){renders++;return{};}, async readPixels(){return output;} });
  const result = await timed.fit(analysis, { maxEvaluations: 12, maxMilliseconds: 0 });
  assert.ok(result.evaluations <= 8);
});
test('feedback requires explicit acceptance/rejection, retains recipe evidence and does not train silently', () => {
  const { analysis, frame, output, mask } = fixture(), recipe = candidates(analysis)[0], report = evaluate(frame, output, mask, analysis).report;
  assert.throws(() => feedbackRecord({ outcome: 'SELECTED_METHOD', recipe, report }), /explicit/);
  assert.throws(() => feedbackRecord({ outcome: 'NEEDS_CORRECTION', recipe, report }), /Describe/);
  const record = feedbackRecord({ outcome: 'NEEDS_CORRECTION', note: 'Gardenia highlights are washed', recipe, report, analysis: publicAnalysis(analysis) });
  assert.equal(record.automaticallyTrained, false); assert.equal(record.recipeSha256, signature(recipe)); assert.equal(record.productionQualified, false);
});

test('cancellation during the final tile read cannot complete verification', async () => {
  const { frame, output, analysis } = fixture(); const signal = { aborted: false };
  const engine = createRecolorEngine({ sourceDocumentId: 1, previewDocumentId: 2,
    async readRegion(id){ if(id === 2) signal.aborted = true; return id === 1 ? frame : output; }, assertCurrent(){} });
  await assert.rejects(() => engine.verify(analysis, { quality: { anchorDeltaE00: 0, targetGamutClipped: false } }, { signal }), { code: 'CANCELLED' });
});

test('full verification covers declared canvas margins even when analysis pixels were trimmed', async () => {
  const { frame, analysis } = fixture(); const requested = [];
  analysis.canvasBounds = { left: 0, top: 0, right: 2048, bottom: 1024 };
  const engine = createRecolorEngine({ sourceDocumentId: 1, previewDocumentId: 2,
    async readRegion(id, bounds){requested.push(bounds);return frame;}, assertCurrent(){} });
  await assert.rejects(() => engine.verify(analysis, { quality: { anchorDeltaE00: 0 } }), /requested bounds/);
  assert.deepEqual(requested[0], { left: 0, top: 0, right: 1024, bottom: 1024 });
});
