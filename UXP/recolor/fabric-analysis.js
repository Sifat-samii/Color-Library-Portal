const { decodeChannel, ADOBE_RGB, rgbToLab } = require('./color');
const { measureMaterial, validateMask, coverage, quantile } = require('./quality');
const sha256 = require('./vendor/sha256');

const ANALYSIS_VERSION = 'fabric-analysis-1';
function signature(value) {
  const hash = sha256.create();
  if (value.data) {
    hash.update(JSON.stringify([value.width, value.height, value.components, value.maximum, value.profile, value.bounds, value.left, value.top]));
    hash.update(new Uint8Array(value.data.buffer, value.data.byteOffset, value.data.byteLength));
  } else hash.update(JSON.stringify(value));
  return hash.hex();
}
function signals(frame, mask, options = {}) {
  validateMask(mask);
  const count = frame.width * frame.height, luminance = new Float32Array(count), interior = new Uint8Array(count);
  const weights = frame.profile === ADOBE_RGB ? [.2973449753, .6273635663, .0752914585] : [.2126390059, .7151686788, .0721923154];
  const scaleX = (frame.bounds.right - frame.bounds.left) / frame.width;
  const scaleY = (frame.bounds.bottom - frame.bounds.top) / frame.height;
  const values = [], labs = [], stride = Math.max(1, Math.ceil(count / 32768));
  let samples = 0, clipped = 0, transition = 0, protectedCount = 0;
  for (let i = 0; i < count; i++) {
    const offset = i * frame.components;
    luminance[i] = weights.reduce((sum, weight, channel) => sum + weight * decodeChannel(frame.data[offset + channel] / frame.maximum, frame.profile), 0);
    const alpha = coverage(mask, frame.bounds.left + (i % frame.width + .5) * scaleX,
      frame.bounds.top + (Math.floor(i / frame.width) + .5) * scaleY);
    if (alpha === 0) protectedCount++;
    else if (alpha < .98) transition++;
    if (alpha < .98 || frame.components === 4 && frame.data[offset + 3] / frame.maximum < .98) continue;
    interior[i] = 1; samples++;
    if (luminance[i] <= 1e-6 || luminance[i] >= .99999) clipped++;
    if (i % stride === 0) {
      values.push(luminance[i]);
      if (options.includeLab !== false) labs.push(rgbToLab([0, 1, 2].map(c => frame.data[offset + c] / frame.maximum * 255), frame.profile));
    }
  }
  return { luminance, interior, samples, protectedCount, transition,
    clippedFraction: samples ? clipped / samples : null,
    median: quantile(values, .5), low: quantile(values, .1), high: quantile(values, .9), upperTail: quantile(values, .99),
    highlight: quantile(values, .75), values, labs, scaleX, scaleY };
}

// Edge-aware log-luminance residuals are diagnostics. They never replace pixels.
function multiscale(frame, source) {
  const width = frame.width, height = frame.height, stride = Math.max(1, Math.ceil(width * height / 8192));
  const bands = [[], []], noise = [], shading = [];
  for (let i = 0; i < width * height; i += stride) {
    if (!source.interior[i]) continue;
    const x = i % width, y = Math.floor(i / width), center = Math.log(Math.max(1e-6, source.luminance[i]));
    [8, 32].forEach((radius, band) => {
      const r = Math.max(1, Math.round(radius * Math.max(width, height) / 1024));
      let sum = 0, weights = 0;
      for (const [dx, dy] of [[0, 0], [-r, 0], [r, 0], [0, -r], [0, r], [-r, -r], [r, r], [-r, r], [r, -r]]) {
        if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
        const j = i + dy * width + dx;
        if (!source.interior[j]) continue;
        const value = Math.log(Math.max(1e-6, source.luminance[j]));
        const weight = Math.exp(-((value - center) ** 2) / .18);
        sum += weight * value; weights += weight;
      }
      bands[band].push(Math.abs(center - sum / weights));
      if (band === 1) shading.push(sum / weights);
    });
    if (x > 0 && x < width - 1 && y > 0 && y < height - 1
      && [i - 1, i + 1, i - width, i + width].every(j => source.interior[j])) {
      const nearby = [i - 1, i + 1, i - width, i + width].map(j => source.luminance[j]);
      if (Math.max(...nearby) - Math.min(...nearby) < Math.max(.002, source.median * .03)) {
        noise.push(Math.abs(source.luminance[i] - nearby.reduce((a, b) => a + b, 0) / 4));
      }
    }
  }
  return { logDetail: bands.map(values => quantile(values, .5)), shadingSpread: (quantile(shading, .9) || 0) - (quantile(shading, .1) || 0),
    noiseEstimate: noise.length >= 16 ? quantile(noise, .5) / Math.max(1e-6, source.median) : null,
    noiseSamples: noise.length, note: 'Estimated structure/noise, not an intrinsic decomposition or recoverable texture guarantee' };
}

