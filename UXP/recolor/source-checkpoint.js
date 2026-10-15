const { digestObject } = require("./file-identity");
const { createSourcePreparation } = require("./source-preparation");
const { ADOBE_RGB } = require("./color");

function validatePayload(payload) {
  if (!payload || typeof payload.id !== "string" || payload.revision !== 1 || !Number.isFinite(Date.parse(payload.createdAt))) throw new Error("Unsupported source checkpoint revision");
  const artifact = payload.artifact, frozen = payload.frozen;
  if (!artifact || !/^source-[a-z0-9-]+\.psb$/.test(artifact.name) || !/^[a-f0-9]{64}$/.test(artifact.sha256)
    || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1) throw new Error("Invalid local checkpoint artifact identity");
  if (!frozen || frozen.profile !== ADOBE_RGB || !Number.isInteger(frozen.width) || !Number.isInteger(frozen.height)
    || frozen.width < 1 || frozen.height < 1 || !Array.isArray(frozen.layers) || !frozen.layers.length) throw new Error("Invalid normalized source checkpoint");
  const preparation = payload.sourcePreparation;
  if (!preparation || preparation.type !== "SOURCE_PREPARATION" || preparation.schemaVersion !== 1 || !preparation.review || preparation.review.status !== "ACCEPTED") throw new Error("Only reviewed source preparations can be checkpointed");
  createSourcePreparation(preparation.source, preparation);
}

function sealCheckpoint(payload) {
  validatePayload(payload);
  const copy = JSON.parse(JSON.stringify(payload));
  return { schemaVersion: 1, type: "FROZEN_SOURCE_CHECKPOINT", payload: copy, payloadSha256: digestObject(copy), productionQualified: false };
}

function verifyCheckpoint(checkpoint) {
  if (!checkpoint || checkpoint.schemaVersion !== 1 || checkpoint.type !== "FROZEN_SOURCE_CHECKPOINT"
    || digestObject(checkpoint.payload) !== checkpoint.payloadSha256) throw new Error("Source checkpoint is incomplete or its manifest checksum changed");
  validatePayload(checkpoint.payload);
  return JSON.parse(JSON.stringify(checkpoint.payload));
}

module.exports = { sealCheckpoint, verifyCheckpoint };
