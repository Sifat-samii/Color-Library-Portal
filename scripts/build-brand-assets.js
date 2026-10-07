const fs = require("fs/promises");
const path = require("path");
const sharp = require("sharp");

const source = path.resolve(__dirname, "../public/brand/pixofix-logo.png");

async function withTransparentBlack(inputPath) {
  const { data, info } = await sharp(inputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let index = 0; index < data.length; index += 4) {
    if (data[index] < 48 && data[index + 1] < 48 && data[index + 2] < 48) data[index + 3] = 0;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png();
}

async function invertOpaque(image) {
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] > 0) {
      data[index] = 12;
      data[index + 1] = 12;
      data[index + 2] = 12;
    }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png();
}

async function writeSquareMark(whiteLogo, crop, outputPath, size, { invert = false, background = { r: 0, g: 0, b: 0, alpha: 1 } } = {}) {
  const metadata = await whiteLogo.metadata();
  const padded = 2;
  const left = Math.max(0, crop.left - padded);
  const top = Math.max(0, crop.top - padded);
  const extract = {
    left,
    top,
    width: Math.min(metadata.width - left, crop.width + padded * 2),
    height: Math.min(metadata.height - top, crop.height + padded * 2)
  };
  let mark = whiteLogo.clone().extract(extract);
  if (invert) mark = await invertOpaque(mark);
  const inner = Math.round(size * 0.72);
  await sharp({
    create: { width: size, height: size, channels: 4, background }
  })
    .composite([{ input: await mark.resize({ width: inner, height: inner, fit: "inside" }).png().toBuffer(), gravity: "center" }])
    .png()
    .toFile(outputPath);
}

async function main() {
  const publicBrand = path.resolve(__dirname, "../public/brand");
  const uxpIcons = path.resolve(__dirname, "../UXP/icons");
  await fs.mkdir(publicBrand, { recursive: true });
  await fs.mkdir(uxpIcons, { recursive: true });

  const whiteLogo = await withTransparentBlack(source);
  const whiteBuffer = await whiteLogo.png().toBuffer();
  await fs.writeFile(path.join(publicBrand, "pixofix-logo-white.png"), whiteBuffer);
  await fs.writeFile(path.join(uxpIcons, "pixofix-logo-white.png"), whiteBuffer);

  const blackLogo = await invertOpaque(sharp(whiteBuffer));
  await blackLogo.png().toFile(path.join(publicBrand, "pixofix-logo-black.png"));

  const crop = { left: 109, top: 18, width: 45, height: 45 };
  await writeSquareMark(sharp(whiteBuffer), crop, path.join(publicBrand, "pixofix-mark.png"), 256);
  await writeSquareMark(sharp(whiteBuffer), crop, path.join(publicBrand, "favicon.png"), 32);
  await writeSquareMark(sharp(whiteBuffer), crop, path.join(publicBrand, "apple-touch-icon.png"), 180);

  await writeSquareMark(sharp(whiteBuffer), crop, path.join(uxpIcons, "icon.png"), 24);
  await writeSquareMark(sharp(whiteBuffer), crop, path.join(uxpIcons, "icon@2x.png"), 48);
  await writeSquareMark(sharp(whiteBuffer), crop, path.join(uxpIcons, "icon_N.png"), 23, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
  await writeSquareMark(sharp(whiteBuffer), crop, path.join(uxpIcons, "icon_N@2x.png"), 46, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
  await writeSquareMark(sharp(whiteBuffer), crop, path.join(uxpIcons, "icon_D.png"), 23, { invert: true, background: { r: 0, g: 0, b: 0, alpha: 0 } });
  await writeSquareMark(sharp(whiteBuffer), crop, path.join(uxpIcons, "icon_D@2x.png"), 46, { invert: true, background: { r: 0, g: 0, b: 0, alpha: 0 } });

  console.log("Pixofix brand assets written.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
