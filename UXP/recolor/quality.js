const { ADOBE_RGB, SRGB, rgbToLab, deltaE00 } = require("./color");

function quantile(values, fraction) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position), high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

function validateFrame(frame) {
  if (!frame || !Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.width < 1 || frame.height < 1
    || ![3, 4].includes(frame.components) || !frame.data || frame.data.length !== frame.width * frame.height * frame.components
    || ![255, 32768, 65535].includes(frame.maximum) || ![ADOBE_RGB, SRGB].includes(frame.profile)) {
    throw new Error("Invalid explicitly profiled image frame");
  }
  const b = frame.bounds;
  if (!b || ![b.left, b.top, b.right, b.bottom].every(Number.isFinite) || b.right <= b.left || b.bottom <= b.top) {
    throw new Error("Image frame requires full-document coordinate bounds");
  }
}

function validateMask(mask) {
  if (!mask || !Number.isInteger(mask.width) || !Number.isInteger(mask.height) || mask.width < 1 || mask.height < 1
    || !Number.isFinite(mask.left) || !Number.isFinite(mask.top) || ![255, 32768, 65535].includes(mask.maximum)
    || !mask.data || mask.data.length !== mask.width * mask.height) throw new Error("Invalid material mask");
}

function coverage(mask, x, y) {
  const mx = Math.floor(x - mask.left), my = Math.floor(y - mask.top);
  if (mx < 0 || my < 0 || mx >= mask.width || my >= mask.height) return 0;
  return mask.data[my * mask.width + mx] / mask.maximum;
}

function point(frame, index) {
  const b = frame.bounds;
  return [b.left + (index % frame.width + 0.5) * (b.right - b.left) / frame.width,
    b.top + (Math.floor(index / frame.width) + 0.5) * (b.bottom - b.top) / frame.height];
}

function rgb(frame, index) {
  const offset = index * frame.components;
  return [0, 1, 2].map(c => frame.data[offset + c] / frame.maximum * 255);
}

function opaque(frame, index) {
  return frame.components === 3 || frame.data[index * 4 + 3] / frame.maximum >= 0.98;
}

function measureMaterial(frame, mask, options = {}) {
  validateFrame(frame); validateMask(mask);
  const minimum = options.minimumSamples == null ? 16 : options.minimumSamples;
  const count = frame.width * frame.height;
  const stride = Math.max(1, Math.ceil(count / 50000));
  const samples = [];
  for (let index = 0; index < count; index += stride) {
    const p = point(frame, index);
    if (coverage(mask, p[0], p[1]) < 0.98 || !opaque(frame, index)) continue;
    samples.push(rgbToLab(rgb(frame, index), frame.profile));
  }
  if (samples.length < minimum) return { available: false, reason: "Not enough opaque interior material samples", sampleCount: samples.length };
  const lightness = samples.map(v => v[0]);
  const low = quantile(lightness, 0.25), high = quantile(lightness, 0.75);
  const diffuse = samples.filter(v => v[0] >= low && v[0] <= high);
  return {
    available: true, measurementSpace: "CIELAB D50 2deg", sampleCount: samples.length,
    diffuseLab: [0, 1, 2].map(c => quantile(diffuse.map(v => v[c]), 0.5)),
    lightness: { shadow: quantile(lightness, 0.1), median: quantile(lightness, 0.5), highlight: quantile(lightness, 0.9) },
    method: "Interior IQR diffuse anchor; not physical reflectance or per-pixel gold comparison"
  };
}

function sameGeometry(a, b) {
  return a.width === b.width && a.height === b.height && a.components === b.components && a.maximum === b.maximum
    && a.profile === b.profile && ["left", "top", "right", "bottom"].every(key => a.bounds[key] === b.bounds[key]);
}

