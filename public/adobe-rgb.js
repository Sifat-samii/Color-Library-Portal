// Adobe RGB (1998). Hex codes are 8-bit code values in this encoding.
// https://registry.color.org/rgb-registry/adobergb
// Primaries and D65 white point: Adobe RGB (1998) Color Image Encoding.
// Transfer gamma is 563/256 = 2.19921875. Lab is CIE L*a*b* with that D65 white.
// CIEDE2000 follows the Sharma, Wu, and Dalal reference pairs.

const ADOBE_RGB_NAME = "Adobe RGB (1998)";
const ADOBE_RGB_REFERENCE = "https://registry.color.org/rgb-registry/adobergb";
const GAMMA = 563 / 256;

const PRIMARIES = {
  r: [0.64, 0.33],
  g: [0.21, 0.71],
  b: [0.15, 0.06]
};
const WHITE_CHROMATICITY = [0.3127, 0.329];

function xyzFromChromaticity(x, y) {
  return [x / y, 1, (1 - x - y) / y];
}

function multiplyMatrixVector(matrix, vector) {
  return [
    matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
    matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
    matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2]
  ];
}

function invert3(matrix) {
  const [a, b, c] = matrix[0];
  const [d, e, f] = matrix[1];
  const [g, h, i] = matrix[2];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const inv = 1 / det;
  return [
    [(e * i - f * h) * inv, (c * h - b * i) * inv, (b * f - c * e) * inv],
    [(f * g - d * i) * inv, (a * i - c * g) * inv, (c * d - a * f) * inv],
    [(d * h - e * g) * inv, (b * g - a * h) * inv, (a * e - b * d) * inv]
  ];
}

function adobeRgbMatrix() {
  const red = xyzFromChromaticity(PRIMARIES.r[0], PRIMARIES.r[1]);
  const green = xyzFromChromaticity(PRIMARIES.g[0], PRIMARIES.g[1]);
  const blue = xyzFromChromaticity(PRIMARIES.b[0], PRIMARIES.b[1]);
  const white = xyzFromChromaticity(WHITE_CHROMATICITY[0], WHITE_CHROMATICITY[1]);
  const unscaled = [
    [red[0], green[0], blue[0]],
    [red[1], green[1], blue[1]],
    [red[2], green[2], blue[2]]
  ];
  const scale = multiplyMatrixVector(invert3(unscaled), white);
  return [
    [red[0] * scale[0], green[0] * scale[1], blue[0] * scale[2]],
    [red[1] * scale[0], green[1] * scale[1], blue[1] * scale[2]],
    [red[2] * scale[0], green[2] * scale[1], blue[2] * scale[2]]
  ];
}

const ADOBE_RGB_TO_XYZ = adobeRgbMatrix();
const ADOBE_RGB_WHITE = [
  ADOBE_RGB_TO_XYZ[0][0] + ADOBE_RGB_TO_XYZ[0][1] + ADOBE_RGB_TO_XYZ[0][2],
  ADOBE_RGB_TO_XYZ[1][0] + ADOBE_RGB_TO_XYZ[1][1] + ADOBE_RGB_TO_XYZ[1][2],
  ADOBE_RGB_TO_XYZ[2][0] + ADOBE_RGB_TO_XYZ[2][1] + ADOBE_RGB_TO_XYZ[2][2]
];

function channelsFromHex(value) {
  const match = String(value || "").trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) hex = hex.split("").map(char => char + char).join("");
  return [0, 2, 4].map(index => Number.parseInt(hex.slice(index, index + 2), 16));
}

function linearize(channel) {
  const encoded = channel / 255;
  if (encoded <= 0) return 0;
  return encoded ** GAMMA;
}

function xyzFromChannels(channels) {
  return multiplyMatrixVector(ADOBE_RGB_TO_XYZ, channels.map(linearize));
}

