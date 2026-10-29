const assert = require("node:assert/strict");
const { test } = require("node:test");
const color = require("../recolor/color");

test('RGB and opaque RGBA composites compare exactly while real color or alpha changes remain failures', () => {
  const { compareFrames } = require('../recolor/quality');
  const base = { width: 2, height: 2, components: 3, maximum: 65535, profile: color.ADOBE_RGB,
    bounds: { left: 0, top: 0, right: 2, bottom: 2 }, data: new Uint16Array(12).fill(40000) };
  const after = { ...base, components: 4, data: new Uint16Array([40000,40000,40000,65535, 40000,40000,40000,65535, 40000,40000,40000,65535, 20000,10000,30000,65535]) };
  const mask = { width: 1, height: 1, left: 1, top: 1, maximum: 255, data: new Uint8Array([255]) };
  assert.equal(compareFrames(base, after, mask).protectedPixelsChanged, 0);
  after.data[0]++;
  assert.equal(compareFrames(base, after, mask).protectedPixelsChanged, 1);
  assert.equal(compareFrames(base, after, mask).critical, true);
  after.data[0]--; after.data[3] = 0;
  assert.equal(compareFrames(base, after, mask).protectedPixelsChanged, 1);
  assert.equal(compareFrames(after, base, mask).critical, true);
  assert.throws(() => compareFrames(base, { ...after, maximum: 32768 }, mask), /geometry, depth, or profiles/);
});

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
  assert.equal(d.parameters.balanceCyanRed, undefined);
  assert.equal(adjustRecipe(d, "gamma", 20).parameters.gamma, 4);
  assert.equal(adjustRecipe(d, "gamma", -20).parameters.gamma, 0.25);
  assert.equal(d.parameters.gamma, 1);
  for (const recipe of baseline.concat(d)) validateRecipe(recipe);
  assert.throws(() => adjustRecipe(baseline[0], "gamma", 0.1), /parameter/i);
  assert.throws(() => validateRecipe({ ...d, engineVersion: ENGINE_VERSION }), /recipe/i);
});

test('TIFF-trained tone families preserve stronger dark compression and create the observed neutralize/tint/balance stack', () => {
  const { familyCurve, calibratedToneCurve, TRAINING_STANDARD } = require('../recolor/training-standards');
  const { createCandidates } = require('../recolor/recipes');
  const { layerDescriptors } = require('../recolor/native-descriptors');
  const dark = familyCurve(20), light = familyCurve(90);
  assert.ok(dark.at(-1)[1] < light.at(-1)[1]);
  for (const curve of [dark, light, calibratedToneCurve(80, 120, 55)]) {
    for (let index = 1; index < curve.length; index += 1) assert.ok(curve[index][0] > curve[index - 1][0] && curve[index][1] >= curve[index - 1][1]);
  }
  const source = { diffuseLab: [30, -10, 5] };
  const target = { id: 'approved', material: 'MATTE', measurementSpace: 'CIELAB D50 2deg', diffuseLab: [25, 2, -2],
    lightness: { shadow: 15, median: 25, highlight: 38 },
    zones: { shadowLab: [15, 2, -1], diffuseLab: [25, 2, -2], highlightLab: [38, 1, -2] } };
  const recipe = createCandidates(source, target, { includeTintedBlackWhite: true, methods: ['D'] })[0];
  const native = layerDescriptors(recipe).layers;
  assert.deepEqual(native.map(layer => layer.role), ['tone', 'levels', 'neutralize', 'target', 'balance', 'lighting']);
  assert.equal(native.find(layer => layer.role === 'tone').command.using.type.adjustment[0].curve.length, 5);
  assert.equal(TRAINING_STANDARD.uniqueRecipes, 32);
});

