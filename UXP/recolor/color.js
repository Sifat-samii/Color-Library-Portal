// Color-critical measurements are Lab D50 (2 degree observer), not the
// catalog's Adobe RGB / D65 display values. Inputs are RGB code values 0..255.
const ADOBE_RGB = "Adobe RGB (1998)";
const SRGB = "sRGB IEC61966-2.1";
const D50 = [0.96422, 1, 0.82521];
const TO_D50 = [
  [1.0479298208405488, 0.022946793341019088, -0.05019222954313557],
  [0.029627815688159344, 0.990434484573249, -0.01707382502938514],
  [-0.009243058152591178, 0.015055144896577895, 0.7518742814281371]
];
const ADOBE_MATRIX = [
  [0.5766690429101305, 0.1855582379065463, 0.1882286462349947],
  [0.297344975250536, 0.6273635662554661, 0.0752914584939979],
  [0.0270313613864123, 0.0706888525358272, 0.9913375368376388]
];
const SRGB_MATRIX = [
  [0.4123907992659595, 0.357584339383878, 0.1804807884018343],
  [0.2126390058715104, 0.715168678767756, 0.0721923153607337],
  [0.0193308187155919, 0.119194779794626, 0.9505321522496607]
];

function multiply(matrix, vector) {
  return matrix.map(row => row.reduce((sum, value, index) => sum + value * vector[index], 0));
}

function inverse(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [[e * i - f * h, c * h - b * i, b * f - c * e],
    [f * g - d * i, a * i - c * g, c * d - a * f],
    [d * h - e * g, b * g - a * h, a * e - b * d]].map(row => row.map(v => v / determinant));
}
const FROM_D50 = inverse(TO_D50);
const FROM_ADOBE = inverse(ADOBE_MATRIX);
const FROM_SRGB = inverse(SRGB_MATRIX);

function validateProfile(profile) {
  if (profile !== ADOBE_RGB && profile !== SRGB) throw new Error("An explicit supported RGB profile is required");
}

function triple(values) {
  if (!Array.isArray(values) || values.length !== 3 || !values.every(Number.isFinite)) {
    throw new Error("Color must contain three finite channel values");
  }
}

function rgbToLab(rgb, profile) {
  validateProfile(profile);
  triple(rgb);
  if (rgb.some(v => v < 0 || v > 255)) throw new Error("RGB channels must be in 0..255");
  const linear = rgb.map(v => {
    const x = v / 255;
    return profile === ADOBE_RGB ? x ** (563 / 256) : x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  const xyz = multiply(TO_D50, multiply(profile === ADOBE_RGB ? ADOBE_MATRIX : SRGB_MATRIX, linear));
  // Adapted white is computed from the same matrices to avoid white-point
  // rounding producing false neutral casts in numerical comparisons.
  const white = multiply(TO_D50, multiply(profile === ADOBE_RGB ? ADOBE_MATRIX : SRGB_MATRIX, [1, 1, 1]));
  const f = xyz.map((v, i) => {
    const x = v / white[i];
    return x > (6 / 29) ** 3 ? Math.cbrt(x) : x / (3 * (6 / 29) ** 2) + 4 / 29;
  });
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])].map(v => Object.is(v, -0) ? 0 : v);
}

function labToRgb(lab, profile) {
  validateProfile(profile);
  triple(lab);
  const fy = (lab[0] + 16) / 116;
  const f = [fy + lab[1] / 500, fy, fy - lab[2] / 200];
  const white = multiply(TO_D50, multiply(profile === ADOBE_RGB ? ADOBE_MATRIX : SRGB_MATRIX, [1, 1, 1]));
  const xyz = f.map((v, i) => white[i] * (v > 6 / 29 ? v ** 3 : 3 * (6 / 29) ** 2 * (v - 4 / 29)));
  const linear = multiply(profile === ADOBE_RGB ? FROM_ADOBE : FROM_SRGB, multiply(FROM_D50, xyz));
  const encoded = linear.map(v => profile === ADOBE_RGB
    ? Math.sign(v) * Math.abs(v) ** (256 / 563)
    : v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  return { rgb: encoded.map(v => Math.max(0, Math.min(255, v * 255))), clipped: encoded.some(v => v < -0.000001 || v > 1.000001) };
}

function adobeRgbToDisplay(rgb) {
  const converted = labToRgb(rgbToLab(rgb, ADOBE_RGB), SRGB);
  return { hex: "#" + converted.rgb.map(v => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase(), clipped: converted.clipped };
}

// CIEDE2000, verified against Sharma/Wu/Dalal supplementary reference pairs.
function deltaE00(lab1, lab2) {
  triple(lab1); triple(lab2);
  const [L1, a1, b1] = lab1, [L2, a2, b2] = lab2;
  const cBar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const a1p = (1 + g) * a1, a2p = (1 + g) * a2;
  const c1 = Math.hypot(a1p, b1), c2 = Math.hypot(a2p, b2);
  const hue = (a, b) => a === 0 && b === 0 ? 0 : (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
  const h1 = hue(a1p, b1), h2 = hue(a2p, b2);
  let dh = h2 - h1;
  if (c1 * c2 === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  let hBar;
  if (c1 * c2 === 0) hBar = h1 + h2;
  else if (Math.abs(h1 - h2) <= 180) hBar = (h1 + h2) / 2;
  else hBar = (h1 + h2 + (h1 + h2 < 360 ? 360 : -360)) / 2;
  const c = (c1 + c2) / 2, l = (L1 + L2) / 2;
  const radians = x => x * Math.PI / 180;
  const t = 1 - 0.17 * Math.cos(radians(hBar - 30)) + 0.24 * Math.cos(radians(2 * hBar))
    + 0.32 * Math.cos(radians(3 * hBar + 6)) - 0.20 * Math.cos(radians(4 * hBar - 63));
  const sl = 1 + 0.015 * (l - 50) ** 2 / Math.sqrt(20 + (l - 50) ** 2);
  const sc = 1 + 0.045 * c, sh = 1 + 0.015 * c * t;
  const rt = -2 * Math.sqrt(c ** 7 / (c ** 7 + 25 ** 7)) * Math.sin(radians(60 * Math.exp(-(((hBar - 275) / 25) ** 2))));
  const dl = (L2 - L1) / sl, dc = (c2 - c1) / sc;
  const dH = 2 * Math.sqrt(c1 * c2) * Math.sin(radians(dh / 2)) / sh;
  return Math.sqrt(Math.max(0, dl * dl + dc * dc + dH * dH + rt * dc * dH));
}

module.exports = { ADOBE_RGB, SRGB, D50, rgbToLab, labToRgb, adobeRgbToDisplay, deltaE00 };
