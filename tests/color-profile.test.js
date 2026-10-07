const assert = require("assert");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const sharp = require("sharp");
const { describeProfile, inspectImageFile } = require("../server/color-profile");
const { swatchPng } = require("../server/adobe-rgb-swatch");
const { adobeRgbIcc } = require("../server/adobe-rgb-profile");
const { uploadDelivery, requestChanges, approveRequest, commentPlacement } = require("../server/color-request-flow");

function buildIcc({ colorSpace = "RGB ", description = "Adobe RGB (1998)" } = {}) {
  const ascii = Buffer.from(`${description}\0`, "ascii");
  const desc = Buffer.alloc(12 + ascii.length);
  desc.write("desc", 0, "ascii");
  desc.writeUInt32BE(ascii.length, 8);
  ascii.copy(desc, 12);
  const dataOffset = 128 + 4 + 12;
  const profile = Buffer.alloc(dataOffset + desc.length);
  profile.writeUInt32BE(profile.length, 0);
  profile.write(colorSpace, 16, 4, "ascii");
  profile.write("acsp", 36, 4, "ascii");
  profile.writeUInt32BE(1, 128);
  profile.write("desc", 132, 4, "ascii");
  profile.writeUInt32BE(dataOffset, 136);
  profile.writeUInt32BE(desc.length, 140);
  desc.copy(profile, dataOffset);
  return profile;
}

function stripIccp(png) {
  const ihdrLength = png.readUInt32BE(8);
  let offset = 8 + 12 + ihdrLength;
  const chunks = [png.subarray(0, offset)];
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const end = offset + 12 + length;
    if (type !== "iCCP") chunks.push(png.subarray(offset, end));
    offset = end;
    if (type === "IEND") break;
  }
  return Buffer.concat(chunks);
}

async function writeJpeg(filePath, profileName) {
  let image = sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 20, g: 40, b: 80 } }
  });
  if (profileName) image = image.withIccProfile(profileName);
  await image.jpeg().toFile(filePath);
}

async function main() {
  const adobe = describeProfile(buildIcc());
  assert.equal(adobe.accepted, true);
  assert.equal(adobe.label, "Adobe RGB (1998)");

  const srgb = describeProfile(buildIcc({ description: "sRGB IEC61966-2.1" }));
  assert.equal(srgb.accepted, false);

  const missing = describeProfile(null);
  assert.equal(missing.accepted, false);
  assert.equal(missing.label, "Untagged");

  const cmyk = describeProfile(buildIcc({ colorSpace: "CMYK", description: "Adobe RGB (1998)" }));
  assert.equal(cmyk.accepted, false);

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "color-profile-"));
  const untaggedPath = path.join(directory, "untagged.jpg");
  const srgbPath = path.join(directory, "srgb.jpg");
  await writeJpeg(untaggedPath);
  await writeJpeg(srgbPath, "srgb");
  assert.equal((await inspectImageFile(untaggedPath)).accepted, false);
  assert.equal((await inspectImageFile(srgbPath)).accepted, false);

  assert.equal(uploadDelivery({ status: "AWAITING_DELIVERY" }).status, "IN_PROGRESS");
  assert.equal(uploadDelivery({ status: "IN_PROGRESS" }, [], "FULL:").status, "IN_PROGRESS");
  assert.equal(uploadDelivery({ status: "CHANGES_REQUESTED" }, [], "FULL:").status, "IN_PROGRESS");
  assert.throws(() => uploadDelivery({ status: "IN_PROGRESS" }, [{ id: "full", status: "IN_REVIEW", reference_kind: "FULL", reference_label: "" }], "FULL:"), /waiting for review/);
  assert.throws(() => uploadDelivery({ status: "APPROVED" }), /approved/);

  const history = [{ id: "v1", status: "NEEDS_CHANGES" }, { id: "v2", status: "IN_REVIEW" }];
  const changes = requestChanges({ status: "IN_PROGRESS" }, history);
  assert.equal(changes.status, "CHANGES_REQUESTED");
  assert.equal(changes.deliveries.length, 2);
  assert.equal(changes.deliveries[0].status, "NEEDS_CHANGES");
  assert.equal(changes.deliveries[1].id, "v2");
  assert.equal(changes.deliveries[1].status, "NEEDS_CHANGES");

  assert.throws(() => approveRequest({ status: "AWAITING_DELIVERY" }, history), /in progress/i);
  const approved = approveRequest({ status: "IN_PROGRESS" }, [{ id: "v2", status: "IN_REVIEW" }]);
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.deliveryId, "v2");
  const categorized = approveRequest({ status: "IN_PROGRESS" }, [
    { id: "full", status: "IN_REVIEW", reference_kind: "FULL", reference_label: "" },
    { id: "crop", status: "IN_REVIEW", reference_kind: "QUICK", reference_label: "" },
    { id: "old", status: "NEEDS_CHANGES", reference_kind: "FULL", reference_label: "" }
  ]);
  assert.deepEqual(categorized.deliveryIds, ["full", "crop"]);
  assert.equal(categorized.deliveries.find(item => item.id === "old").status, "NEEDS_CHANGES");

  const embedded = describeProfile(adobeRgbIcc());
  assert.equal(embedded.accepted, true);
  assert.equal(embedded.label, "Adobe RGB (1998)");

  const persimmon = await swatchPng("#E76223");
  const persimmonProfile = describeProfile((await sharp(persimmon).metadata()).icc);
  assert.equal(persimmonProfile.accepted, true);
  assert.equal(persimmonProfile.label, "Adobe RGB (1998)");
  const persimmonRaw = await sharp(stripIccp(persimmon)).raw().toBuffer();
  assert.deepEqual([persimmonRaw[0], persimmonRaw[1], persimmonRaw[2]], [0xE7, 98, 35]);
  const managedPersimmon = await sharp(persimmon).raw().toBuffer();
  assert.deepEqual([managedPersimmon[0], managedPersimmon[1], managedPersimmon[2]], [255, 98, 22]);

  const greenPng = await swatchPng("#00FF00");
  const greenRaw = await sharp(stripIccp(greenPng)).raw().toBuffer();
  assert.deepEqual([greenRaw[0], greenRaw[1], greenRaw[2]], [0, 255, 0]);

  await fs.rm(directory, { recursive: true, force: true });
  assert.deepStrictEqual(commentPlacement({}), { pinX: null, pinY: null });
  assert.deepStrictEqual(commentPlacement({ pinX: 10.126, pinY: 0 }), { pinX: 10.13, pinY: 0 });
  assert.deepStrictEqual(commentPlacement({ pinX: 100, pinY: 100 }), { pinX: 100, pinY: 100 });
  assert.throws(() => commentPlacement({ pinX: 12 }), /point on the image/);
  assert.throws(() => commentPlacement({ pinX: -1, pinY: 4 }), /point on the image/);
  assert.throws(() => commentPlacement({ pinX: 101, pinY: 4 }), /point on the image/);
  console.log("Color profile and request transition tests passed.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
