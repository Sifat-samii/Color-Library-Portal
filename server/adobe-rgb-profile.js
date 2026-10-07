const zlib = require("zlib");
const {
  ADOBE_RGB_NAME,
  ADOBE_RGB_TO_XYZ,
  ADOBE_RGB_WHITE,
  GAMMA
} = require("../public/adobe-rgb");

// ICC PCS white (ICC.1 D50). Colorant tags are Bradford-adapted from D65 into this PCS.
const D50 = [0xF6D6 / 65536, 1, 0xD32D / 65536];
const BRADFORD = [
  [0.8951, 0.2664, -0.1614],
  [-0.7502, 1.7135, 0.0367],
  [0.0389, -0.0685, 1.0296]
];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

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

function multiply3(left, right) {
  return [0, 1, 2].map(row => [0, 1, 2].map(column => (
    left[row][0] * right[0][column] + left[row][1] * right[1][column] + left[row][2] * right[2][column]
  )));
}

function adaptationMatrix(sourceWhite, destWhite) {
  const source = multiplyMatrixVector(BRADFORD, sourceWhite);
  const dest = multiplyMatrixVector(BRADFORD, destWhite);
  const scale = [
    [dest[0] / source[0], 0, 0],
    [0, dest[1] / source[1], 0],
    [0, 0, dest[2] / source[2]]
  ];
  return multiply3(multiply3(invert3(BRADFORD), scale), BRADFORD);
}

function writeS15(buffer, offset, value) {
  buffer.writeInt32BE(Math.round(value * 65536), offset);
}

function xyzTag(xyz) {
  const data = Buffer.alloc(20);
  data.write("XYZ ", 0, "ascii");
  writeS15(data, 8, xyz[0]);
  writeS15(data, 12, xyz[1]);
  writeS15(data, 16, xyz[2]);
  return data;
}

function gammaCurveTag() {
  const data = Buffer.alloc(14);
  data.write("curv", 0, "ascii");
  data.writeUInt32BE(1, 8);
  data.writeUInt16BE(Math.round(GAMMA * 256), 12);
  return data;
}

function textTag(value) {
  const ascii = Buffer.from(`${value}\0`, "ascii");
  const data = Buffer.alloc(8 + ascii.length);
  data.write("text", 0, "ascii");
  ascii.copy(data, 8);
  return data;
}

function descriptionTag(text) {
  const ascii = Buffer.from(`${text}\0`, "ascii");
  const unicode = Buffer.alloc((text.length + 1) * 2);
  for (let index = 0; index < text.length; index += 1) unicode.writeUInt16BE(text.charCodeAt(index), index * 2);
  const payload = Buffer.concat([
    uint32(ascii.length),
    ascii,
    uint32(0),
    uint32(text.length + 1),
    unicode,
    Buffer.alloc(70)
  ]);
  const data = Buffer.alloc(8 + payload.length);
  data.write("desc", 0, "ascii");
  payload.copy(data, 8);
  return data;
}

function sf32Tag(matrix) {
  const data = Buffer.alloc(8 + 36);
  data.write("sf32", 0, "ascii");
  matrix.flat().forEach((value, index) => writeS15(data, 8 + index * 4, value));
  return data;
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

function pad4(buffer) {
  const extra = (4 - (buffer.length % 4)) % 4;
  return extra ? Buffer.concat([buffer, Buffer.alloc(extra)]) : buffer;
}

function adaptedColorants() {
  const chad = adaptationMatrix(ADOBE_RGB_WHITE, D50);
  const columns = [0, 1, 2].map(index => multiplyMatrixVector(chad, [
    ADOBE_RGB_TO_XYZ[0][index],
    ADOBE_RGB_TO_XYZ[1][index],
    ADOBE_RGB_TO_XYZ[2][index]
  ]));
  const white = multiplyMatrixVector(chad, ADOBE_RGB_WHITE);
  return { chad, columns, white };
}

function buildAdobeRgbIcc() {
  const { chad, columns, white } = adaptedColorants();
  if (Math.abs(white[1] - 1) > 1e-4 || Math.abs(white[0] - D50[0]) > 1e-3 || Math.abs(white[2] - D50[2]) > 1e-3) {
    throw new Error("Adobe RGB (1998) profile adaptation did not land on D50");
  }
  const tags = [
    ["desc", descriptionTag(ADOBE_RGB_NAME)],
    ["cprt", textTag("Pixofix. Adobe RGB (1998) encoding from the published specification.")],
    ["wtpt", xyzTag(D50)],
    ["chad", sf32Tag(chad)],
    ["rXYZ", xyzTag(columns[0])],
    ["gXYZ", xyzTag(columns[1])],
    ["bXYZ", xyzTag(columns[2])],
    ["rTRC", gammaCurveTag()],
    ["gTRC", gammaCurveTag()],
    ["bTRC", gammaCurveTag()]
  ];
  const tableBytes = 4 + tags.length * 12;
  let offset = 128 + tableBytes;
  const placed = tags.map(([signature, data]) => {
    const start = offset;
    const padded = pad4(data);
    offset += padded.length;
    return { signature, data, start, padded };
  });
  const profile = Buffer.alloc(offset);
  profile.writeUInt32BE(profile.length, 0);
  profile.writeUInt32BE(0x02100000, 8);
  profile.write("mntr", 12, 4, "ascii");
  profile.write("RGB ", 16, 4, "ascii");
  profile.write("XYZ ", 20, 4, "ascii");
  [1998, 1, 1, 0, 0, 0].forEach((value, index) => profile.writeUInt16BE(value, 24 + index * 2));
  profile.write("acsp", 36, 4, "ascii");
  profile.writeUInt32BE(1, 64);
  profile.writeUInt32BE(0x0000F6D6, 68);
  profile.writeUInt32BE(0x00010000, 72);
  profile.writeUInt32BE(0x0000D32D, 76);
  profile.write("Pixo", 80, 4, "ascii");
  profile.writeUInt32BE(tags.length, 128);
  placed.forEach((tag, index) => {
    const entry = 132 + index * 12;
    profile.write(tag.signature, entry, 4, "ascii");
    profile.writeUInt32BE(tag.start, entry + 4);
    profile.writeUInt32BE(tag.data.length, entry + 8);
    tag.padded.copy(profile, tag.start);
  });
  return profile;
}

let cachedProfile = null;

function adobeRgbIcc() {
  if (!cachedProfile) cachedProfile = buildAdobeRgbIcc();
  return cachedProfile;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const signature = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([signature, data])));
  return Buffer.concat([length, signature, data, crc]);
}

function embedIccInPng(png, icc) {
  const signature = "89504e470d0a1a0a";
  if (!Buffer.isBuffer(png) || png.length < 33 || png.subarray(0, 8).toString("hex") !== signature) {
    throw new Error("Swatch image is not a PNG");
  }
  const ihdrLength = png.readUInt32BE(8);
  const ihdrEnd = 8 + 12 + ihdrLength;
  const keyword = Buffer.from("Adobe RGB (1998)\0", "latin1");
  const payload = Buffer.concat([keyword, Buffer.from([0]), zlib.deflateSync(icc)]);
  return Buffer.concat([png.subarray(0, ihdrEnd), pngChunk("iCCP", payload), png.subarray(ihdrEnd)]);
}

module.exports = { adobeRgbIcc, embedIccInPng, buildAdobeRgbIcc };
