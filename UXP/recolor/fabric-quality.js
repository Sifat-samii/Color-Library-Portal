const { measureMaterial, coverage, quantile } = require('./quality');
const { deltaE00, labToRgb, ADOBE_RGB } = require('./color');
const { signals } = require('./fabric-analysis');

// Development limits, not textile certification. Changes require a new version.
const CALIBRATION = Object.freeze({ version: 'fabric-development-1', provenance: 'Human corpus priors and controlled defect tests; human threshold calibration pending',
  maxColorDifference: 2, maxNewClipping: .001, minCorrelation: .85, maxReversals: .05,
  minDetail: .35, maxDetail: 2, minHighlightDetail: .25, minFoldDepth: .25, maxFoldDepth: 4, maxNoiseResidual: .35, maxHaloFraction: .01 });
const finite = Number.isFinite;
const ratio = (a, b) => b > 1e-12 ? a / b : null;
function pairAccumulator() { return { aa: 0, bb: 0, ab: 0, reversed: 0, weight: 0, count: 0 }; }
function addPair(acc, a, b) {
  acc.aa += a * a; acc.bb += b * b; acc.ab += a * b; acc.weight += Math.abs(a); acc.count++;
  if (a * b < 0) acc.reversed += Math.abs(a);
}
function pairMetrics(acc) {
  return { correlation: acc.aa > 1e-10 && acc.bb > 1e-10 ? acc.ab / Math.sqrt(acc.aa * acc.bb) : null,
    retention: acc.aa > 1e-10 ? Math.sqrt(acc.bb / acc.aa) : null,
    reversalFraction: ratio(acc.reversed, acc.weight), samples: acc.count,
    residual: acc.aa > 1e-10 && acc.bb > 1e-10 ? Math.sqrt(Math.max(0, acc.bb - acc.ab * acc.ab / acc.aa) / acc.bb) : null };
}
function regionComponents(bits, width, height, frame) {
  const seen = new Uint8Array(bits.length), queue = new Int32Array(bits.length), regions = [];
  const sx = (frame.bounds.right - frame.bounds.left) / width, sy = (frame.bounds.bottom - frame.bounds.top) / height;
  for (let i = 0; i < bits.length; i++) {
    if (!bits[i] || seen[i]) continue;
    let head = 0, tail = 1, left = width, top = height, right = 0, bottom = 0;
    queue[0] = i; seen[i] = 1;
    while (head < tail) {
      const j = queue[head++], x = j % width, y = Math.floor(j / width);
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
      for (const k of [x ? j - 1 : -1, x + 1 < width ? j + 1 : -1, y ? j - width : -1, y + 1 < height ? j + width : -1]) {
        if (k >= 0 && bits[k] && !seen[k]) { seen[k] = 1; queue[tail++] = k; }
      }
    }
    if (regions.length < 32) regions.push({ type: 'NEW_TONAL_CLIPPING', pixels: tail,
      bounds: { left: frame.bounds.left + left * sx, top: frame.bounds.top + top * sy,
        right: frame.bounds.left + right * sx, bottom: frame.bounds.top + bottom * sy } });
  }
  return regions;
}