test('older diffuse-only targets retain their replay-stable engine while rich reference measurements opt into TIFF calibration', () => {
  const { createCandidates, ENGINE_VERSION, LEGACY_ENGINE_VERSION, TINTED_ENGINE_VERSION, LEGACY_TINTED_ENGINE_VERSION } = require('../recolor/recipes');
  const source = { diffuseLab: [30, 0, 0] };
  const basic = { id: 'old', material: 'MATTE', measurementSpace: 'CIELAB D50 2deg', diffuseLab: [60, 5, 3] };
  const rich = { ...basic, lightness: { shadow: 40, median: 60, highlight: 75 },
    zones: { shadowLab: [40, 4, 2], diffuseLab: [60, 5, 3], highlightLab: [75, 3, 2] } };
  assert.deepEqual(createCandidates(source, basic, { includeTintedBlackWhite: true }).map(value => value.engineVersion),
    [LEGACY_ENGINE_VERSION, LEGACY_ENGINE_VERSION, LEGACY_ENGINE_VERSION, LEGACY_TINTED_ENGINE_VERSION]);
  assert.deepEqual(createCandidates(source, rich, { includeTintedBlackWhite: true }).map(value => value.engineVersion),
    [ENGINE_VERSION, ENGINE_VERSION, ENGINE_VERSION, TINTED_ENGINE_VERSION]);
});

