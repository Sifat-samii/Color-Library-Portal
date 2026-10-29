// Native ActionJSON. Curves/HueSat/Gradient Map forms are cross-checked
// against Photoshop 25.3's bundled adjustments panel and the host fixtures.
// Tinted Black & White/Levels forms also match the read-only human audit;
// their creation, updates and saved editability are verified in Photoshop.
const { ADOBE_RGB, labToRgb } = require("./color");
const { TINTED_ENGINE_VERSION, ENGINE_VERSION, TRANSITION_ENGINE_VERSION, TRANSITION_TINTED_ENGINE_VERSION, LIGHTING_ENGINE_VERSION, LIGHTING_TINTED_ENGINE_VERSION, validateRecipe } = require("./recipes");
const { calibratedToneCurve, transitionToneCurve, naturalLightingCurve } = require("./training-standards");

function rgbColor(rgb) { return { _obj: "RGBColor", red: rgb[0], grain: rgb[1], blue: rgb[2] }; }
function curves(points) {
  return { _obj: "curves", adjustment: [{ _obj: "curvesAdjustment",
    channel: { _ref: "channel", _enum: "channel", _value: "composite" },
    curve: points.map(p => ({ _obj: "paint", horizontal: p[0], vertical: p[1] })) }] };
}
function adjustment(name, type, mode) {
  const using = { _obj: "adjustmentLayer", name, type };
  if (mode) using.mode = { _enum: "blendMode", _value: mode };
  return { _obj: "make", _target: [{ _ref: "adjustmentLayer" }], using };
}
function gray(lightness) { return labToRgb([Math.max(0, Math.min(100, lightness)), 0, 0], ADOBE_RGB).rgb[0]; }

