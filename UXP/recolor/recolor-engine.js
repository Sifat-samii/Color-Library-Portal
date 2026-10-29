const { analyze, publicAnalysis } = require('./fabric-analysis');
const { candidates, adjust, METHODS } = require('./fabric-recipes');
const { evaluate, inspectStructure, buildReport } = require('./fabric-quality');

const clone = value => JSON.parse(JSON.stringify(value));
const PRESERVATION = ['color', 'lighting', 'texture', 'noise', 'highlights', 'shadows', 'clipping', 'halos'];
function classification(quality) {
  if (!quality.available || !Number.isFinite(quality.score) || quality.integrity.critical) return [3, Infinity];
  const checks = PRESERVATION.map(key => quality.report.checks[key]);
  const failures = checks.filter(check => check.status === 'REVIEW').length;
  const missing = checks.filter(check => check.status === 'UNAVAILABLE').length;
  return [failures ? 2 : missing ? 1 : 0, failures];
}
function better(candidate, previous, priorOrder = []) {
  if (!previous) return true;
  const a = classification(candidate.quality), b = classification(previous.quality);
  if (a[0] !== b[0]) return a[0] < b[0];
  const difference = candidate.quality.score - previous.quality.score;
  // Priors resolve genuinely near-equivalent results, never a large mismatch.
  if (Math.abs(difference) > .1) return difference < 0;
  const pa = priorOrder.indexOf(candidate.recipe.method), pb = priorOrder.indexOf(previous.recipe.method);
  return pa !== pb ? pa < pb : difference < -.005;
}
function aggregate(parts) {
  const useful = parts.filter(part => part.materialSamples > 0);
  const count = useful.reduce((sum, part) => sum + part.materialSamples, 0);
  const min = values => { const valid = values.filter(Number.isFinite); return valid.length ? Math.min(...valid) : null; };
  const max = values => { const valid = values.filter(Number.isFinite); return valid.length ? Math.max(...valid) : null; };
  const combinedPair = key => ({ correlation: min(useful.map(part => part[key].correlation)), retention: min(useful.map(part => part[key].retention)),
    reversalFraction: max(useful.map(part => part[key].reversalFraction)), residual: max(useful.map(part => part[key].residual)),
    samples: useful.reduce((sum, part) => sum + part[key].samples, 0) });
  const compared = parts.reduce((sum, part) => sum + part.protectedPixelsCompared, 0);
  const edgeSamples = parts.reduce((sum, part) => sum + part.edgeSamples, 0);
  return { resolution: parts.every(part => part.resolution === 'FULL') ? 'FULL' : 'REDUCED', materialSamples: count,
    fine: combinedPair('fine'), broad: combinedPair('broad'), highlights: combinedPair('highlights'), shadows: combinedPair('shadows'),
    foldDepth: min(useful.map(part => part.foldDepth)),
    addedClippingFraction: count ? useful.reduce((sum, part) => sum + part.newClippingPixels, 0) / count : null,
    newClippingPixels: useful.reduce((sum, part) => sum + part.newClippingPixels, 0), recoveredClippingPixels: useful.reduce((sum, part) => sum + part.recoveredClippingPixels, 0),
    protectedPixelsChanged: parts.every(part => part.protectedPixelsChanged !== null) ? parts.reduce((sum, part) => sum + part.protectedPixelsChanged, 0) : null,
    protectedPixelsCompared: compared, noProtectedPixels: compared === 0,
    haloFraction: max(useful.map(part => part.haloFraction)), edgeHaloFraction: max(useful.map(part => part.edgeHaloFraction)), edgeSamples,
    noMaskBoundary: compared === 0 && edgeSamples === 0,
    regions: parts.flatMap(part => part.regions).slice(0, 128), tiles: parts.length };
}