test('transition recipes map extreme source anchors exactly and normalize the Gradient Map input without changing older recipes', () => {
  const { transitionToneCurve, calibratedToneCurve } = require('../recolor/training-standards');
  const { createCandidates, validateRecipe, ENGINE_VERSION, TINTED_ENGINE_VERSION, TRANSITION_ENGINE_VERSION, TRANSITION_TINTED_ENGINE_VERSION } = require('../recolor/recipes');
  const { layerDescriptors } = require('../recolor/native-descriptors');
  for (const [source, target, lightness] of [[22, 190, 78], [210, 28, 12]]) {
    const points = transitionToneCurve(source, target, lightness);
    assert.deepEqual(points.find(point => point[0] === source), [source, target]);
    for (let i = 1; i < points.length; i++) {
      assert.ok(points[i][0] > points[i - 1][0]);
      assert.ok(points[i][1] >= points[i - 1][1]);
    }
    assert.notDeepEqual(points, calibratedToneCurve(source, target, lightness));
  }
  const source = { diffuseLab: [10, 0, 0] }, target = { id: 'light', material: 'MATTE', measurementSpace: 'CIELAB D50 2deg',
    diffuseLab: [78, 0, 0], lightness: {shadow:70,median:78,highlight:85},
    zones: {shadowLab:[70,0,0],diffuseLab:[78,0,0],highlightLab:[85,0,0]} };
  const settings = { methods: ['B', 'C', 'D'], includeTintedBlackWhite: true };
  assert.deepEqual(createCandidates(source, target, settings).map(recipe => recipe.engineVersion), [ENGINE_VERSION, ENGINE_VERSION, TINTED_ENGINE_VERSION]);
  const recipes = createCandidates(source, target, { ...settings, transitionAware: true });
  assert.deepEqual(recipes.map(recipe => recipe.engineVersion), [TRANSITION_ENGINE_VERSION, TRANSITION_ENGINE_VERSION, TRANSITION_TINTED_ENGINE_VERSION]);
  for (const recipe of recipes) validateRecipe(recipe);
  const curve = layerDescriptors(recipes[1]).layers[0].command.using.type.adjustment[0].curve;
  assert.ok(curve.some(point => point.horizontal > 0 && point.horizontal < 64 && point.vertical === 128), 'Gradient Map must receive the material midpoint at 128');
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

test('designer preference uses measured dark-to-light transitions and distinguishes pastel aqua from near-white', () => {
  const { methodPolicy, isNearWhite } = require('../recolor/method-policy');
  const navy={diffuseLab:[18.4,3.4,-22]}, aqua={diffuseLab:[85,-16.3,-7.7]}, white={diffuseLab:[94,0,4]};
  assert.deepEqual(methodPolicy(navy,aqua).preferredMethods,['D']);
  assert.equal(isNearWhite(aqua),false);
  assert.deepEqual(methodPolicy(navy,white).preferredMethods,['D','C']);
  assert.equal(methodPolicy(white,navy),null);
  assert.equal(methodPolicy({diffuseLab:[65,0,0]},white),null);
  assert.equal(methodPolicy(navy,{diffuseLab:[30,0,0]}),null);
});

test('automatic fitting honors the reviewed method preference even when hue has a lower numerical score', async () => {
  const { fit } = require('../recolor/fitting');
  const { methodPolicy } = require('../recolor/method-policy');
  const source={diffuseLab:[18,2,-22]},target={id:'any-name',material:'MATTE',measurementSpace:'CIELAB D50 2deg',diffuseLab:[85,-16,-8]};
  let shown;
  const result=await fit(source,target,async recipe=>{shown=recipe.method;return{available:true,score:recipe.method==='D'?5:1,integrity:{critical:false,normalizedDetailRatio:0.95,relativeLightingSpread:0.71,addedClippingFraction:0}};},
    {methods:['B','C','D'],includeTintedBlackWhite:true,maxEvaluations:4,methodPolicy:methodPolicy(source,target)});
  assert.equal(result.recipe.method,'D');assert.equal(shown,'D');assert.equal(result.selection.preferenceApplied,true);
  assert.ok(result.comparison.find(c=>c.method==='D').score>result.comparison.find(c=>c.method==='B').score);
});

test('near-white choice rejects washed highlights, accepts depth-preserving gradient fallback, and can refine an unsafe tint seed', async () => {
  const { fit } = require('../recolor/fitting');
  const { methodPolicy } = require('../recolor/method-policy');
  const source={diffuseLab:[18,0,-20]},target={id:'white',material:'MATTE',measurementSpace:'CIELAB D50 2deg',diffuseLab:[94,0,2]};
  const settings={methods:['B','C','D'],includeTintedBlackWhite:true,maxEvaluations:4,methodPolicy:methodPolicy(source,target)};
  const evaluator=repair=>async recipe=>({available:true,score:recipe.method==='D'?3:recipe.method==='C'?2:1,
    integrity:{critical:false,normalizedDetailRatio:0.95,relativeLightingSpread:0.8,addedClippingFraction:0,
      highlightDetailRetention:recipe.method==='D'&&(!repair||recipe.parameters.lightness>-12)?0.03:0.7}});
  const fallback=await fit(source,target,evaluator(false),settings);
  assert.equal(fallback.recipe.method,'C');assert.equal(fallback.selection.preferenceApplied,false);
  assert.match(fallback.selection.preferredMethodIssues.join(' '),/Highlight/);
  const refined=await fit(source,target,evaluator(true),{...settings,maxEvaluations:28,refineAllCandidates:true,demandingTransition:true});
  assert.equal(refined.recipe.method,'D');assert.ok(refined.recipe.parameters.lightness<=-12);
  assert.equal(refined.selection.preferenceApplied,true);
});

test('white review detects loss of bright fabric detail before complete black/white clipping appears', () => {
  const { compareFrames } = require('../recolor/quality');
  const frame=levels=>({width:240,height:1,components:3,maximum:255,profile:color.ADOBE_RGB,bounds:{left:0,top:0,right:240,bottom:1},data:new Uint8Array(levels.flatMap(x=>[x,x,x]))});
  const before=frame(Array.from({length:240},(_,i)=>i<120?40+i%20:100+(i%10)*2));
  const after=frame(Array.from({length:240},(_,i)=>i<120?130+(i%20)*2:240+i%2));
  const mask={left:0,top:0,width:240,height:1,maximum:255,data:new Uint8Array(240).fill(255)};
  const result=compareFrames(before,after,mask,{highlightDetails:true});
  assert.equal(result.addedClippingFraction,0);assert.ok(result.highlightDetailRetention<0.25);
  const { methodPolicy,preservationIssues }=require('../recolor/method-policy');
  assert.match(preservationIssues({integrity:result},methodPolicy({diffuseLab:[18,0,0]},{diffuseLab:[94,0,2]})).join(' '),/Highlight/);
});

test('protected white tint seeds are conservative and valid without changing ordinary tint recipes', () => {
  const { createCandidates,validateRecipe } = require('../recolor/recipes');
  const source={diffuseLab:[18,0,-20]},target={id:'white',material:'MATTE',measurementSpace:'CIELAB D50 2deg',diffuseLab:[94,0,2]};
  const options={methods:['D'],includeTintedBlackWhite:true};
  const ordinary=createCandidates(source,target,options)[0],protectedRecipe=createCandidates(source,target,{...options,protectHighlights:true})[0];
  assert.equal(ordinary.parameters.gamma,1);assert.equal(ordinary.parameters.lightness,0);
  assert.equal(protectedRecipe.parameters.gamma,0.85);assert.equal(protectedRecipe.parameters.lightness,-4);
  assert.equal(protectedRecipe.parameters.highlights,-6);validateRecipe(protectedRecipe);
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

test('adjustment-only method selection excludes fill candidates while retaining legacy recipe support', () => {
  const { createCandidates, ADJUSTMENT_METHODS } = require('../recolor/recipes');
  const { layerDescriptors } = require('../recolor/native-descriptors');
  const source = { diffuseLab: [60, -20, 20] };
  const target = { id: 'reference', material: 'MATTE', measurementSpace: 'CIELAB D50 2deg', diffuseLab: [40, 25, 0] };
  const options = { methods: ADJUSTMENT_METHODS, includeTintedBlackWhite: true };
  const recipes = createCandidates(source, target, options);
  assert.deepEqual(recipes.map(recipe => recipe.method), ['B', 'C', 'D']);
  for (const recipe of recipes) {
    const layers = layerDescriptors(recipe).layers;
    assert.ok(layers.length >= 3);
    assert.ok(layers.every(layer => layer.command.using._obj === 'adjustmentLayer'));
  }
  assert.equal(createCandidates(source, target)[0].method, 'A', 'Legacy benchmark recipes remain readable');
  for (const methods of [[], ['A', 'A'], ['UNKNOWN'], ['D']]) {
    assert.throws(() => createCandidates(source, target, { methods }), /eligible/);
  }
});

test('comparison refines each adjustment method before choosing a winner and fits hue beyond the initial seed', async () => {
  const { createCandidates, ADJUSTMENT_METHODS } = require('../recolor/recipes');
  const { fit } = require('../recolor/fitting');
  const source = { diffuseLab: [60, -20, 20] };
  const target = { id: 'reference', material: 'MATTE', measurementSpace: 'CIELAB D50 2deg', diffuseLab: [40, 25, 0] };
  const options = { methods: ADJUSTMENT_METHODS, includeTintedBlackWhite: true, refineAllCandidates: true, maxEvaluations: 40 };
  const seedHue = createCandidates(source, target, options)[0].parameters.hue;
  const rendered = [];
  const result = await fit(source, target, async recipe => {
    rendered.push(recipe);
    return { available: true, integrity: { critical: false }, status: 'DESIGNER_REVIEW_REQUIRED',
      score: recipe.method === 'B' ? Math.abs(recipe.parameters.hue - seedHue - 12) + 0.1 : recipe.method === 'C' ? 2 : 3 };
  }, options);
  assert.equal(result.recipe.method, 'B', 'The weaker starting seed must be allowed to beat the initial best method');
  assert.equal(result.recipe.parameters.hue, seedHue + 12);
  assert.ok(rendered.every(recipe => recipe.method !== 'A'));
  for (const method of ADJUSTMENT_METHODS) assert.ok(rendered.filter(recipe => recipe.method === method).length > 1);
  assert.deepEqual(rendered.at(-1), result.recipe);
  assert.ok(result.evaluations <= 40);
  assert.deepEqual(result.comparison.map(value => value.method), ADJUSTMENT_METHODS);
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

test('manual preview queue waits for a pause in dragging and renders the final values once', async () => {
  const { latestQueue } = require('../recolor/fitting');
  const renders = [], promises = [];
  const update = latestQueue(async value => { renders.push(value); }, { delayMs: 30 });
  for (let index = 0; index < 10; index++) {
    promises.push(update(index));
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.deepEqual(renders, [], 'Dragging should not repeatedly select and rewrite native Photoshop layers');
  await Promise.all(promises);
  assert.deepEqual(renders, [9]);
});

test('natural lightening preserves local fold contrast on both sides of the material midpoint', () => {
  const { naturalLightingCurve } = require('../recolor/training-standards');
  const points = naturalLightingCurve(20, 180);
  const sample = x => {
    for (let i = 1; i < points.length; i++) if (x <= points[i][0]) {
      const a = points[i - 1], b = points[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
    }
  };
  assert.equal(sample(20), 180);
  assert.ok(sample(22) - sample(20) >= 12, 'Highlights must not flatten immediately above the midpoint');
  assert.ok(sample(20) - sample(18) >= 12, 'Shadows must retain local depth');
});

test('lighting review catches flat folds even when normalized texture is retained', () => {
  const { evaluateRender, measureMaterial } = require('../recolor/quality');
  const frame = levels => ({ width: 60, height: 1, components: 3, maximum: 255, profile: color.ADOBE_RGB,
    bounds: {left:0,top:0,right:60,bottom:1}, data: new Uint8Array(levels.flatMap(value => [value,value,value])) });
  const original = frame(Array.from({length:60}, (_, i) => 20 + i % 20));
  const flat = frame(Array.from({length:60}, (_, i) => 180 + Math.round((i % 20) * 0.1)));
  const mask = {left:0,top:0,width:60,height:1,maximum:255,data:new Uint8Array(60).fill(255)};
  const target = { material: 'MATTE', ...measureMaterial(flat, mask) };
  const regular = evaluateRender(original, flat, mask, target);
  const natural = evaluateRender(original, flat, mask, target, { preserveLighting: true });
  assert.ok(natural.lighting.spreadRatio < 0.2);
  assert.ok(natural.score > regular.score + 10, 'A close color anchor must not excuse washed-out lighting');
});

test('all manual slider extremes produce finite monotonic native curves in old and new engines', () => {
  const { createCandidates, validateRecipe } = require('../recolor/recipes');
  const { layerDescriptors } = require('../recolor/native-descriptors');
  const target = {id:'extremes',material:'MATTE',measurementSpace:'CIELAB D50 2deg',diffuseLab:[75,-8,-12],
    lightness:{shadow:60,median:75,highlight:85},zones:{shadowLab:[60,-8,-12],diffuseLab:[75,-8,-12],highlightLab:[85,-8,-12]}};
  for (const version of [{}, {transitionAware:true}, {transitionAware:true,naturalLighting:true}]) {
    const candidates = createCandidates({diffuseLab:[20,0,-15]}, target, {methods:['B','C','D'],includeTintedBlackWhite:true,...version});
    for (const seed of candidates) for (const [key, endpoints] of Object.entries({intensity:[0,100],lightness:[-60,60],contrast:[-40,40],shadows:[-25,25],highlights:[-25,25]})) {
      for (const value of endpoints) {
        const recipe=JSON.parse(JSON.stringify(seed));recipe.parameters[key]=value;validateRecipe(recipe);
        for (const layer of layerDescriptors(recipe).layers) {
          const type=layer.command.using.type;if(type._obj!=='curves')continue;
          const points=type.adjustment[0].curve;
          for(let i=0;i<points.length;i++) {
            assert.ok(Number.isFinite(points[i].horizontal)&&Number.isFinite(points[i].vertical));
            assert.ok(points[i].horizontal>=0&&points[i].horizontal<=255&&points[i].vertical>=0&&points[i].vertical<=255);
            if(i){assert.ok(points[i].horizontal>points[i-1].horizontal);assert.ok(points[i].vertical>=points[i-1].vertical);}
          }
        }
      }
    }
  }
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

test('render scoring uses approved shadow/highlight distribution in addition to the diffuse color anchor', () => {
  const { measureMaterial, evaluateRender } = require('../recolor/quality');
  const pixels = values => new Uint8Array(values.flatMap(value => [value, value, value]));
  const beforeValues = [...new Array(10).fill(50), ...new Array(20).fill(100), ...new Array(10).fill(150)];
  const changedValues = [...new Array(10).fill(20), ...new Array(20).fill(100), ...new Array(10).fill(180)];
  const frame = data => ({ width: 40, height: 1, components: 3, maximum: 255, profile: color.ADOBE_RGB,
    bounds: { left: 0, top: 0, right: 40, bottom: 1 }, data: pixels(data) });
  const mask = { width: 40, height: 1, left: 0, top: 0, maximum: 255, data: new Uint8Array(40).fill(255) };
  const before = frame(beforeValues), altered = frame(changedValues), measured = measureMaterial(before, mask);
  const target = { material: 'MATTE', measurementSpace: measured.measurementSpace, diffuseLab: measured.diffuseLab,
    lightness: measured.lightness, zones: measured.zones };
  const exact = evaluateRender(before, before, mask, target);
  const mismatch = evaluateRender(before, altered, mask, target);
  assert.equal(exact.score, 0);
  assert.ok(mismatch.tone && Math.abs(mismatch.tone.spreadDelta) > 0);
  assert.ok(mismatch.score > exact.score);
  assert.equal(mismatch.evaluationVersion, 'tiff-trained-zonal-tone-3');
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
