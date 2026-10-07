const sharp = require("sharp");
const { normalizeHex } = require("./hex-code");
const { channelsFromHex } = require("../public/adobe-rgb");
const { adobeRgbIcc, embedIccInPng } = require("./adobe-rgb-profile");

const SWATCH_SIZE = 640;

async function swatchPng(hexCode) {
  const normalized = normalizeHex(hexCode);
  const channels = channelsFromHex(normalized);
  if (!normalized || !channels) {
    const error = new Error("Enter a valid hex code");
    error.status = 400;
    throw error;
  }
  const [red, green, blue] = channels;
  const png = await sharp({
    create: {
      width: SWATCH_SIZE,
      height: SWATCH_SIZE,
      channels: 3,
      background: { r: red, g: green, b: blue }
    }
  }).png({ compressionLevel: 9 }).toBuffer();
  return embedIccInPng(png, adobeRgbIcc());
}

module.exports = { swatchPng, SWATCH_SIZE };
