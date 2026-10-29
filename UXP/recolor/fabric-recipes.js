const { createCandidates, LIMITS, TINTED_LIMITS } = require('./recipes');
const { ADOBE_RGB, labToRgb, decodeChannel, encodeChannel } = require('./color');
const { TRAINING_STANDARD } = require('./training-standards');

const ENGINE_VERSION = 'native-fabric-1';
const METHODS = Object.freeze(['A', 'B', 'C', 'D']);
const PARAMETER_LIMITS = Object.freeze({ ...LIMITS, ...TINTED_LIMITS, blackFloor: [0, 24], whiteCeiling: [230, 255], rolloff: [.4, 2] });
const clone = value => JSON.parse(JSON.stringify(value));
function candidates(analysis, methods = analysis.methods) {
  if (!Array.isArray(methods) || !methods.length || new Set(methods).size !== methods.length || methods.some(method => !METHODS.includes(method))) throw new Error('Unknown fabric recoloring method');
  return createCandidates(analysis.source, { ...analysis.target, material: 'MATTE' }, { includeTintedBlackWhite: true, methods }).map(seed => ({
    ...seed, schemaVersion: 2, engineVersion: ENGINE_VERSION, calibrationVersion: 'fabric-development-1', status: 'EXPERIMENTAL_DESIGNER_REVIEW_REQUIRED',
    parameters: { gamma: 1, balanceCyanRed: 0, balanceMagentaGreen: 0, balanceYellowBlue: 0, ...seed.parameters,
      blackFloor: 0, whiteCeiling: analysis.transition.nearWhite ? 253 : 255, rolloff: analysis.transition.nearWhite ? 1.25 : 1 },
    signatures: clone(analysis.signatures), provenance: { corpusSha256: TRAINING_STANDARD.corpusSha256, uniqueHumanRecipes: TRAINING_STANDARD.uniqueRecipes,
      priorUse: 'Candidate order/initialization only; no named-color lookup or preference override' },
    tone: { space: 'LINEAR_RGB_LUMINANCE', sourceMedian: Math.max(.0001, analysis.linearRange.median), sourceLow: analysis.linearRange.low,
      sourceHigh: analysis.linearRange.high, strategy: 'MONOTONIC_WITH_SHOULDER' },
    chroma: { strategy: seed.method === 'B' ? 'TARGETED_HUE_RANGE' : seed.method === 'C' ? 'COLOR_GRADIENT' : seed.method === 'D' ? 'NEUTRALIZE_TINT' : 'COLOR_FILL' },
    localCorrections: { enabled: analysis.transition.demanding && analysis.localMasksAvailable !== false, masks: ['SOURCE_SHADOWS', 'SOURCE_HIGHLIGHTS'], generatedTexture: false }
  }));
}
function validate(recipe) {
  if (!recipe || recipe.schemaVersion !== 2 || recipe.engineVersion !== ENGINE_VERSION || !METHODS.includes(recipe.method)) throw new Error('Unsupported fabric recipe');
  createCandidates({ diffuseLab: recipe.sourceAnchor }, { ...recipe.target, material: 'MATTE' });
  if (!recipe.tone || !Number.isFinite(recipe.tone.sourceMedian) || recipe.tone.sourceMedian <= 0 || recipe.tone.sourceMedian > 1
    || ![recipe.tone.sourceLow, recipe.tone.sourceHigh].every(Number.isFinite) || recipe.tone.sourceLow < 0 || recipe.tone.sourceHigh > 1
    || recipe.tone.sourceLow > recipe.tone.sourceHigh) throw new Error('Invalid source tone analysis');
  if (!recipe.signatures || ['source', 'mask', 'reference'].some(key => !/^[a-f0-9]{64}$/.test(recipe.signatures[key] || ''))) throw new Error('Recipe signatures are missing');
  if (recipe.tone.space !== 'LINEAR_RGB_LUMINANCE' || recipe.tone.strategy !== 'MONOTONIC_WITH_SHOULDER'
    || !recipe.chroma || !recipe.localCorrections || typeof recipe.localCorrections.enabled !== 'boolean'
    || recipe.localCorrections.generatedTexture !== false) throw new Error('Unsupported fabric processing stages');
  for (const [key, [low, high]] of Object.entries(PARAMETER_LIMITS)) if (!Number.isFinite(recipe.parameters[key]) || recipe.parameters[key] < low || recipe.parameters[key] > high) throw new Error('Invalid fabric parameter: ' + key);
}
function adjust(recipe, key, delta) {
  validate(recipe);
  if (!PARAMETER_LIMITS[key] || !Number.isFinite(delta)) throw new Error('Invalid fabric fitting parameter');
  const copy = clone(recipe), [low, high] = PARAMETER_LIMITS[key];
  copy.parameters[key] = Math.max(low, Math.min(high, copy.parameters[key] + delta));
  return copy;
}
function toneCurve(recipe) {
  validate(recipe);
  const p = recipe.parameters, source = Math.max(.0001, Math.min(.98, recipe.tone.sourceMedian));
  const targetCode = labToRgb([Math.max(1, Math.min(98, recipe.target.diffuseLab[0] + p.lightness)), 0, 0], ADOBE_RGB).rgb[0] / 255;
  const floor = decodeChannel(p.blackFloor / 255, ADOBE_RGB), ceiling = decodeChannel(p.whiteCeiling / 255, ADOBE_RGB);
  const target = Math.max(floor + .0001, Math.min(ceiling - .0001, decodeChannel(targetCode, ADOBE_RGB)));
  const pivot = Math.round(encodeChannel(source, ADOBE_RGB) * 255);
  const xs = [...new Set([0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 248, 255, Math.max(1, Math.min(254, pivot))])].sort((a, b) => a - b);
  let previous = 0;
  return xs.map(code => {
    const x = decodeChannel(code / 255, ADOBE_RGB);
    const y = x <= source ? floor + (target - floor) * x / source
      : target + (ceiling - target) * (1 - Math.exp(-(x - source) * (target - floor) / source / (ceiling - target) / p.rolloff));
    const encoded = Math.max(previous, Math.min(p.whiteCeiling, Math.round(encodeChannel(Math.max(0, y), ADOBE_RGB) * 255)));
    previous = encoded;
    return [code, encoded];
  });
}
function descriptors(recipe) {
  validate(recipe);
  // Reuse tested native adjustment vocabulary, then replace only v2 behavior.
  const legacy = createCandidates({ diffuseLab: recipe.sourceAnchor }, { ...recipe.target, material: 'MATTE' }, { includeTintedBlackWhite: true, methods: [recipe.method] })[0];
  for (const key of Object.keys(legacy.parameters)) legacy.parameters[key] = recipe.parameters[key];
  if (recipe.method === 'D') {
    // V2 always has an explicit neutralize/tint/balance stage, including targets
    // with diffuse-only evidence. Do not fabricate reference-zone measurements.
    legacy.engineVersion = require('./recipes').TINTED_ENGINE_VERSION;
    for (const key of ['balanceCyanRed', 'balanceMagentaGreen', 'balanceYellowBlue']) legacy.parameters[key] = recipe.parameters[key];
  }
  const native = require('./native-descriptors').layerDescriptors(legacy);
  const { curves } = require('./native-descriptors'), p = recipe.parameters;
  native.layers.find(layer => layer.role === 'tone').command.using.type = curves(toneCurve(recipe));
  native.layers.find(layer => layer.role === 'tone').command.using.mode = { _enum: 'blendMode', _value: 'luminosity' };
  if (recipe.method === 'C') native.layers.find(layer => layer.role === 'target').command.using.mode = { _enum: 'blendMode', _value: 'color' };
  if (recipe.method === 'B') {
    const rgb = labToRgb(recipe.sourceAnchor, ADOBE_RGB).rgb, max = Math.max(...rgb), min = Math.min(...rgb), delta = max - min;
    let hue = !delta ? 0 : max === rgb[0] ? (rgb[1] - rgb[2]) / delta : max === rgb[1] ? 2 + (rgb[2] - rgb[0]) / delta : 4 + (rgb[0] - rgb[1]) / delta;
    hue = (hue * 60 + 360) % 360;
    const center = Math.round(hue / 60) % 6 * 60, wrap = value => (value + 360) % 360;
    const payload = native.layers.find(layer => layer.role === 'target').command.using.type;
    payload.adjustment = [{ _obj: 'hueSatAdjustmentV2', hue: 0, saturation: 0, lightness: 0 },
      { _obj: 'hueSatAdjustmentV2', localRange: center / 60 + 1, beginRamp: wrap(center - 45), beginSustain: wrap(center - 15),
        endSustain: wrap(center + 15), endRamp: wrap(center + 45), hue: Math.round(p.hue), saturation: Math.round(p.saturation), lightness: 0 }];
  }
  if (recipe.method !== 'D') {
    native.layers.push({ role: 'balance', command: { _obj: 'make', _target: [{ _ref: 'adjustmentLayer' }], using: { _obj: 'adjustmentLayer', name: 'Tonal Color Balance',
      type: { _obj: 'colorBalance', shadowLevels: [0, 0, 0], midtoneLevels: [p.balanceCyanRed, p.balanceMagentaGreen, p.balanceYellowBlue].map(Math.round),
        highlightLevels: [0, 0, 0], preserveLuminosity: true } } } });
  }
  const lighting = native.layers.find(layer => layer.role === 'lighting');
  lighting.command.using.type = curves([[0, 0], [64, Math.max(1, 64 - p.contrast / 4)], [192, Math.min(254, 192 + p.contrast / 4)], [255, 255]]);
  if (recipe.localCorrections.enabled) {
    for (const [role, value, label] of [['shadowLocal', p.shadows, 'Local shadow detail'], ['highlightLocal', p.highlights, 'Local highlight protection']]) {
      native.layers.push({ role, localMask: role, command: { _obj: 'make', _target: [{ _ref: 'adjustmentLayer' }], using: { _obj: 'adjustmentLayer', name: label,
        mode: { _enum: 'blendMode', _value: 'luminosity' }, type: curves([[0, 0], [96, 96 + value], [192, 192 + value * .4], [255, 255]]) } } });
    }
  } else lighting.command.using.type = curves([[0, 0], [64, Math.max(1, Math.min(126, 64 + p.shadows - p.contrast / 4))],
    [192, Math.max(129, Math.min(254, 192 + p.highlights + p.contrast / 4))], [255, 255]]);
  return native;
}
function zoneMasks(analysis) {
  const mask = analysis.mask, frame = analysis.frame, source = analysis.signals;
  if (mask.width * mask.height > 4000000) return null;
  const shadow = new Uint16Array(mask.width * mask.height), highlight = new Uint16Array(shadow.length);
  const smooth = value => { const x = Math.max(0, Math.min(1, value)); return x * x * (3 - 2 * x); };
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
    const fx = Math.max(0, Math.min(frame.width - 1, Math.floor((mask.left + x + .5 - frame.bounds.left) / source.scaleX)));
    const fy = Math.max(0, Math.min(frame.height - 1, Math.floor((mask.top + y + .5 - frame.bounds.top) / source.scaleY)));
    const value = source.luminance[fy * frame.width + fx], index = y * mask.width + x;
    // The parent owns material coverage; do not multiply its soft mask twice.
    shadow[index] = Math.round(65535 * (1 - smooth((value - source.low) / Math.max(1e-6, source.median - source.low))));
    highlight[index] = Math.round(65535 * smooth((value - source.median) / Math.max(1e-6, source.high - source.median)));
  }
  return { shadowLocal: { ...mask, maximum: 65535, data: shadow }, highlightLocal: { ...mask, maximum: 65535, data: highlight } };
}
module.exports = { ENGINE_VERSION, METHODS, PARAMETER_LIMITS, candidates, validate, adjust, toneCurve, descriptors, zoneMasks };