function inspectStructure(before, after, mask, options = {}) {
  if (before.width !== after.width || before.height !== after.height || before.profile !== after.profile || before.maximum !== after.maximum
    || ['left', 'top', 'right', 'bottom'].some(key => before.bounds[key] !== after.bounds[key])) throw new Error('Fabric comparison geometry/profile/depth differs');
  const a = options.sourceSignals || signals(before, mask, { includeLab: false }), b = signals(after, mask, { includeLab: false });
  const n = before.width * before.height, width = before.width, height = before.height;
  const fine = pairAccumulator(), broad = pairAccumulator(), highlights = pairAccumulator(), shadows = pairAccumulator();
  const orientation = [pairAccumulator(), pairAccumulator(), pairAccumulator(), pairAccumulator()];
  const stride = Math.max(1, Math.ceil(n / 32768));
  const newClips = new Uint8Array(n);
  let protectedCount = 0, protectedChanged = 0, material = 0, newClipping = 0, recoveredClipping = 0, halos = 0, haloSamples = 0, edgeSamples = 0, edgeHalos = 0;
  const fullResolution = a.scaleX === 1 && a.scaleY === 1;
  const clipped = (frame, i) => [0, 1, 2].every(c => frame.data[i * frame.components + c] <= 1)
    || [0, 1, 2].every(c => frame.data[i * frame.components + c] >= frame.maximum - 1);
  for (let i = 0; i < n; i++) {
    const x = i % width, y = Math.floor(i / width), alpha = coverage(mask, before.bounds.left + (x + .5) * a.scaleX, before.bounds.top + (y + .5) * a.scaleY);
    if (alpha === 0) {
      protectedCount++;
      const offsetA = i * before.components, offsetB = i * after.components;
      const aa = before.components === 4 ? before.data[offsetA + 3] : before.maximum, ba = after.components === 4 ? after.data[offsetB + 3] : after.maximum;
      if (aa !== ba || aa > 0 && [0, 1, 2].some(c => before.data[offsetA + c] !== after.data[offsetB + c])) protectedChanged++;
    }
    if (!a.interior[i]) continue;
    material++;
    const ca = clipped(before, i), cb = clipped(after, i);
    if (!ca && cb) { newClipping++; newClips[i] = 1; }
    if (ca && !cb) recoveredClipping++;
    if (i % stride !== 0) continue;
    for (const distance of [1, 4, 16]) for (let d = 0; d < 4; d++) {
      const [dx, dy] = [[distance, 0], [0, distance], [distance, distance], [distance, -distance]][d];
      if (x + dx >= width || y + dy < 0 || y + dy >= height) continue;
      const j = i + dx + dy * width;
      if (!a.interior[j] || !b.interior[i] || !b.interior[j]) continue;
      const da = (a.luminance[j] - a.luminance[i]) / Math.max(1e-6, a.median);
      const db = (b.luminance[j] - b.luminance[i]) / Math.max(1e-6, b.median);
      if (distance === 1) {
        addPair(fine, da, db); addPair(orientation[d], da, db);
        if (a.luminance[i] >= a.highlight && a.luminance[j] >= a.highlight) addPair(highlights, da, db);
        if (a.luminance[i] <= a.low && a.luminance[j] <= a.low) addPair(shadows, da, db);
      } else addPair(broad, da, db);
    }
    if (x > 0 && x + 1 < width && y > 0 && y + 1 < height) {
      const adjacent = [i - 1, i + 1, i - width, i + width];
      const isEdge = adjacent.some(j => !a.interior[j]);
      const lowA = Math.min(...adjacent.map(j => a.luminance[j])), highA = Math.max(...adjacent.map(j => a.luminance[j]));
      const lowB = Math.min(...adjacent.map(j => b.luminance[j])), highB = Math.max(...adjacent.map(j => b.luminance[j]));
      const originalExtremum = a.luminance[i] < lowA - 1e-5 || a.luminance[i] > highA + 1e-5;
      const overshoot = !originalExtremum && (b.luminance[i] < lowB - Math.max(.001, b.median * .02)
        || b.luminance[i] > highB + Math.max(.001, b.median * .02));
      haloSamples++; if (overshoot) halos++;
      if (isEdge) { edgeSamples++; if (overshoot) edgeHalos++; }
    }
  }
  const foldDepth = a.median > 1e-6 && b.median > 1e-6 && a.high - a.low > 1e-6
    ? ((b.high - b.low) / b.median) / ((a.high - a.low) / a.median) : null;
  const fineMetrics = pairMetrics(fine), broadMetrics = pairMetrics(broad), highlightMetrics = pairMetrics(highlights);
  const regions = newClipping ? regionComponents(newClips, width, height, before) : [];
  const locate = (condition, type) => { if (condition) regions.push({ type, bounds: { ...before.bounds }, localization: 'MEASURED_FRAME_OR_TILE' }); };
  locate(finite(fineMetrics.retention) && fineMetrics.retention < CALIBRATION.minDetail, 'TEXTURE_DETAIL_LOSS');
  locate(finite(fineMetrics.residual) && fineMetrics.residual > CALIBRATION.maxNoiseResidual, 'UNCORRELATED_DETAIL_OR_NOISE');
  locate(finite(highlightMetrics.retention) && highlightMetrics.retention < CALIBRATION.minHighlightDetail, 'HIGHLIGHT_DETAIL_LOSS');
  locate(finite(broadMetrics.reversalFraction) && broadMetrics.reversalFraction > CALIBRATION.maxReversals, 'FOLD_REVERSAL');
  locate(haloSamples > 0 && halos / haloSamples > CALIBRATION.maxHaloFraction, 'NEW_OVERSHOOT');
  return { resolution: fullResolution ? 'FULL' : 'REDUCED', materialSamples: material,
    fine: fineMetrics, broad: broadMetrics, highlights: highlightMetrics, shadows: pairMetrics(shadows), orientations: orientation.map(pairMetrics),
    foldDepth, protectedPixelsChanged: fullResolution ? protectedChanged : null, protectedPixelsCompared: fullResolution ? protectedCount : 0,
    resampledProtectedDifferences: fullResolution ? null : protectedChanged,
    addedClippingFraction: material ? newClipping / material : null, newClippingPixels: newClipping, recoveredClippingPixels: recoveredClipping,
    haloFraction: haloSamples ? halos / haloSamples : null, edgeHaloFraction: edgeSamples ? edgeHalos / edgeSamples : null, edgeSamples,
    regions,
    componentScope: 'Connected clipping regions within each measured frame/tile; boundary-crossing components may appear in adjacent tiles' };
}
function check(value, passed, reason, confidence = 'MEASURED') {
  return { available: value !== null && value !== undefined, value, status: value == null ? 'UNAVAILABLE' : passed ? 'PASS' : 'REVIEW', confidence, reason };
}
function buildReport(metrics, colorDifference, analysis, options = {}) {
  const p = CALIBRATION, f = metrics.fine || {}, h = metrics.highlights || {}, broad = metrics.broad || {};
  const gamut = labToRgb(analysis.target.diffuseLab, ADOBE_RGB).clipped || options.targetGamutClipped === true;
  const checks = {
    color: check(colorDifference, colorDifference <= p.maxColorDifference && !gamut, gamut ? 'Target exceeds the working gamut' : 'Diffuse color only; no reference-shadow histogram matching'),
    lighting: check(metrics.foldDepth, metrics.foldDepth >= p.minFoldDepth && metrics.foldDepth <= p.maxFoldDepth
      && (broad.reversalFraction == null || broad.reversalFraction <= p.maxReversals), 'Source-relative shading and fold order'),
    texture: check(f.correlation, f.correlation >= p.minCorrelation && f.retention >= p.minDetail && f.retention <= p.maxDetail, 'Multidirectional source-correlated detail; noise energy alone earns no credit'),
    noise: check(f.residual, f.residual <= p.maxNoiseResidual, 'Uncorrelated detail estimate; not a physical noise measurement'),
    highlights: check(h.retention, h.retention >= p.minHighlightDetail && (h.correlation == null || h.correlation >= .75), 'Bright source-region fabric detail'),
    shadows: check((metrics.shadows || {}).correlation, (metrics.shadows || {}).correlation >= .75, 'Dark source-region structure; clipped source data is not recoverable'),
    clipping: check(metrics.addedClippingFraction, metrics.addedClippingFraction <= p.maxNewClipping, 'Newly clipped pixels counted independently of recovered pixels'),
    halos: check(metrics.haloFraction, metrics.haloFraction <= p.maxHaloFraction, 'New local extrema/overshoot'),
    edges: check(metrics.edgeSamples ? metrics.edgeHaloFraction : null, metrics.edgeHaloFraction <= p.maxHaloFraction,
      'Mask-band halo diagnostic; confirmed material selection still requires visual edge review'),
    protectedPixels: check(metrics.protectedPixelsChanged, metrics.protectedPixelsChanged === 0, 'Exact channels outside confirmed material mask at native resolution'),
    nativeIntegrity: check(options.nativeVerified === true ? true : null, options.nativeVerified === true, 'Preview ownership, frozen source and native adjustment structure')
  };
  if (metrics.noProtectedPixels === true) checks.protectedPixels = { available: true, value: 0, status: 'PASS', confidence: 'NOT_APPLICABLE', reason: 'Confirmed material mask covers the full canvas' };
  if (metrics.noMaskBoundary === true) checks.edges = { available: true, value: 0, status: 'PASS', confidence: 'NOT_APPLICABLE', reason: 'No interior mask boundary exists on the confirmed canvas' };
  const integrityFailure = metrics.protectedPixelsChanged > 0 || options.integrityFailure === true;
  const issues = Object.keys(checks).filter(key => checks[key].status !== 'PASS').map(key => ({ dimension: key, ...checks[key] }));
  const verdict = integrityFailure ? 'INTEGRITY_FAILURE' : issues.length || analysis.risks.length ? 'NEEDS_REVIEW' : 'CHECKS_PASSED';
  return { schemaVersion: 2, version: 'fabric-quality-1', calibrationVersion: p.version, calibrationStatus: 'PROVISIONAL_DEVELOPMENT',
    verdict, checks, issues, risks: analysis.risks.slice(), confidence: analysis.confidence, targetGamutClipped: gamut,
    resolution: metrics.resolution, regions: metrics.regions || [], metrics, productionQualified: false };
}
function evaluate(before, after, mask, analysis, options = {}) {
  const measurement = measureMaterial(after, mask), metrics = inspectStructure(before, after, mask, options);
  const difference = measurement.available ? deltaE00(measurement.diffuseLab, analysis.target.diffuseLab) : null;
  const report = buildReport(metrics, difference, analysis, options);
  const deficits = ['lighting', 'texture', 'noise', 'highlights', 'shadows', 'clipping', 'halos'].filter(key => report.checks[key].status === 'REVIEW').length;
  return { available: difference !== null, evaluationVersion: 'fabric-quality-1', measurement, anchorDeltaE00: difference,
    score: difference === null ? null : difference + deficits * 3 + 20 * (metrics.addedClippingFraction || 0),
    integrity: { critical: report.verdict === 'INTEGRITY_FAILURE', ...metrics, normalizedDetailRatio: metrics.fine.retention,
      relativeLightingSpread: metrics.foldDepth, highlightDetailRetention: metrics.highlights.retention },
    report, targetGamutClipped: report.targetGamutClipped, status: report.verdict };
}

module.exports = { CALIBRATION, inspectStructure, buildReport, evaluate, pairAccumulator, pairMetrics };