function layerDescriptors(recipe) {
  if (recipe && recipe.schemaVersion === 2) return require('./fabric-recipes').descriptors(recipe);
  validateRecipe(recipe);
  const p = recipe.parameters, target = recipe.target.diffuseLab;
  const targetLab = [target[0], target[1] + p.chromaA, target[2] + p.chromaB];
  const targetRgb = labToRgb(targetLab, ADOBE_RGB);
  const list = [];
  const sourceMid = Math.max(8, Math.min(247, gray(recipe.sourceAnchor[0])));
  const targetMid = Math.max(3, Math.min(252, gray(target[0] + p.lightness)));
  const naturalLighting = recipe.engineVersion === LIGHTING_ENGINE_VERSION || recipe.engineVersion === LIGHTING_TINTED_ENGINE_VERSION;
  const transitionAware = naturalLighting || recipe.engineVersion === TRANSITION_ENGINE_VERSION || recipe.engineVersion === TRANSITION_TINTED_ENGINE_VERSION;
  const calibrated = transitionAware || recipe.engineVersion === ENGINE_VERSION || recipe.engineVersion === TINTED_ENGINE_VERSION;
  // A Gradient Map supplies its own target lightness at the midpoint. Feed it
  // a normalized source midpoint; B/D instead need the target tone directly.
  const tone = naturalLighting ? naturalLightingCurve(sourceMid, recipe.method === 'C' ? 128 + p.lightness * 2 : targetMid)
    : transitionAware ? transitionToneCurve(sourceMid, recipe.method === 'C' ? 128 + p.lightness * 2 : targetMid,
    recipe.method === 'C' ? 58 : target[0] + p.lightness)
    : calibrated ? calibratedToneCurve(sourceMid, targetMid, target[0] + p.lightness)
    : recipe.method === "C" ? [[0, 0], [128, Math.max(3, Math.min(252, 128 + p.lightness * 2))], [255, 255]]
      : [[0, 0], [sourceMid, targetMid], [255, 255]];
  list.push({ role: "tone", command: adjustment("Material Tone Adjustments", curves(tone), recipe.method === "D" ? "normal" : "luminosity") });
  if (recipe.method === "A") {
    list.push({ role: "target", command: { _obj: "make", _target: [{ _ref: "contentLayer" }], using: {
      _obj: "contentLayer", name: "Target Color Adjustments", mode: { _enum: "blendMode", _value: "color" },
      type: { _obj: "solidColorLayer", color: rgbColor(targetRgb.rgb) }
    } } });
  } else if (recipe.method === "B") {
    list.push({ role: "target", command: adjustment("Target Color Adjustments", {
      _obj: "hueSaturation", colorize: false,
      adjustment: [{ _obj: "hueSatAdjustmentV2", hue: Math.round(p.hue), saturation: Math.round(p.saturation), lightness: 0 }]
    }, "color") });
    list.push({ role: "undertone", command: adjustment("Undertone Corrections", {
      _obj: "selectiveColor", method: { _enum: "correctionMethod", _value: "relative" },
      colorCorrection: [{ _obj: "colorCorrection", colors: { _enum: "colors", _value: "neutrals" },
        cyan: -p.chromaA * 2, magenta: 0, yellowColor: p.chromaB * 2, black: 0 }]
    }, "color") });
  } else if (recipe.method === "D") {
    list.push({ role: "levels", command: adjustment("Material Levels", {
      _obj: "levels", adjustment: [{ _obj: "levelsAdjustment",
        channel: { _ref: "channel", _enum: "channel", _value: "composite" },
        input: [0, 255], gamma: p.gamma, output: [0, 255] }]
    }, "normal") });
    if (calibrated) list.push({ role: "neutralize", command: adjustment("Source Color Neutralization", {
      _obj: "hueSaturation", colorize: false,
      adjustment: [{ _obj: "hueSatAdjustmentV2", hue: 0, saturation: -100, lightness: 0 }]
    }, "normal") });
    // Standard channel weights are independent of any target's human stack.
    // Only the prepared reference supplies the tint; fitting measures Photoshop.
    list.push({ role: "target", command: adjustment("Target Color Adjustments", {
      _obj: "blackAndWhite", red: 40, yellow: 60, grain: 40, cyan: 60, blue: 20, magenta: 80,
      useTint: true, tintColor: rgbColor(targetRgb.rgb)
    }, "normal") });
    if (calibrated) list.push({ role: "balance", command: adjustment("Tonal Color Balance", {
      _obj: "colorBalance", shadowLevels: [0, 0, 0],
      midtoneLevels: [Math.round(p.balanceCyanRed), Math.round(p.balanceMagentaGreen), Math.round(p.balanceYellowBlue)],
      highlightLevels: [0, 0, 0], preserveLuminosity: true
    }, "normal") });
  } else {
    const stops = [[0, -35, 0.55], [1024, -18, 0.85], [2048, 0, 1], [3072, 18, 0.7], [4096, 35, 0.3]];
    const gradient = { _obj: "gradientClassEvent", name: "Prepared material target",
      gradientForm: { _enum: "gradientForm", _value: "customStops" }, interlace: 4096,
      colors: stops.map(([location, light, chroma]) => ({ _obj: "colorStop", location, midpoint: 50,
        type: { _enum: "colorStopType", _value: "userStop" },
        color: rgbColor(labToRgb([Math.max(2, Math.min(98, target[0] + light)), targetLab[1] * chroma, targetLab[2] * chroma], ADOBE_RGB).rgb) })),
      transparency: [0, 4096].map(location => ({ _obj: "transferSpec", location, midpoint: 50, opacity: { _unit: "percentUnit", _value: 100 } })) };
    list.push({ role: "target", command: adjustment("Target Color Adjustments", {
      _obj: "gradientMapClass", gradient,
      gradientsInterpolationMethod: { _enum: "gradientInterpolationMethodType", _value: "classic" }
    }) });
  }
  // Monotonic controls: no reversals which would invert folds or texture.
  const contrast = p.contrast / 4;
  const low = Math.max(1, Math.min(126, 64 + p.shadows - contrast));
  const high = Math.max(129, Math.min(254, 192 + p.highlights + contrast));
  list.push({ role: "lighting", command: adjustment("Highlight & Shadow Adjustments", curves([[0, 0], [64, low], [192, high], [255, 255]]), "luminosity") });
  return { layers: list, targetGamutClipped: targetRgb.clipped };
}

module.exports = { layerDescriptors, curves };
