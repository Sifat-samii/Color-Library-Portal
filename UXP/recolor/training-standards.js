// Learned from 32 unique approved human TIFF recipes (34 files) audited in
// native Photoshop. These are tonal-family priors, never color-name lookups.
// Full provenance: docs/recoloring/verification/tiff-human-training-standards.json
const TRAINING_STANDARD = Object.freeze({
  schemaVersion: 1,
  corpusSha256: 'adc9f049810db6469c48addf7769b31373d4c7bd16bbf25039ff2706dc34be32',
  files: 34,
  uniqueRecipes: 32,
  families: Object.freeze([
    Object.freeze({ name: 'DARK', center: 34.2305, curve: Object.freeze([[0, 0], [64, 23.0698], [128, 49.3469], [192, 82.75], [255, 154]]) }),
    Object.freeze({ name: 'MID', center: 58.2241, curve: Object.freeze([[0, 0], [64, 42.3682], [128, 90.1379], [192, 149.5493], [255, 215.5]]) }),
    Object.freeze({ name: 'LIGHT', center: 80.3318, curve: Object.freeze([[0, 0], [64, 60.3429], [128, 120.6857], [192, 187.6174], [255, 255]]) })
  ]),
  observedTechniqueRates: Object.freeze({
    fullDesaturation: 1,
    tintedBlackAndWhite: 0.9063,
    curves: 0.875,
    colorBalance: 0.7188,
    texturePixels: 0.0938
  })
});

function interpolate(a, b, amount) { return a + (b - a) * amount; }

function familyCurve(lightness) {
  const families = TRAINING_STANDARD.families;
  if (lightness <= families[0].center) return families[0].curve.map(point => point.slice());
  if (lightness >= families[families.length - 1].center) return families[families.length - 1].curve.map(point => point.slice());
  const upper = families.findIndex(family => lightness <= family.center), lower = upper - 1;
  const amount = (lightness - families[lower].center) / (families[upper].center - families[lower].center);
  return families[lower].curve.map((point, index) => [point[0], interpolate(point[1], families[upper].curve[index][1], amount)]);
}

function sampleCurve(points, x) {
  if (x <= points[0][0]) return points[0][1];
  for (let index = 1; index < points.length; index += 1) {
    if (x <= points[index][0]) {
      const a = points[index - 1], b = points[index], amount = (x - a[0]) / (b[0] - a[0]);
      return interpolate(a[1], b[1], amount);
    }
  }
  return points[points.length - 1][1];
}

function monotonic(points) {
  let previous = 0;
  return points.map(([x, y], index) => {
    const ceiling = index === points.length - 1 ? 255 : 254;
    const value = Math.max(previous, Math.min(ceiling, Math.round(y)));
    previous = value;
    return [x, value];
  });
}

// Blend the corpus family with the old source/target anchor mapping. This
// preserves generalization to a new source while retaining the human endpoint
// and fold-compression behavior that the former one-anchor curve could not model.
function calibratedToneCurve(sourceInput, targetOutput, targetLightness) {
  const learned = familyCurve(targetLightness), source = Math.max(8, Math.min(247, sourceInput));
  const target = Math.max(3, Math.min(252, targetOutput));
  const anchor = [[0, 0], [source, target], [255, 255]];
  return monotonic(learned.map(([x, y]) => [x, y * 0.8 + sampleCurve(anchor, x) * 0.2]));
}

// For large changes, the source anchor must actually reach the target. Merely
// blending a fixed population curve with an anchor misses very dark inputs.
// Normalize the learned shape on either side of that anchor, explicitly keep
// the anchor as a knot, and retain strictly increasing shadow/highlight ramps.
function transitionToneCurve(sourceInput, targetOutput, targetLightness) {
  const source = Math.max(8, Math.min(247, Math.round(sourceInput)));
  const target = Math.max(3, Math.min(252, Math.round(targetOutput)));
  const learned = familyCurve(targetLightness), pivot = sampleCurve(learned, source);
  const end = Math.max(target + 3, learned[learned.length - 1][1]);
  const xs = [...new Set([0, source, 64, 128, 192, 255])].sort((a, b) => a - b);
  return monotonic(xs.map(x => {
    const shaped = x <= source ? sampleCurve(learned, x) / pivot * target
      : target + (sampleCurve(learned, x) - pivot) / (learned[learned.length - 1][1] - pivot) * (end - target);
    const linear = x <= source ? x / source * target : target + (x - source) / (255 - source) * (end - target);
    return [x, shaped * 0.8 + linear * 0.2];
  }));
}

// A material-lightening curve needs useful slope above AND below the diffuse
// midpoint. A weak upper ramp can match the average while washing out folds.
// Exposure-like local scaling keeps relative shading; a smooth shoulder rolls
// highlights toward white without hard clipping. The derivative meets at the
// pivot, avoiding the old bright-midpoint/flat-highlight knee.
function naturalLightingCurve(sourceInput, targetOutput) {
  const source = Math.max(8, Math.min(247, Math.round(sourceInput)));
  const target = Math.max(3, Math.min(252, Math.round(targetOutput)));
  const gain = target / source, headroom = 255 - target;
  const xs = [...new Set([0, ...[0.4, 0.65, 0.85, 1, 1.15, 1.35, 1.65, 2.2].map(scale => Math.max(1, Math.min(254, Math.round(source * scale)))), 255])].sort((a, b) => a - b);
  return monotonic(xs.map(x => [x, x === 255 ? 255 : x <= source ? x * gain
    : target + headroom * (1 - Math.exp(-gain * (x - source) / headroom))]));
}

module.exports = { TRAINING_STANDARD, familyCurve, calibratedToneCurve, transitionToneCurve, naturalLightingCurve };