function createRecolorEngine({ render, readPixels, readRegion, assertCurrent, sourceDocumentId, previewDocumentId }) {
  const check = signal => { if (signal && signal.aborted) throw Object.assign(new Error('Recolor fitting cancelled'), { code: 'CANCELLED' }); };
  async function evaluateRecipe(analysis, recipe, options = {}) {
    check(options.signal);
    if (assertCurrent) assertCurrent();
    const native = await render(recipe);
    check(options.signal);
    const after = await readPixels(previewDocumentId, 1024);
    if (assertCurrent) assertCurrent();
    const quality = evaluate(analysis.frame, after, analysis.mask, analysis, { sourceSignals: analysis.signals, targetGamutClipped: native.targetGamutClipped });
    return { recipe: clone(recipe), quality };
  }
  function patches(analysis) {
    const frame = analysis.frame, s = analysis.signals, selected = [];
    const extrema = [s.low, s.median, s.high];
    for (const target of extrema) {
      let best = -1, error = Infinity;
      for (let i = 0; i < s.luminance.length; i += Math.max(1, Math.floor(s.luminance.length / 8192))) {
        if (s.interior[i] && Math.abs(s.luminance[i] - target) < error) { error = Math.abs(s.luminance[i] - target); best = i; }
      }
      if (best < 0) continue;
      const x = frame.bounds.left + (best % frame.width + .5) * s.scaleX, y = frame.bounds.top + (Math.floor(best / frame.width) + .5) * s.scaleY;
      const width = Math.min(512, frame.bounds.right - frame.bounds.left), height = Math.min(512, frame.bounds.bottom - frame.bounds.top);
      const left = Math.max(frame.bounds.left, Math.min(frame.bounds.right - width, Math.floor(x - width / 2)));
      const top = Math.max(frame.bounds.top, Math.min(frame.bounds.bottom - height, Math.floor(y - height / 2)));
      const bounds = { left, top, right: left + width, bottom: top + height };
      if (!selected.some(item => JSON.stringify(item) === JSON.stringify(bounds))) selected.push(bounds);
    }
    return selected;
  }
  async function patchReview(analysis, result, signal) {
    if (!readRegion) return result;
    const parts = [];
    for (const bounds of patches(analysis)) {
      check(signal);
      const before = await readRegion(sourceDocumentId, bounds), after = await readRegion(previewDocumentId, bounds);
      parts.push(inspectStructure(before, after, analysis.mask));
    }
    if (assertCurrent) assertCurrent();
    const metrics = aggregate(parts), patchReport = buildReport(metrics, result.quality.anchorDeltaE00, analysis,
      { targetGamutClipped: result.quality.targetGamutClipped });
    // The whole-preview color remains authoritative; patches test local fabric.
    const quality = { ...result.quality, report: patchReport, integrity: { ...result.quality.integrity, critical: metrics.protectedPixelsChanged > 0 },
      patchReview: { bounds: patches(analysis), report: patchReport } };
    quality.score += patchReport.issues.filter(item => PRESERVATION.includes(item.dimension) && item.status === 'REVIEW').length * 3;
    return { ...result, quality };
  }
  async function fit(analysis, options = {}) {
    const requested = options.requestedMethod || 'AUTO';
    if (requested !== 'AUTO' && !METHODS.includes(requested)) throw new Error('Unknown recoloring method');
    const seeds = candidates(analysis, requested === 'AUTO' ? analysis.methods : [requested]);
    const budget = options.maxEvaluations == null ? (analysis.transition.demanding ? 160 : 96) : options.maxEvaluations;
    if (!Number.isInteger(budget) || budget < seeds.length + 5 || budget > 160) throw new Error('Invalid fabric search budget');
    const deadline = Date.now() + (options.maxMilliseconds == null ? 300000 : options.maxMilliseconds);
    const methodBest = new Map(), history = [];
    let evaluations = 0, best = null;
    async function trial(recipe) {
      check(options.signal);
      const result = await evaluateRecipe(analysis, recipe, options); evaluations++;
      history.push({ method: recipe.method, score: result.quality.score, anchorDeltaE00: result.quality.anchorDeltaE00,
        classification: classification(result.quality), status: result.quality.status });
      if (options.onProgress) options.onProgress({ phase: 'FITTING', evaluations, budget, method: recipe.method });
      if (classification(result.quality)[0] === 3) return null;
      if (better(result, methodBest.get(recipe.method), analysis.methods)) methodBest.set(recipe.method, result);
      if (better(result, best, analysis.methods)) best = result;
      return result;
    }
    for (const seed of seeds) await trial(seed);
    const coordinates = [['lightness', analysis.transition.demanding ? 8 : 4], ['chromaA', 3], ['chromaB', 3], ['contrast', 6],
      ['shadows', 4], ['highlights', 4], ['rolloff', .25], ['gamma', .15], ['hue', 10], ['saturation', 10],
      ['balanceCyanRed', 3], ['balanceMagentaGreen', 3], ['balanceYellowBlue', 3], ['blackFloor', 2], ['whiteCeiling', 2]];
    for (const scale of [1, .5, .25]) {
      for (const [key, step] of coordinates) for (const seed of seeds) {
        if (!methodBest.has(seed.method)) continue;
        if (key === 'gamma' && seed.method !== 'D' || ['hue', 'saturation'].includes(key) && seed.method !== 'B') continue;
        for (const direction of [1, -1]) {
          if (evaluations >= budget - 5 || Date.now() >= deadline) break;
          const local = methodBest.get(seed.method), recipe = adjust(local.recipe, key, direction * step * scale);
          if (recipe.parameters[key] !== local.recipe.parameters[key]) await trial(recipe);
        }
      }
      if (evaluations >= budget - 5 || Date.now() >= deadline) break;
    }
    if (!best) throw new Error('No measurable native result; existing work was preserved');
    const finalists = [...methodBest.values()].sort((a, b) => better(a, b, analysis.methods) ? -1 : better(b, a, analysis.methods) ? 1 : 0).slice(0, 3);
    let selected = null;
    for (const finalist of finalists) {
      check(options.signal);
      const restored = await trial(finalist.recipe);
      if (!restored) continue;
      const reviewed = await patchReview(analysis, restored, options.signal);
      if (better(reviewed, selected, analysis.methods)) selected = reviewed;
    }
    if (!selected) throw new Error('Finalist verification failed; keep the previous completed preview');
    const restored = await evaluateRecipe(analysis, selected.recipe, options); evaluations++;
    restored.quality.patchReview = selected.quality.patchReview;
    const report = await verify(analysis, restored, options);
    restored.quality.report = report;
    restored.quality.status = report.verdict;
    return { ...restored, analysis: publicAnalysis(analysis), evaluations, budget, history,
      comparison: [...methodBest.values()].map(result => ({ method: result.recipe.method, recipe: result.recipe, quality: result.quality,
        available: true, score: result.quality.score, anchorDeltaE00: result.quality.anchorDeltaE00 })),
      selection: { version: 'fabric-constrained-selection-1', selectedMethod: selected.recipe.method, requestedMethod: requested,
        reason: 'Compared rendered color and fabric preservation; designer priors only initialize search or resolve near-equivalent results.',
        verdict: report.verdict }, status: 'EXPERIMENTAL_DESIGNER_REVIEW_REQUIRED' };
  }
  async function verify(analysis, preview, options = {}) {
    if (assertCurrent) assertCurrent();
    if (!readRegion) {
      const before = await readPixels(sourceDocumentId), after = await readPixels(previewDocumentId);
      check(options.signal);
      return buildReport(inspectStructure(before, after, analysis.mask), preview.quality.anchorDeltaE00, analysis,
        { nativeVerified: Boolean(assertCurrent), targetGamutClipped: preview.quality.targetGamutClipped });
    }
    const bounds = analysis.canvasBounds || analysis.frame.bounds, parts = [];
    for (let top = bounds.top; top < bounds.bottom; top += 1024) for (let left = bounds.left; left < bounds.right; left += 1024) {
      check(options.signal);
      const tile = { left, top, right: Math.min(left + 1024, bounds.right), bottom: Math.min(top + 1024, bounds.bottom) };
      const before = await readRegion(sourceDocumentId, tile), after = await readRegion(previewDocumentId, tile);
      if ([before, after].some(frame => ['left', 'top', 'right', 'bottom'].some(key => frame.bounds[key] !== tile[key])
        || frame.width !== tile.right - tile.left || frame.height !== tile.bottom - tile.top)) throw new Error('Full-resolution tile did not cover its requested bounds');
      parts.push(inspectStructure(before, after, analysis.mask));
      if (options.onProgress) options.onProgress({ phase: 'VERIFYING', tiles: parts.length });
    }
    check(options.signal);
    if (assertCurrent) assertCurrent();
    return buildReport(aggregate(parts), preview.quality.anchorDeltaE00, analysis,
      { nativeVerified: Boolean(assertCurrent), targetGamutClipped: preview.quality.targetGamutClipped });
  }
  return { analyze, fit, verify, evaluate: evaluateRecipe };
}
module.exports = { createRecolorEngine, classification, better, aggregate };