function labFromXyz(xyz) {
  const [x, y, z] = xyz;
  const f = t => (t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);
  const fx = f(x / ADOBE_RGB_WHITE[0]);
  const fy = f(y / ADOBE_RGB_WHITE[1]);
  const fz = f(z / ADOBE_RGB_WHITE[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labFromHex(value) {
  const channels = channelsFromHex(value);
  if (!channels) return null;
  return labFromXyz(xyzFromChannels(channels));
}

function roundInt(value) {
  const rounded = Math.round(value);
  return Object.is(rounded, -0) ? 0 : rounded;
}

function roundHue(degrees) {
  const rounded = roundInt(degrees);
  return rounded === 360 ? 0 : rounded;
}

function roundPercent(ratio) {
  return Math.min(100, Math.max(0, roundInt(ratio * 100)));
}

function formatNumbers(values) {
  return values.map(roundInt).join(", ");
}

function rgbHue(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  let hue;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return hue;
}

function hsbFromChannels(channels) {
  const [r, g, b] = channels;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return [
    roundHue(rgbHue(r, g, b)),
    max === 0 ? 0 : roundPercent((max - min) / max),
    roundPercent(max / 255)
  ];
}

function hslFromChannels(channels) {
  const [r, g, b] = channels;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2 / 255;
  const saturation = max === min ? 0 : ((max - min) / 255) / (1 - Math.abs(2 * lightness - 1));
  return [roundHue(rgbHue(r, g, b)), roundPercent(saturation), roundPercent(lightness)];
}

function hwbFromChannels(channels) {
  const [r, g, b] = channels;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return [roundHue(rgbHue(r, g, b)), roundPercent(min / 255), roundPercent((255 - max) / 255)];
}

function cmykFromChannels(channels) {
  const [r, g, b] = channels.map(channel => channel / 255);
  const black = 1 - Math.max(r, g, b);
  if (black >= 1) return [0, 0, 0, 100];
  const scale = 1 - black;
  return [
    roundPercent((1 - r - black) / scale),
    roundPercent((1 - g - black) / scale),
    roundPercent((1 - b - black) / scale),
    roundPercent(black)
  ];
}

function lchFromLab(lab) {
  const chroma = Math.hypot(lab[1], lab[2]);
  const roundedChroma = roundInt(chroma);
  let hue = 0;
  if (roundedChroma !== 0) {
    let degrees = Math.atan2(lab[2], lab[1]) * 180 / Math.PI;
    if (degrees < 0) degrees += 360;
    hue = roundHue(degrees);
  }
  return [roundInt(lab[0]), roundedChroma, hue];
}

function luvFromXyz(xyz, lightness) {
  const [x, y, z] = xyz;
  const [Xn, Yn, Zn] = ADOBE_RGB_WHITE;
  const denom = x + 15 * y + 3 * z;
  if (!denom || lightness === 0) return [roundInt(lightness), 0, 0];
  const up = (4 * x) / denom;
  const vp = (9 * y) / denom;
  const denomN = Xn + 15 * Yn + 3 * Zn;
  const u = 13 * lightness * (up - (4 * Xn) / denomN);
  const v = 13 * lightness * (vp - (9 * Yn) / denomN);
  return [roundInt(lightness), roundInt(u), roundInt(v)];
}

function colorValuesFromHex(value) {
  const channels = channelsFromHex(value);
  if (!channels) return null;
  const xyz = xyzFromChannels(channels);
  const lab = labFromXyz(xyz);
  return {
    rgb: formatNumbers(channels),
    cmyk: formatNumbers(cmykFromChannels(channels)),
    hsb: formatNumbers(hsbFromChannels(channels)),
    hsl: formatNumbers(hslFromChannels(channels)),
    lab: formatNumbers(lab),
    xyz: formatNumbers(xyz.map(channel => channel * 100)),
    lch: formatNumbers(lchFromLab(lab)),
    luv: formatNumbers(luvFromXyz(xyz, lab[0])),
    hwb: formatNumbers(hwbFromChannels(channels))
  };
}

function hueDegrees(a, b) {
  if (a === 0 && b === 0) return 0;
  const hue = Math.atan2(b, a) * 180 / Math.PI;
  return hue >= 0 ? hue : hue + 360;
}

function deltaE00(lab1, lab2) {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cBar = (c1 + c2) / 2;
  const cBar7 = cBar ** 7;
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + 25 ** 7)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);
  const h1p = hueDegrees(a1p, b1);
  const h2p = hueDegrees(a2p, b2);

  let dh = h2p - h1p;
  if (c1p * c2p === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;

  const dL = L2 - L1;
  const dC = c2p - c1p;
  const dH = 2 * Math.sqrt(c1p * c2p) * Math.sin(dh * Math.PI / 360);

  const lBar = (L1 + L2) / 2;
  const cBarP = (c1p + c2p) / 2;
  let hBar;
  if (c1p * c2p === 0) hBar = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hBar = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) hBar = (h1p + h2p + 360) / 2;
  else hBar = (h1p + h2p - 360) / 2;

  const t = 1
    - 0.17 * Math.cos((hBar - 30) * Math.PI / 180)
    + 0.24 * Math.cos(2 * hBar * Math.PI / 180)
    + 0.32 * Math.cos((3 * hBar + 6) * Math.PI / 180)
    - 0.20 * Math.cos((4 * hBar - 63) * Math.PI / 180);
  const dTheta = 30 * Math.exp(-(((hBar - 275) / 25) ** 2));
  const cBarP7 = cBarP ** 7;
  const rC = 2 * Math.sqrt(cBarP7 / (cBarP7 + 25 ** 7));
  const sL = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sC = 1 + 0.045 * cBarP;
  const sH = 1 + 0.015 * cBarP * t;
  const rT = -Math.sin(2 * dTheta * Math.PI / 180) * rC;
  const lTerm = dL / sL;
  const cTerm = dC / sC;
  const hTerm = dH / sH;
  return Math.sqrt(lTerm ** 2 + cTerm ** 2 + hTerm ** 2 + rT * cTerm * hTerm);
}

function formatUnit(channel) {
  if (channel <= 0) return "0";
  if (channel >= 255) return "1";
  return String(channel / 255);
}

function adobeRgbCss(value) {
  const channels = channelsFromHex(value);
  if (!channels) return "";
  return `color(a98-rgb ${channels.map(formatUnit).join(" ")})`;
}

const adobeRgbApi = {
  ADOBE_RGB_NAME,
  ADOBE_RGB_REFERENCE,
  GAMMA,
  ADOBE_RGB_TO_XYZ,
  ADOBE_RGB_WHITE,
  channelsFromHex,
  labFromHex,
  colorValuesFromHex,
  deltaE00,
  adobeRgbCss
};

Object.assign(globalThis, adobeRgbApi);

if (typeof module !== "undefined" && module.exports) {
  module.exports = adobeRgbApi;
}