function compareFrames(before, after, mask) {
  validateFrame(before); validateFrame(after); validateMask(mask);
  if (!sameGeometry(before, after)) throw new Error("Cannot compare frames with different geometry, depth, or profiles");
  let changed = 0, protectedCount = 0, interior = 0, clippedBefore = 0, clippedAfter = 0;
  let channelClippedBefore = 0, channelClippedAfter = 0;
  let detailBefore = 0, detailAfter = 0, detailPairs = 0;
  const lumas = [];
  const xScale = (before.bounds.right - before.bounds.left) / before.width;
  const yScale = (before.bounds.bottom - before.bounds.top) / before.height;
  const fullResolution = xScale === 1 && yScale === 1;
  const stride = Math.max(1, Math.ceil(before.width * before.height / 50000));
  const weights = before.profile === ADOBE_RGB ? [0.2973449753, 0.6273635663, 0.0752914585] : [0.2126390059, 0.7151686788, 0.0721923154];
  const luminance = v => weights[0] * v[0] + weights[1] * v[1] + weights[2] * v[2];
  for (let index = 0; index < before.width * before.height; index += 1) {
    const x = before.bounds.left + (index % before.width + 0.5) * xScale;
    const y = before.bounds.top + (Math.floor(index / before.width) + 0.5) * yScale;
    const alpha = coverage(mask, x, y);
    const offset = index * before.components;
    if (alpha === 0) {
      protectedCount += 1;
      for (let c = 0; c < before.components; c += 1) if (before.data[offset + c] !== after.data[offset + c]) { changed += 1; break; }
    }
    if (index % stride !== 0 || alpha < 0.98 || !opaque(before, index)) continue;
    interior += 1;
    const a = rgb(before, index), b = rgb(after, index);
    // A saturated target can legitimately sit on one RGB gamut boundary.
    // Track that separately from complete black/white tonal clipping.
    const toneClipped = values => values.every(v => v <= 0.5) || values.every(v => v >= 254.5);
    if (toneClipped(a)) clippedBefore += 1;
    if (toneClipped(b)) clippedAfter += 1;
    if (a.some(v => v <= 0.5 || v >= 254.5)) channelClippedBefore += 1;
    if (b.some(v => v <= 0.5 || v >= 254.5)) channelClippedAfter += 1;
    const la = luminance(a), lb = luminance(b);
    lumas.push([la, lb]);
    if (index % before.width > 0) {
      if (coverage(mask, x - xScale, y) >= 0.98 && opaque(before, index - 1)) {
        detailBefore += Math.abs(la - luminance(rgb(before, index - 1)));
        detailAfter += Math.abs(lb - luminance(rgb(after, index - 1)));
        detailPairs += 1;
      }
    }
  }
  const spread = channel => quantile(lumas.map(v => v[channel]), 0.9) - quantile(lumas.map(v => v[channel]), 0.1);
  const normalizedBefore = lumas.length ? spread(0) : 0, normalizedAfter = lumas.length ? spread(1) : 0;
  const detailRatio = detailPairs && detailBefore > 0 && normalizedBefore > 1 && normalizedAfter > 1
    ? (detailAfter / normalizedAfter) / (detailBefore / normalizedBefore) : null;
  return {
    protectedPixelsChanged: fullResolution ? changed : null, protectedPixelsCompared: fullResolution ? protectedCount : 0,
    protectedCheckAvailable: fullResolution && protectedCount > 0,
    requiresFullResolutionCheck: !fullResolution,
    resampledProtectedDifferences: fullResolution ? null : changed,
    interiorSamples: interior,
    addedClippingFraction: interior ? Math.max(0, clippedAfter - clippedBefore) / interior : null,
    addedChannelClippingFraction: interior ? Math.max(0, channelClippedAfter - channelClippedBefore) / interior : null,
    clippingDefinition: "Tonal: all RGB channels near black or white; single-channel gamut boundaries are diagnostic",
    normalizedDetailRatio: detailRatio,
    critical: fullResolution && changed > 0,
    note: "Pixel checks precede export. Reduced frames do not certify full-resolution edges or texture."
  };
}

function evaluateRender(before, after, mask, target, options = {}) {
  const measurement = measureMaterial(after, mask, options);
  const integrity = compareFrames(before, after, mask);
  const validTarget = target && target.measurementSpace === "CIELAB D50 2deg"
    && Array.isArray(target.diffuseLab) && target.diffuseLab.length === 3 && target.diffuseLab.every(Number.isFinite);
  const difference = measurement.available && validTarget ? deltaE00(measurement.diffuseLab, target.diffuseLab) : null;
  return {
    evaluationVersion: "diffuse-tone-clipping-2",
    available: difference !== null, measurement, integrity, anchorDeltaE00: difference,
    // This is an anchor difference, not the median or p95 of a gold-image comparison.
    score: difference === null || integrity.critical ? null
      : difference + 50 * (integrity.addedClippingFraction || 0) + (integrity.normalizedDetailRatio === null ? 0 : 2 * Math.max(0, 0.8 - integrity.normalizedDetailRatio)),
    status: integrity.critical ? "INTEGRITY_FAILURE" : difference === null ? "NOT_EVALUATED" : "DESIGNER_REVIEW_REQUIRED"
  };
}

function compareGold(rendered, gold, mask, options = {}) {
  validateFrame(rendered); validateFrame(gold); validateMask(mask);
  if (rendered.width !== gold.width || rendered.height !== gold.height
    || !["left", "top", "right", "bottom"].every(key => rendered.bounds[key] === gold.bounds[key])) {
    return { available: false, reason: "Gold comparison geometry differs" };
  }
  // Unlike exact protected-pixel checks, color comparison normalizes each
  // frame's precision and converts its explicit profile to Lab D50 below.
  const differences = [], count = rendered.width * rendered.height, stride = Math.max(1, Math.ceil(count / 20000));
  for (let index = 0; index < count; index += stride) {
    const p = point(rendered, index);
    if (coverage(mask, p[0], p[1]) < 0.98 || !opaque(rendered, index) || !opaque(gold, index)) continue;
    differences.push(deltaE00(rgbToLab(rgb(rendered, index), rendered.profile), rgbToLab(rgb(gold, index), gold.profile)));
  }
  const sufficient = differences.length >= 16;
  return { available: sufficient && options.alignmentValidated === true,
    reason: !sufficient ? "Insufficient comparable material pixels" : options.alignmentValidated !== true ? "Paired-view alignment and region comparability require validation" : null,
    measurementSpace: "CIELAB D50 2deg", diagnostic: sufficient ? { sampleCount: differences.length,
      medianDeltaE00: quantile(differences, 0.5), p95DeltaE00: quantile(differences, 0.95) } : null,
    note: "Diagnostic statistics from an unvalidated alignment cannot satisfy release thresholds" };
}

module.exports = { quantile, validateMask, coverage, measureMaterial, compareFrames, evaluateRender, compareGold };
