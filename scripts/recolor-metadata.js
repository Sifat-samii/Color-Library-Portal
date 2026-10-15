const fs = require("node:fs/promises");
const sharp = require("sharp");
const { describeProfile } = require("../server/color-profile");

// Header/resources only; Photoshop must establish native document editability.
async function inspectPsd(filename) {
  const handle = await fs.open(filename, "r");
  try {
    const stat = await handle.stat();
    async function read(position, length) {
      if (!Number.isSafeInteger(position) || position < 0 || length < 0 || position + length > stat.size || length > 32 * 1024 * 1024) throw new Error("Invalid or oversized PSD metadata section");
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      if (bytesRead !== length) throw new Error("Truncated PSD metadata");
      return buffer;
    }
    const header = await read(0, 26), version = header.readUInt16BE(4);
    if (header.toString("ascii", 0, 4) !== "8BPS" || ![1, 2].includes(version)) throw new Error("Unrecognized PSD/PSB header");
    const modeLength = (await read(26, 4)).readUInt32BE(0), resourcesPosition = 30 + modeLength;
    const resourceLength = (await read(resourcesPosition, 4)).readUInt32BE(0);
    const resources = await read(resourcesPosition + 4, resourceLength);
    let icc, cursor = 0;
    const namedPaths = [];
    while (cursor < resources.length) {
      if (cursor + 12 > resources.length || resources.toString("ascii", cursor, cursor + 4) !== "8BIM") throw new Error("Invalid PSD image resource");
      const resourceId = resources.readUInt16BE(cursor + 4), nameLength = resources[cursor + 6];
      const nameBytes = Math.ceil((nameLength + 1) / 2) * 2, lengthOffset = cursor + 6 + nameBytes;
      if (lengthOffset + 4 > resources.length) throw new Error("Truncated PSD resource name");
      const length = resources.readUInt32BE(lengthOffset), dataStart = lengthOffset + 4;
      if (dataStart + length > resources.length) throw new Error("Truncated PSD resource payload");
      if (resourceId === 1039) icc = resources.subarray(dataStart, dataStart + length);
      if (resourceId >= 2000 && resourceId <= 2998) namedPaths.push(resources.toString("latin1", cursor + 7, cursor + 7 + nameLength));
      cursor = dataStart + length + length % 2;
    }
    return { format: version === 2 ? "psb" : "psd", width: header.readUInt32BE(18), height: header.readUInt32BE(14),
      depth: header.readUInt16BE(22), channels: header.readUInt16BE(12), mode: ({ 1: "Grayscale", 3: "RGB", 4: "CMYK", 9: "Lab" })[header.readUInt16BE(24)] || "Other",
      profile: describeProfile(icc).label, namedPaths, bytes: stat.size, modifiedAt: stat.mtime.toISOString(),
      pixelDecodeVerified: false, layersVerified: false };
  } finally { await handle.close(); }
}

async function inspectAsset(filename) {
  if (/\.ps[db]$/i.test(filename)) return inspectPsd(filename);
  const [metadata, stat] = await Promise.all([sharp(filename).metadata(), fs.stat(filename)]);
  return { format: metadata.format, width: metadata.width, height: metadata.height, depth: metadata.depth,
    channels: metadata.channels, mode: metadata.space, profile: describeProfile(metadata.icc).label,
    orientation: metadata.orientation || 1, bytes: stat.size, modifiedAt: stat.mtime.toISOString(),
    pixelDecodeVerified: false, layersVerified: false };
}

module.exports = { inspectAsset };
