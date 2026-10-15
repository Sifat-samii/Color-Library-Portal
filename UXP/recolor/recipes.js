const { ADOBE_RGB, labToRgb } = require("./color");

const ENGINE_VERSION = "native-experimental-1";
const TINTED_ENGINE_VERSION = "native-tinted-bw-experimental-1";
const LIMITS = {
  lightness: [-60, 60], chromaA: [-35, 35], chromaB: [-35, 35],
  hue: [-180, 180], saturation: [-100, 100], contrast: [-40, 40],
  intensity: [0, 100], shadows: [-25, 25], highlights: [-25, 25]
};
const TINTED_LIMITS = { ...LIMITS, gamma: [0.25, 4] };

function hsv(rgb) {
  const [r, g, b] = rgb.map(v => v / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = !d ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max ? d / max * 100 : 0, max * 100];
}

function createCandidates(source, target, options = {}) {
  if (!source || !Array.isArray(source.diffuseLab) || source.diffuseLab.length !== 3 || !source.diffuseLab.every(Number.isFinite)) {
    throw new Error("A measured source diffuse region is required");
  }
  if (!target || target.measurementSpace !== "CIELAB D50 2deg" || !Array.isArray(target.diffuseLab)
    || target.diffuseLab.length !== 3 || !target.diffuseLab.every(Number.isFinite) || target.diffuseLab[0] < 0 || target.diffuseLab[0] > 100) {
    throw new Error("An explicit Lab D50 prepared image target is required");
  }
  if (target.material !== "MATTE") throw new Error("This experimental engine supports matte material only");
  const a = hsv(labToRgb(source.diffuseLab, ADOBE_RGB).rgb), b = hsv(labToRgb(target.diffuseLab, ADOBE_RGB).rgb);
  let hue = b[0] - a[0];
  if (hue > 180) hue -= 360;
  if (hue < -180) hue += 360;
  const methods = options.includeTintedBlackWhite === true ? ["A", "B", "C", "D"] : ["A", "B", "C"];
  return methods.map(method => ({
    schemaVersion: 1, engineVersion: method === "D" ? TINTED_ENGINE_VERSION : ENGINE_VERSION, method, status: "EXPERIMENTAL",
    sourceAnchor: source.diffuseLab.slice(), target: JSON.parse(JSON.stringify(target)),
    parameters: { lightness: 0, chromaA: 0, chromaB: 0, hue: method === "B" ? hue : 0,
      saturation: method === "B" ? Math.max(-100, Math.min(100, b[1] - a[1])) : 0,
      contrast: 0, intensity: 100, shadows: 0, highlights: 0, ...(method === "D" ? { gamma: 1 } : {}) }
  }));
}

function validateRecipe(recipe) {
  if (!recipe || recipe.schemaVersion !== 1 || !["A", "B", "C", "D"].includes(recipe.method)
    || recipe.engineVersion !== (recipe.method === "D" ? TINTED_ENGINE_VERSION : ENGINE_VERSION)) {
    throw new Error("Unsupported recolor recipe");
  }
  createCandidates({ diffuseLab: recipe.sourceAnchor }, recipe.target);
  const limits = recipe.method === "D" ? TINTED_LIMITS : LIMITS;
  for (const key of Object.keys(limits)) {
    const value = recipe.parameters && recipe.parameters[key], [min, max] = limits[key];
    if (!Number.isFinite(value) || value < min || value > max) throw new Error("Invalid recipe parameter: " + key);
  }
}

function adjustRecipe(recipe, key, delta) {
  validateRecipe(recipe);
  const limits = recipe.method === "D" ? TINTED_LIMITS : LIMITS;
  if (!limits[key] || !Number.isFinite(delta)) throw new Error("Invalid fitting parameter");
  const copy = JSON.parse(JSON.stringify(recipe));
  copy.parameters[key] = Math.max(limits[key][0], Math.min(limits[key][1], copy.parameters[key] + delta));
  return copy;
}

module.exports = { ENGINE_VERSION, LIMITS, createCandidates, validateRecipe, adjustRecipe };