function analyze({ source, mask, target, provenance = {}, material = 'MATTE', canvasBounds = source.bounds }) {
  const measured = measureMaterial(source, mask);
  if (!measured.available) throw new Error(measured.reason);
  if (!target || target.measurementSpace !== 'CIELAB D50 2deg' || !target.diffuseLab
    || target.diffuseLab.length !== 3 || !target.diffuseLab.every(Number.isFinite)) throw new Error('A valid approved-reference sample is required');
  const data = signals(source, mask), structure = multiscale(source, data), risks = [];
  const delta = target.diffuseLab[0] - measured.diffuseLab[0];
  const chromaVariation = Math.hypot(...[1, 2].map(channel => (quantile(data.labs.map(lab => lab[channel]), .9) || 0)
    - (quantile(data.labs.map(lab => lab[channel]), .1) || 0)));
  if (material !== 'MATTE') risks.push('Material reflection behavior is not qualified');
  if (data.clippedFraction > .005) risks.push('Source contains clipped material; missing detail cannot be reconstructed');
  if (chromaVariation > 22) risks.push('Possible mixed material, pattern or colored lighting; confirm a single fabric region');
  if (structure.noiseEstimate !== null && structure.noiseEstimate > .06) risks.push('Source noise may become visible after lightening');
  if (!data.median || data.median < .001) risks.push('Very little recoverable source exposure');
  if (data.upperTail > Math.max(.1, data.median * 8)) risks.push('Strong brightness separation in the mask; check for background, reflections or mixed materials');
  const targetChroma = Math.hypot(target.diffuseLab[1], target.diffuseLab[2]);
  const nearWhite = target.diffuseLab[0] >= 90 || target.diffuseLab[0] >= 85 && targetChroma <= 12;
  const direction = Math.abs(delta) < 12 ? 'SIMILAR_LIGHTNESS' : delta > 0 ? 'DARK_TO_LIGHT' : 'LIGHT_TO_DARK';
  const diffuseChroma = Math.hypot(measured.diffuseLab[1], measured.diffuseLab[2]);
  const highlightChroma = Math.hypot(measured.zones.highlightLab[1], measured.zones.highlightLab[2]);
  const publicData = { schemaVersion: 1, version: ANALYSIS_VERSION, canvasBounds: { ...canvasBounds }, source: measured, target: JSON.parse(JSON.stringify(target)),
    signatures: { source: signature(source), mask: signature(mask), reference: signature(target) }, provenance,
    transition: { sourceLightness: measured.diffuseLab[0], targetLightness: target.diffuseLab[0], deltaLightness: delta,
      direction, demanding: Math.abs(delta) >= 20, nearWhite }, material,
    linearRange: { low: data.low, median: data.median, high: data.high, upperTail: data.upperTail, clippedFraction: data.clippedFraction },
    structure, chromaVariation, risks, confidence: risks.length ? 'LIMITED' : 'SUPPORTED',
    surfaceAppearance: { diffuseChroma, highlightChroma,
      possibleSpecular: measured.zones.highlightLab[0] - measured.diffuseLab[0] > 10 && diffuseChroma > 5 && highlightChroma < diffuseChroma * .7,
      confidence: 'ESTIMATED', note: 'Bright low-chroma material may be specular or diffuse lighting; never automatically force it white' },
    likelySpill: measured.diffuseLab[1] ** 2 + measured.diffuseLab[2] ** 2 > 900 && Math.abs(delta) > 20,
    methods: delta >= 20 ? ['D', 'A', 'C', 'B'] : ['A', 'B', 'D', 'C'] };
  // Large typed arrays stay outside serializable analysis/manifests.
  return { ...publicData, signals: data, frame: source, mask };
}
function publicAnalysis(analysis) {
  const { signals: pixels, frame, mask, ...record } = analysis;
  return record;
}
module.exports = { ANALYSIS_VERSION, signature, signals, analyze, publicAnalysis };
