const sharp = require("sharp");

const ADOBE_RGB_DESCRIPTION = "adobe rgb (1998)";

function readU32(buffer, offset) {
  if (!buffer || offset < 0 || offset + 4 > buffer.length) return null;
  return buffer.readUInt32BE(offset);
}

function readAscii(buffer, offset, length) {
  if (length < 0 || offset < 0 || offset + length > buffer.length) return "";
  return buffer.slice(offset, offset + length).toString("ascii").replace(/\0.*$/s, "").trim();
}

function readDescription(buffer, offset, size) {
  const type = buffer.slice(offset, offset + 4).toString("ascii");
  if (type === "desc") {
    const length = readU32(buffer, offset + 8);
    if (length == null) return "";
    return readAscii(buffer, offset + 12, length);
  }
  if (type !== "mluc") return "";
  const records = readU32(buffer, offset + 8);
  const recordSize = readU32(buffer, offset + 12);
  if (!records || !recordSize || recordSize < 12) return "";
  const recordOffset = offset + 16;
  const stringLength = readU32(buffer, recordOffset + 4);
  const stringOffset = readU32(buffer, recordOffset + 8);
  if (stringLength == null || stringOffset == null || stringLength < 2) return "";
  const start = offset + stringOffset;
  const byteLength = stringLength - (stringLength % 2);
  if (start < offset || start + byteLength > offset + size || start + byteLength > buffer.length) return "";
  const characters = Buffer.from(buffer.slice(start, start + byteLength));
  characters.swap16();
  return characters.toString("utf16le").replace(/\0/g, "").trim();
}

function parseIcc(iccBuffer) {
  const buffer = Buffer.isBuffer(iccBuffer) ? iccBuffer : Buffer.from(iccBuffer || []);
  if (buffer.length < 132 || buffer.slice(36, 40).toString("ascii") !== "acsp") return null;
  const colorSpace = buffer.slice(16, 20).toString("ascii").trim();
  const tagCount = readU32(buffer, 128);
  if (tagCount == null) return null;
  let description = "";
  for (let index = 0; index < tagCount; index += 1) {
    const entry = 132 + index * 12;
    const signature = buffer.slice(entry, entry + 4).toString("ascii");
    const offset = readU32(buffer, entry + 4);
    const size = readU32(buffer, entry + 8);
    if (signature !== "desc" || offset == null || size == null || offset + size > buffer.length) continue;
    description = readDescription(buffer, offset, size);
    break;
  }
  return { colorSpace, description };
}

function describeProfile(iccBuffer) {
  if (!iccBuffer || !iccBuffer.length) {
    return {
      accepted: false,
      label: "Untagged",
      reason: "The delivery must be an Adobe RGB (1998) image. This file has no embedded color profile."
    };
  }
  const parsed = parseIcc(iccBuffer);
  if (!parsed) {
    return {
      accepted: false,
      label: "Unknown",
      reason: "The delivery must be an Adobe RGB (1998) image. This file has no readable color profile."
    };
  }
  const label = parsed.description || parsed.colorSpace || "Unknown";
  if (parsed.colorSpace !== "RGB") {
    return {
      accepted: false,
      label,
      reason: "The delivery must be an Adobe RGB (1998) image. This file is not an RGB profile."
    };
  }
  if (parsed.description.toLowerCase() !== ADOBE_RGB_DESCRIPTION) {
    return {
      accepted: false,
      label,
      reason: `The delivery must be Adobe RGB (1998). This file is embedded as ${label}.`
    };
  }
  return { accepted: true, label: parsed.description, reason: "" };
}

async function inspectImageFile(filePath) {
  try {
    const metadata = await sharp(filePath, { failOn: "none" }).metadata();
    return describeProfile(metadata.icc);
  } catch (_error) {
    return {
      accepted: false,
      label: "Unknown",
      reason: "The file could not be read as an image."
    };
  }
}

module.exports = { describeProfile, inspectImageFile };
