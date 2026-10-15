const { ADOBE_RGB, SRGB, rgbToLab } = require("./color");
const { createCandidates, adjustRecipe } = require("./recipes");
const { fit } = require("./fitting");
const { measureMaterial, compareFrames, evaluateRender } = require("./quality");
const { createPhotoshopAdapter, executeChecked } = require("./photoshop-adapter");
const { createSourcePreparation } = require("./source-preparation");
const { fingerprintFile } = require("./file-identity");

async function addOwnedDocument(photoshop, settings, owned) {
  const before = new Set(Array.from(photoshop.app.documents).map(doc => doc.id));
  await photoshop.app.documents.add(settings);
  const created = Array.from(photoshop.app.documents).filter(doc => !before.has(doc.id));
  if (created.length !== 1 || created[0].name !== settings.name) throw new Error("Fixture creation returned an ambiguous identity; pre-existing documents were preserved");
  const doc = created[0]; owned.add(doc.id);
  await executeChecked(photoshop, [{ _obj: "select", _target: [{ _ref: "document", _id: doc.id }] }]);
  if (doc.width !== settings.width || doc.height !== settings.height || doc.layers[0].kind !== photoshop.constants.LayerKind.NORMAL) throw new Error("New fixture geometry or pixel layer differs from the request");
  return doc;
}

async function runEightBitReadTest(photoshop, executionContext) {
  const adapter = createPhotoshopAdapter(photoshop, { executionContext });
  const prior = photoshop.app.documents.length ? photoshop.app.activeDocument.id : null;
  let doc; const owned = new Set();
  try {
    doc = await addOwnedDocument(photoshop, { name: "Owned 8-bit reduced-read fixture", width: 1024, height: 768,
      resolution: 72, mode: photoshop.constants.NewDocumentMode.RGB, fill: photoshop.constants.DocumentFill.TRANSPARENT,
      depth: 8, profile: ADOBE_RGB }, owned);
    const data = new Uint8Array(1024 * 768 * 3);
    for (let i = 0; i < data.length; i += 3) data.set([48, 112, 168], i);
    const image = await photoshop.imaging.createImageDataFromBuffer(data, { width: 1024, height: 768,
      components: 3, colorSpace: "RGB", colorProfile: ADOBE_RGB });
    try { await photoshop.imaging.putPixels({ documentID: doc.id, layerID: doc.layers[0].id, imageData: image, replace: true }); }
    finally { image.dispose(); }
    await doc.createLayerGroup({ name: "Preserved source structure" });
    const before = adapter.inspect(doc.id);
    // An arbitrary resize also exercises resampling beyond exact cache levels.
    const reduced = await adapter.readPixels(doc.id, 640);
    const full = await adapter.readPixels(doc.id);
    if (reduced.width !== 640 || reduced.height !== 480 || reduced.bounds.left !== 0 || reduced.bounds.top !== 0
      || reduced.bounds.right !== 1024 || reduced.bounds.bottom !== 768) throw new Error("8-bit reduced read lost source coordinates");
    if (reduced.maximum !== 255 || reduced.profile !== ADOBE_RGB) throw new Error("8-bit reduced frame misreports precision or profile");
    for (const frame of [full, reduced]) {
      for (const [channel, value] of [48, 112, 168].entries()) {
        if (Math.abs(frame.data[channel] / frame.maximum * 255 - value) > 1) throw new Error("Pixel read corrupted the known Adobe RGB fixture color");
      }
    }
    const mask = { left: 256, top: 192, width: 512, height: 384, maximum: 255, data: new Uint8Array(512 * 384).fill(255) };
    const a = measureMaterial(full, mask), b = measureMaterial(reduced, mask);
    if (!a.available || !b.available || a.diffuseLab.some((v, i) => Math.abs(v - b.diffuseLab[i]) > 0.5)) throw new Error("Reduced native-depth material measurement disagrees with full resolution");
    if (JSON.stringify(before) !== JSON.stringify(adapter.inspect(doc.id))) throw new Error("Reading pixels changed the original document");
    return { fullMaximum: full.maximum, reducedMaximum: reduced.maximum, width: reduced.width, height: reduced.height,
      bounds: reduced.bounds, fullLab: a.diffuseLab, reducedLab: b.diffuseLab, sourceUnchanged: true };
  } finally {
    for (const id of owned) {
      const current = Array.from(photoshop.app.documents).find(value => value.id === id);
      if (current) await current.closeWithoutSaving();
    }
    if (prior && Array.from(photoshop.app.documents).some(value => value.id === prior)) {
      await executeChecked(photoshop, [{ _obj: "select", _target: [{ _ref: "document", _id: prior }] }]);
    }
  }
}

async function runDimensionReadTest(photoshop, executionContext) {
  let dimensionReads = 0;
  const proxies = new Map(), owned = new Set();
  const prior = photoshop.app.documents.length ? photoshop.app.activeDocument.id : null;
  function wrap(doc) {
    if (!proxies.has(doc.id)) proxies.set(doc.id, new Proxy(doc, { get(target, property) {
      if (property === "width" || property === "height") dimensionReads += 1;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    } }));
    return proxies.get(doc.id);
  }
  const instrumented = { action: photoshop.action, imaging: photoshop.imaging, constants: photoshop.constants, core: photoshop.core,
    app: { get documents() { return Array.from(photoshop.app.documents).map(wrap); }, get activeDocument() { return wrap(photoshop.app.activeDocument); } } };
  const adapter = createPhotoshopAdapter(instrumented, { executionContext });
  try {
    const source = await addOwnedDocument(photoshop, { name: "Owned dimension-read fixture", width: 96, height: 64,
      resolution: 72, mode: photoshop.constants.NewDocumentMode.RGB, fill: photoshop.constants.DocumentFill.WHITE, depth: 16, profile: ADOBE_RGB }, owned);
    const snapshot = await adapter.captureSource(source.id); owned.add(snapshot.documentId);
    const preview = await adapter.createPreview(snapshot); owned.add(preview.documentId);
    const mask = { width: 96, height: 64, left: 0, top: 0, maximum: 65535, data: new Uint16Array(96 * 64).fill(65535) };
    const recipe = createCandidates({ diffuseLab: [100, 0, 0] }, { id: "read-count-target", name: "Synthetic Wine",
      material: "MATTE", measurementSpace: "CIELAB D50 2deg", diffuseLab: [35, 30, 2] })[0];
    dimensionReads = 0;
    await adapter.render(preview, recipe, mask);
    if (dimensionReads > 100) throw new Error("Rendering read native document dimensions " + dimensionReads + " times for " + mask.data.length + " mask pixels; expected <= 100");
    return { dimensionReads, maskPixels: mask.data.length, maximumAllowed: 100 };
  } finally {
    for (const id of owned) {
      const doc = Array.from(photoshop.app.documents).find(value => value.id === id);
      if (doc) await doc.closeWithoutSaving();
    }
    if (prior && Array.from(photoshop.app.documents).some(doc => doc.id === prior)) {
      await executeChecked(photoshop, [{ _obj: "select", _target: [{ _ref: "document", _id: prior }] }]);
    }
  }
}

// These are real Photoshop tests, not a Photoshop simulator. They operate
// solely on owned synthetic documents and never open client files.
async function runHostTests(photoshop, uxp, folder) {
  const context = uxp.script.executionContext;
  const adapter = createPhotoshopAdapter(photoshop, { executionContext: context });
  const owned = new Set(), cases = [];
  const initialDocumentIds = new Set(Array.from(photoshop.app.documents).map(doc => doc.id));
  const originalDocument = photoshop.app.documents.length ? photoshop.app.activeDocument.id : null;
  const report = { schemaVersion: 1, startedAt: new Date().toISOString(), host: uxp.host,
    scope: "Stage 1A synthetic technical fixtures; not human-edit feasibility or production qualification",
    productionQualified: false, initialDocumentIds: Array.from(initialDocumentIds), cases };
  const assert = (value, message) => { if (!value) throw new Error(message); };
  async function run(name, work) {
    const start = Date.now();
    try { const details = await work(); cases.push({ name, status: "PASS", milliseconds: Date.now() - start, details }); }
    catch (error) { cases.push({ name, status: "FAIL", milliseconds: Date.now() - start, error: error.message, stack: error.stack }); }
  }
  async function fixture(depth = 16, profile = ADOBE_RGB, width = 96, height = 64) {
    const doc = await addOwnedDocument(photoshop, { name: "Recolor owned fixture " + Date.now(), width, height,
      resolution: 72, mode: photoshop.constants.NewDocumentMode.RGB, fill: photoshop.constants.DocumentFill.TRANSPARENT, depth, profile }, owned);
    const data = new Uint16Array(width * height * 3);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const inside = x >= width / 12 && x < width * 11 / 12 && y >= height * 3 / 32 && y < height * 29 / 32;
      const shade = 0.6 + x / width * 0.4 + 0.05 * Math.sin(x * 2) * Math.cos(y * 2);
      const rgb = inside ? [95 * shade, 155 * shade, 55 * shade] : [255, 255, 255];
      for (let c = 0; c < 3; c += 1) data[(y * width + x) * 3 + c] = Math.round(rgb[c] / 255 * 65535);
    }
    const image = await photoshop.imaging.createImageDataFromBuffer(data, { width, height, components: 3,
      colorSpace: "RGB", colorProfile: profile, fullRange: true });
    try { await photoshop.imaging.putPixels({ documentID: doc.id, layerID: doc.layers[0].id, imageData: image, replace: true }); }
    finally { image.dispose(); }
    return doc;
  }
  const maskData = new Uint8Array(96 * 64);
  for (let y = 10; y < 54; y += 1) for (let x = 12; x < 84; x += 1) maskData[y * 96 + x] = x === 12 || x === 83 ? 128 : 255;
  const mask = { width: 96, height: 64, left: 0, top: 0, data: maskData, maximum: 255 };
  let source, snapshot, session, baseline, candidates;
  try {
    await run("Bounded UXP file verification matches an independently computed multi-chunk SHA-256", async () => {
      const bytes = new Uint8Array(2 * 1024 * 1024 + 71);
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 31 + 17) % 256;
      const file = await folder.createFile("hash-fixture.bin", { overwrite: false });
      await file.write(bytes, { format: uxp.storage.formats.binary });
      const identity = await fingerprintFile(file.url, require("fs"), { chunkBytes: 65536 });
      assert(identity.sha256 === "2e5245911775c5a7a1b7078a7e8e76a0988a0df5ff56f11e3deea7f540155f88" && identity.bytes === bytes.length, "Native file digest differs from independent Node crypto");
      return { ...identity, chunkBytes: 65536 };
    });
    await run("A pinned frozen-source checkpoint recovers a fresh editable source across adapter instances", async () => {
      const doc = await fixture(), inspection = adapter.inspectSource(doc.id);
      const preparation = createSourcePreparation(inspection, { roles: inspection.layers.map(layer => ({ indices: layer.indices, role: "KEEP_BASE" })), insertion: { kind: "TOP" },
        review: { status: "ACCEPTED", reviewer: "Synthetic recovery reviewer", reviewedAt: new Date().toISOString() } });
      const snapshot = await adapter.captureSource(doc.id, { sourcePreparation: preparation }); owned.add(snapshot.documentId);
      const expected = await adapter.readPixels(snapshot.documentId);
      const artifact = await adapter.saveSourceCheckpoint(snapshot, folder);
      await adapter.releaseSource(snapshot); owned.delete(snapshot.documentId);
      const next = createPhotoshopAdapter(photoshop, { executionContext: context });
      const restored = await next.restoreSourceCheckpoint(artifact.manifestFile); owned.add(restored.documentId);
      assert(restored.recovery.checkpointId === artifact.checkpoint.payload.id && restored.recovery.sha256 === artifact.checkpoint.payload.artifact.sha256, "Recovered source is not bound to its checkpoint");
      const actual = await next.readPixels(restored.documentId);
      assert(actual.data.every((value, index) => Math.abs(value - expected.data[index]) <= 2), "Recovered source pixels changed");
      const preview = await next.createPreview(restored); owned.add(preview.documentId);
      await next.render(preview, createCandidates(measureMaterial(actual, mask), { id: "recovery-reference", material: "MATTE", measurementSpace: "CIELAB D50 2deg", diffuseLab: [40, 25, 0] })[0], mask);
      const output = await next.commit(preview);
      assert(output.recovery.checkpointId === artifact.checkpoint.payload.id, "Recovery provenance missing from applied output");
      assert(JSON.stringify(inspection) === JSON.stringify(adapter.inspectSource(doc.id)), "Checkpoint workflow changed the original source");
      return { sourceUnchanged: true, freshAdapterVerified: true, bytes: artifact.checkpoint.payload.artifact.bytes, sha256: restored.recovery.sha256, nativeEditsApplied: true };
    });
    await run("Recovery refuses altered files, altered manifests and already-open artifacts; cancellation retains its journal", async () => {
      const doc = await fixture(), inspection = adapter.inspectSource(doc.id);
      const preparation = createSourcePreparation(inspection, { roles: inspection.layers.map(layer => ({ indices: layer.indices, role: "KEEP_BASE" })), insertion: { kind: "TOP" },
        review: { status: "ACCEPTED", reviewer: "Synthetic failure reviewer", reviewedAt: new Date().toISOString() } });
      const snapshot = await adapter.captureSource(doc.id, { sourcePreparation: preparation }); owned.add(snapshot.documentId);
      const artifact = await adapter.saveSourceCheckpoint(snapshot, folder), count = photoshop.app.documents.length;
      const opened = await adapter.openDocument(artifact.artifactFile); owned.add(opened.id);
      let rejected = false;
      try { await adapter.restoreSourceCheckpoint(artifact.manifestFile); } catch (error) { rejected = /already open|ambiguous/i.test(error.message); }
      assert(rejected && photoshop.app.documents.length === count + 1, "Recovery reused or closed an existing artifact document");
      await opened.closeWithoutSaving(); owned.delete(opened.id);
      const changed = JSON.parse(JSON.stringify(artifact.checkpoint)); changed.payload.sourcePreparation.review.reviewer = "Changed after save";
      const bad = await folder.createFile("changed-recovery-manifest.json", { overwrite: false }); await bad.write(JSON.stringify(changed));
      rejected = false;
      try { await adapter.restoreSourceCheckpoint(bad); } catch (error) { rejected = /checksum/i.test(error.message); }
      assert(rejected && photoshop.app.documents.length === count, "Changed manifest created a document");
      await artifact.artifactFile.write(new Uint8Array([1, 2, 3]), { format: uxp.storage.formats.binary });
      rejected = false;
      try { await adapter.restoreSourceCheckpoint(artifact.manifestFile); } catch (error) { rejected = /bytes changed/i.test(error.message); }
      assert(rejected && photoshop.app.documents.length === count, "Changed artifact created a document");
      const entries = new Set((await folder.getEntries()).map(entry => entry.name)), signal = { aborted: false };
      let cancelled = false;
      try { await adapter.saveSourceCheckpoint(snapshot, folder, { signal, onProgress() { signal.aborted = true; } }); } catch (error) { cancelled = error.code === "CANCELLED"; }
      const partial = (await folder.getEntries()).filter(entry => !entries.has(entry.name));
      const journal = partial.find(entry => entry.name.endsWith(".pending.json"));
      assert(cancelled && journal && JSON.parse(await journal.read()).status === "CANCELLED", "Cancellation did not preserve an incomplete recovery journal");
      assert(!partial.some(entry => entry.name.endsWith(".json") && !entry.name.endsWith(".pending.json")), "Cancelled verification published a final manifest");
      assert(JSON.stringify(inspection) === JSON.stringify(adapter.inspectSource(doc.id)), "Recovery failures changed the original source");
      return { changedFileRejected: true, changedManifestRejected: true, existingDocumentPreserved: true, cancelledJournalRetained: true, partialManifestNotPublished: true };
    });
    await run("Reviewed source preparation preserves base retouch and places recoloring below finishing layers", async () => {
      const doc = await fixture();
      const baseLayer = doc.layers[0];
      const finish = await doc.createPixelLayer({ name: "Preserved label retouch" });
      const label = new Uint8Array(8 * 8 * 3).fill(235);
      const image = await photoshop.imaging.createImageDataFromBuffer(label, { width: 8, height: 8, components: 3, colorSpace: "RGB", colorProfile: ADOBE_RGB });
      try { await photoshop.imaging.putPixels({ documentID: doc.id, layerID: finish.id, imageData: image, replace: true, targetBounds: { left: 35, top: 25 } }); } finally { image.dispose(); }
      const expected = await adapter.readPixels(doc.id);
      assert(measureMaterial(expected, mask).diffuseLab[0] > 20, "The finishing-label fixture obscured the source material");
      const old = await doc.createLayerGroup({ name: "Historic color work" });
      await old.move(finish, photoshop.constants.ElementPlacement.PLACEAFTER);
      await executeChecked(photoshop, [
        { _obj: "select", _target: [{ _ref: "layer", _id: old.id }], makeVisible: false },
        { _obj: "make", _target: [{ _ref: "adjustmentLayer" }], using: { _obj: "adjustmentLayer", name: "Old target Hue/Saturation", type: { _obj: "hueSaturation", colorize: false, adjustment: [{ _obj: "hueSatAdjustmentV2", hue: 90, saturation: 35, lightness: 0 }] } } }
      ]);
      const oldAdjustment = doc.activeLayers[0]; await oldAdjustment.move(old, photoshop.constants.ElementPlacement.PLACEINSIDE);
      const before = await adapter.inspectSource(doc.id);
      const oldLocator = before.layers.find(layer => layer.id === old.id).indices;
      const roles = before.layers.filter(layer => layer.indices.length === 1).map(layer => ({ indices: layer.indices, role: layer.id === old.id ? "DISABLE_RECOLOR" : "KEEP_BASE" }));
      const preparation = createSourcePreparation(before, { roles, insertion: { kind: "BEFORE_LAYER", indices: oldLocator }, review: { status: "ACCEPTED", reviewer: "Synthetic fixture retoucher", reviewedAt: new Date().toISOString() } });
      const frozen = await adapter.captureSource(doc.id, { sourcePreparation: preparation }); owned.add(frozen.documentId);
      const recovered = await adapter.readPixels(frozen.documentId);
      assert(recovered.data.every((value, index) => value === expected.data[index]), "Source preparation lost base detail or retained historical color");
      assert(JSON.stringify(before) === JSON.stringify(await adapter.inspectSource(doc.id)), "Source preparation changed the original document");
      const working = Array.from(photoshop.app.documents).find(value => value.id === frozen.documentId);
      const originalBranch = working.layers.find(layer => layer.name === old.name);
      assert(originalBranch && !originalBranch.visible && originalBranch.layers[0].visible, "Historical content or its child visibility was altered");
      const preview = await adapter.createPreview(frozen); owned.add(preview.documentId);
      const target = { id: "synthetic-source-recovery", name: "Synthetic Wine", material: "MATTE", measurementSpace: "CIELAB D50 2deg", diffuseLab: [35, 30, 2] };
      const recipe = createCandidates(measureMaterial(recovered, mask), target)[0];
      await adapter.render(preview, recipe, mask);
      const result = await adapter.readPixels(preview.documentId);
      const resultDoc = Array.from(photoshop.app.documents).find(value => value.id === preview.documentId);
      const order = Array.from(resultDoc.layers).map(layer => layer.name);
      assert(order[0] === finish.name && resultDoc.layers[1].id === preview.groupId && order[2] === old.name, "Recoloring was not placed adjacent to the reviewed historical branch");
      const labelOffset = (28 * 96 + 38) * result.components;
      assert([0, 1, 2].every(channel => result.data[labelOffset + channel] === expected.data[labelOffset + channel]), "New recoloring changed the finishing label above it");
      assert(result.data.some((value, index) => value !== recovered.data[index]), "New recipe did not recolor the material");
      assert(compareFrames(recovered, result, mask).protectedPixelsChanged === 0, "Prepared-source recoloring changed protected pixels");
      assert(working.layers.some(layer => layer.name === baseLayer.name), "Underlying original source layer was lost");
      const manifest = await adapter.commit(preview);
      assert(manifest.sourcePreparation.review.reviewer === "Synthetic fixture retoucher", "Source-role provenance missing from output manifest");
      const file = await folder.createFile("reviewed-source-fixture.psd", { overwrite: false });
      await resultDoc.saveAs.psd(file, { layers: true, embedColorProfile: true, maximizeCompatibility: true }, true);
      const reopened = await adapter.openDocument(file); owned.add(reopened.id);
      const reopenedLayers = Array.from(reopened.layers), preserved = reopenedLayers.find(layer => layer.name === old.name);
      const recolorIndex = reopenedLayers.findIndex(layer => layer.name.startsWith("AI Recolor"));
      assert(preserved && !preserved.visible && preserved.layers.length === 1 && preserved.layers[0].visible, "Historical branch or child state lost on save/reopen");
      assert(reopenedLayers.findIndex(layer => layer.name === finish.name) < recolorIndex && recolorIndex < reopenedLayers.indexOf(preserved), "Reviewed processing location lost on reopening");
      const [humanProperties] = await executeChecked(photoshop, [{ _obj: "get", _target: [{ _ref: "layer", _id: preserved.layers[0].id }, { _ref: "document", _id: reopened.id }] }]);
      assert(humanProperties.adjustment[0].adjustment[0].hue === 90, "Historical adjustment payload was replaced");
      assert((await adapter.readPixels(reopened.id)).data.every((value, index) => Math.abs(value - result.data[index]) <= 2), "Prepared-source master differs from preview");
      return { sourceUnchanged: true, originalBranchPreserved: true, humanPayloadPreserved: true, finishingLabelUnchanged: true,
        insertion: "ROOT_ADJACENT_BELOW_FINISHING", reviewStatus: preparation.review.status, savedMasterValidated: true };
    });
    await run("Pending, unresolved and stale source reviews are rejected before document creation", async () => {
      const doc = await fixture(), inspection = adapter.inspectSource(doc.id), count = photoshop.app.documents.length;
      const pending = createSourcePreparation(inspection, { roles: [], insertion: { kind: "TOP" } });
      for (const preparation of [pending, { ...pending, review: { status: "ACCEPTED", reviewer: "Synthetic review", reviewedAt: new Date().toISOString() } }]) {
        let rejected = false;
        try { await adapter.captureSource(doc.id, { sourcePreparation: preparation }); } catch (error) { rejected = /review|unresolved/i.test(error.message); }
        assert(rejected && photoshop.app.documents.length === count, "An unresolved review created a working document");
      }
      const accepted = createSourcePreparation(inspection, { roles: inspection.layers.filter(layer => layer.indices.length === 1).map(layer => ({ indices: layer.indices, role: "KEEP_BASE" })),
        insertion: { kind: "TOP" }, review: { status: "ACCEPTED", reviewer: "Synthetic review", reviewedAt: new Date().toISOString() } });
      await doc.createPixelLayer({ name: "Designer correction after review" });
      const changed = adapter.inspectSource(doc.id);
      let rejected = false;
      try { await adapter.captureSource(doc.id, { sourcePreparation: accepted }); } catch (error) { rejected = /stale/i.test(error.message); }
      assert(rejected && photoshop.app.documents.length === count, "A stale review created a working document");
      assert(JSON.stringify(changed) === JSON.stringify(adapter.inspectSource(doc.id)), "Rejecting the review changed designer work");
      return { pendingRejected: true, unresolvedRejected: true, staleRejected: true, designerWorkPreserved: true };
    });
    await run("Duplicate layer names use reviewed structural locations and retain independent visibility", async () => {
      const doc = await fixture();
      await doc.createLayerGroup({ name: "Duplicate target" }); await doc.createLayerGroup({ name: "Duplicate target" });
      const inspection = adapter.inspectSource(doc.id), roots = inspection.layers.filter(layer => layer.indices.length === 1);
      const preparation = createSourcePreparation(inspection, { roles: roots.map(layer => ({ indices: layer.indices, role: layer.indices[0] === 0 ? "DISABLE_RECOLOR" : "KEEP_BASE" })),
        insertion: { kind: "BEFORE_LAYER", indices: [1] }, review: { status: "ACCEPTED", reviewer: "Synthetic review", reviewedAt: new Date().toISOString() } });
      const snapshot = await adapter.captureSource(doc.id, { sourcePreparation: preparation }); owned.add(snapshot.documentId);
      const frozen = Array.from(photoshop.app.documents).find(value => value.id === snapshot.documentId);
      assert(!frozen.layers[0].visible && frozen.layers[1].visible, "A duplicate name redirected a source-role decision");
      assert(doc.layers[0].visible && doc.layers[1].visible, "Original branch visibility changed");
      const preview = await adapter.createPreview(snapshot); owned.add(preview.documentId);
      await adapter.render(preview, createCandidates(measureMaterial(await adapter.readPixels(snapshot.documentId), mask), { id: "duplicate-structure-target", material: "MATTE", measurementSpace: "CIELAB D50 2deg", diffuseLab: [45, 20, -5] })[0], mask);
      const resultDoc = Array.from(photoshop.app.documents).find(value => value.id === preview.documentId);
      assert(resultDoc.layers[1].id === preview.groupId && resultDoc.layers[2].name === "Duplicate target", "Duplicate name redirected the insertion anchor");
      return { firstBranchDisabled: true, secondBranchPreserved: true, anchorUsesReviewedLocation: true };
    });
    await run("Different hidden human recipes cannot influence independent source-driven fitting", async () => {
      const results = [], frames = [], visibleLegacy = [];
      const target = { id: "same-independent-reference", material: "MATTE", measurementSpace: "CIELAB D50 2deg", diffuseLab: [40, 25, 0] };
      for (const hue of [90, -120]) {
        const doc = await fixture();
        await executeChecked(photoshop, [{ _obj: "make", _target: [{ _ref: "adjustmentLayer" }], using: { _obj: "adjustmentLayer", name: "Historical target-specific adjustment", type: { _obj: "hueSaturation", colorize: false, adjustment: [{ _obj: "hueSatAdjustmentV2", hue, saturation: 35, lightness: 0 }] } } }]);
        visibleLegacy.push(await adapter.readPixels(doc.id));
        const inspection = adapter.inspectSource(doc.id);
        const preparation = createSourcePreparation(inspection, { roles: inspection.layers.filter(layer => layer.indices.length === 1).map(layer => ({ indices: layer.indices, role: layer.kind === "hueSaturation" ? "DISABLE_RECOLOR" : "KEEP_BASE" })),
          insertion: { kind: "BEFORE_LAYER", indices: [0] }, review: { status: "ACCEPTED", reviewer: "Synthetic review", reviewedAt: new Date().toISOString() } });
        const snapshot = await adapter.captureSource(doc.id, { sourcePreparation: preparation }); owned.add(snapshot.documentId);
        const baseline = await adapter.readPixels(snapshot.documentId), preview = await adapter.createPreview(snapshot); owned.add(preview.documentId);
        const fitResult = await fit(measureMaterial(baseline, mask), target, async recipe => {
          await adapter.render(preview, recipe, mask);
          return evaluateRender(baseline, await adapter.readPixels(preview.documentId), mask, target);
        }, { maxEvaluations: 5, includeTintedBlackWhite: true });
        results.push(fitResult.recipe); frames.push(await adapter.readPixels(preview.documentId));
      }
      assert(visibleLegacy[0].data.some((value, index) => value !== visibleLegacy[1].data[index]), "Leakage fixture did not contain distinct historical appearances");
      assert(JSON.stringify(results[0]) === JSON.stringify(results[1]), "Hidden historical parameters influenced the fitted recipe");
      assert(frames[0].data.every((value, index) => value === frames[1].data[index]), "Hidden historical parameters influenced the rendered winner");
      return { legacyHues: [90, -120], independentRecipesIdentical: true, independentRendersIdentical: true, humanGoldInputs: "NOT_PROVIDED_TO_FITTER" };
    });
    await run("8-bit layered source supports reduced native-depth pixel reads without modification", () => runEightBitReadTest(photoshop, context));
    await run("Rendering reads native document dimensions a bounded number of times", () => runDimensionReadTest(photoshop, context));
    await run("8-bit sRGB source normalizes to a layered 16-bit Adobe RGB duplicate", async () => {
      source = await fixture(8, SRGB);
      const originalGroup = await source.createLayerGroup({ name: "Original source notes" });
      const originalLabel = await source.createPixelLayer({ name: "Original label layer" });
      await originalLabel.move(originalGroup, photoshop.constants.ElementPlacement.PLACEINSIDE);
      await source.selection.selectRectangle({ left: 12, top: 10, right: 84, bottom: 54 }, photoshop.constants.SelectionType.REPLACE);
      await source.selection.save("Original saved selection");
      const originalPath = await source.selection.makeWorkPath(0.5);
      originalPath.name = "Original source path";
      const before = adapter.inspect(source.id);
      snapshot = await adapter.captureSource(source.id);
      owned.add(snapshot.documentId);
      const frozen = adapter.inspect(snapshot.documentId), after = adapter.inspect(source.id);
      assert(frozen.profile === ADOBE_RGB && frozen.depth === photoshop.constants.BitsPerChannelType.SIXTEEN, "Working profile/depth normalization failed: " + JSON.stringify(frozen));
      assert(before.profile === after.profile && before.depth === after.depth && before.historyId === after.historyId, "Original source changed");
      baseline = await adapter.readPixels(snapshot.documentId);
      const measured = measureMaterial(baseline, mask);
      assert(measured.available, "Material could not be measured");
      candidates = createCandidates(measured, { id: "synthetic-wine-not-client-approved", name: "Synthetic Wine", revision: 1,
        measurementSpace: "CIELAB D50 2deg", diffuseLab: rgbToLab([110, 35, 70], ADOBE_RGB), material: "MATTE" });
      session = await adapter.createPreview(snapshot);
      owned.add(session.documentId);
      return { original: before, working: frozen, measurement: measured };
    });
    for (const method of ["A", "B", "C"]) {
      await run("Method " + method + " creates native adjustments and preserves protected pixels", async () => {
        assert(session && candidates, "Source fixture did not initialize");
        await adapter.render(session, candidates.find(v => v.method === method), mask);
        const rendered = await adapter.readPixels(session.documentId);
        const quality = evaluateRender(baseline, rendered, mask, candidates[0].target);
        assert(quality.integrity.protectedPixelsCompared > 0, "No protected pixels were evaluated");
        assert(quality.integrity.protectedPixelsChanged === 0, "Recoloring changed protected pixels: " + JSON.stringify({ quality, layers: adapter.nativeLayers(session.documentId) }));
        assert(rendered.data.some((v, i) => v !== baseline.data[i]), "Native recolor did not affect source material");
        const layers = adapter.nativeLayers(session.documentId);
        const expected = method === "B" ? ["hueSaturation", "selectiveColor"] : method === "A" ? ["solidColor"] : ["gradientMap"];
        for (const kind of expected) assert(layers.some(layer => String(layer.kind).toLowerCase().includes(kind.toLowerCase())), "Missing native " + kind + " layer");
        return { quality, layers };
      });
    }
    await run("Opt-in tinted Black & White and Levels remain masked, live-editable and native after PSD/PSB reopening", async () => {
      const preview = await adapter.createPreview(snapshot); owned.add(preview.documentId);
      const recipe = createCandidates(measureMaterial(baseline, mask), candidates[0].target, { includeTintedBlackWhite: true }).find(v => v.method === "D");
      await adapter.render(preview, recipe, mask);
      const layers = adapter.nativeLayers(preview.documentId);
      for (const kind of ["blackAndWhite", "levels"]) assert(layers.some(layer => layer.kind === kind), "Missing native " + kind + " in candidate D");
      const initialPixels = await adapter.readPixels(preview.documentId), groupId = preview.groupId;
      assert(compareFrames(baseline, initialPixels, mask).protectedPixelsChanged === 0, "Tinted candidate escaped its mask");
      const tuned = adjustRecipe(recipe, "gamma", 0.2);
      await adapter.render(preview, tuned, mask);
      assert(preview.groupId === groupId, "Updating Levels rebuilt the owned group");
      const expected = await adapter.readPixels(preview.documentId);
      assert(expected.data.some((v, i) => v !== initialPixels.data[i]), "Live Levels gamma did not change rendered pixels");
      assert(compareFrames(baseline, expected, mask).protectedPixelsChanged === 0, "Levels update changed protected pixels");
      await adapter.toggle(preview, false);
      assert((await adapter.readPixels(preview.documentId)).data.every((v, i) => v === baseline.data[i]), "Disabling D did not restore the normalized source");
      await adapter.toggle(preview, true);
      const manifest = await adapter.commit(preview);
      const doc = Array.from(photoshop.app.documents).find(value => value.id === manifest.documentId);
      const saved = [];
      for (const extension of ["psd", "psb"]) {
        const file = await folder.createFile("tinted-editable-fixture." + extension, { overwrite: false });
        await doc.saveAs[extension](file, { layers: true, embedColorProfile: true, maximizeCompatibility: true }, true);
        const reopened = await adapter.openDocument(file); owned.add(reopened.id);
        const native = adapter.nativeLayers(reopened.id), levels = native.find(layer => layer.kind === "levels"), tint = native.find(layer => layer.kind === "blackAndWhite");
        assert(levels && tint && reopened.colorProfileName === ADOBE_RGB, "Native D adjustments or profile lost on reopening " + extension);
        const [tintProperties, levelsProperties] = await executeChecked(photoshop, [tint, levels].map(layer => ({ _obj: "get", _target: [{ _ref: "layer", _id: layer.id }, { _ref: "document", _id: reopened.id }] })));
        assert(tintProperties.adjustment[0].useTint === true, "Black & White reopened without Tint enabled");
        assert(Math.abs(levelsProperties.adjustment[0].adjustment[0].gamma - 1.2) < 0.001, "Native Levels gamma did not persist");
        const group = reopened.layers.find(layer => layer.name.indexOf("AI Recolor") === 0);
        await adapter.acquireMask(reopened.id, { kind: "layerMask", layerId: group.id });
        const actual = await adapter.readPixels(reopened.id);
        assert(actual.data.every((v, i) => Math.abs(v - expected.data[i]) <= 2), "Reopened D master differs from preview");
        const payload = levelsProperties.adjustment[0]; payload.adjustment[0].gamma = 1.4;
        await executeChecked(photoshop, [
          { _obj: "select", _target: [{ _ref: "layer", _id: levels.id }, { _ref: "document", _id: reopened.id }], makeVisible: false },
          { _obj: "set", _target: [{ _ref: "adjustmentLayer", _enum: "ordinal", _value: "targetEnum" }], to: payload }
        ]);
        assert((await adapter.readPixels(reopened.id)).data.some((v, i) => v !== actual.data[i]), "Reopened Levels adjustment cannot be edited");
        saved.push({ extension, tintEnabled: true, gamma: 1.2, nativeAdjustmentEditVerified: true });
      }
      return { engineVersion: recipe.engineVersion, saved, protectedPixelsChanged: 0 };
    });
    await run("Live native parameter changes update an existing provisional group", async () => {
      const recipe = JSON.parse(JSON.stringify(candidates[2]));
      const oldGroup = session.groupId;
      recipe.parameters.lightness = 5;
      await adapter.render(session, recipe, mask);
      assert(session.groupId === oldGroup, "A slider change recreated the native group");
      const actual = await adapter.readPixels(session.documentId);
      assert(compareFrames(baseline, actual, mask).protectedPixelsChanged === 0, "Updating native controls leaked outside mask");
    });
    await run("A shared soft group mask is applied once, and masks differ from layer transparency", async () => {
      const acquired = await adapter.acquireMask(session.documentId, { kind: "layerMask", layerId: session.groupId });
      assert(acquired.data.some(v => v > 0 && v < acquired.maximum), "Soft edge coverage was lost");
      const saved = await adapter.readPixels(session.documentId);
      await adapter.toggle(session, false);
      const disabled = await adapter.readPixels(session.documentId);
      assert(disabled.data.every((v, i) => v === baseline.data[i]), "Disabling recolor did not restore original working pixels: " + JSON.stringify(adapter.nativeLayers(session.documentId)));
      await adapter.toggle(session, true);
      const restored = await adapter.readPixels(session.documentId);
      assert(restored.data.every((v, i) => v === saved.data[i]), "Preview toggle changed the recipe rendering");
      // Native child adjustments must have no selection-generated masks.
      const doc = Array.from(photoshop.app.documents).find(v => v.id === session.documentId);
      const group = doc.layers.find(v => v.id === session.groupId);
      for (const layer of group.layers) {
        const [properties] = await executeChecked(photoshop, [{ _obj: "get", _target: [{ _ref: "layer", _id: layer.id }, { _ref: "document", _id: doc.id }] }]);
        assert(!properties.hasUserMask, "Child adjustment has an unintended second material mask");
      }
      return { maskWidth: acquired.width, maskHeight: acquired.height };
    });
    await run("A failed native transaction rolls back only its own edits", async () => {
      const before = adapter.nativeLayers(session.documentId);
      let failed = false;
      try {
        await adapter.atomic(session.documentId, "Rollback fixture", async () => {
          const doc = Array.from(photoshop.app.documents).find(v => v.id === session.documentId);
          await doc.createPixelLayer({ name: "Must roll back" });
          await executeChecked(photoshop, [{ _obj: "select", _target: [{ _ref: "layer", _id: 2147483647 }] }]);
        });
      } catch (_error) { failed = true; }
      assert(failed, "Native error was not surfaced");
      assert(JSON.stringify(before) === JSON.stringify(adapter.nativeLayers(session.documentId)), "Rollback lost or retained unexpected layers");
    });
    await run("Nondefault mask density is not silently interpreted as full coverage", async () => {
      const preview = await adapter.createPreview(snapshot);
      owned.add(preview.documentId);
      await adapter.render(preview, candidates[0], mask);
      const doc = Array.from(photoshop.app.documents).find(v => v.id === preview.documentId);
      const group = doc.layers.find(v => v.id === preview.groupId);
      group.layerMaskDensity = 50;
      let rejected = false;
      try { await adapter.acquireMask(preview.documentId, { kind: "layerMask", layerId: preview.groupId }); }
      catch (error) { rejected = /explicit Photoshop selection/.test(error.message); }
      assert(rejected, "A partial-density mask was silently accepted");
    });
    await run("Offset 16-bit mask coverage is retained without 8-bit quantization", async () => {
      const preview = await adapter.createPreview(snapshot);
      owned.add(preview.documentId);
      const precise = { width: 3, height: 2, left: 25, top: 15, maximum: 65535,
        data: new Uint16Array([12000, 12345, 32768, 65535, 0, 40000]) };
      await adapter.render(preview, candidates[0], precise);
      const actual = await adapter.acquireMask(preview.documentId, { kind: "layerMask", layerId: preview.groupId });
      let maxError = 0;
      for (let y = 0; y < precise.height; y += 1) for (let x = 0; x < precise.width; x += 1) {
        const index = (y + precise.top - actual.top) * actual.width + x + precise.left - actual.left;
        maxError = Math.max(maxError, Math.abs(actual.data[index] / actual.maximum * 65535 - precise.data[y * precise.width + x]));
      }
      assert(maxError <= 3, "High-precision mask coverage changed: " + maxError);
      assert(compareFrames(baseline, await adapter.readPixels(preview.documentId), precise).protectedPixelsChanged === 0, "Offset mask changed protected pixels");
      return { maximum: actual.maximum, maxError };
    });
    await run("Reduced pixel reads retain full-document coordinate bounds", async () => {
      const doc = await fixture(16, ADOBE_RGB, 1024, 768);
      const full = await adapter.readPixels(doc.id);
      const reduced = await adapter.readPixels(doc.id, 128);
      assert(reduced.width === 128 && reduced.height === 96, "Reduced dimensions are incorrect");
      assert(reduced.bounds.left === 0 && reduced.bounds.top === 0 && reduced.bounds.right === 1024 && reduced.bounds.bottom === 768,
        "Pyramid-level bounds were not normalized: " + JSON.stringify(reduced.bounds));
      const region = { width: 400, height: 300, left: 300, top: 200, maximum: 255, data: new Uint8Array(400 * 300).fill(255) };
      const a = measureMaterial(full, region), b = measureMaterial(reduced, region);
      assert(a.available && b.available && Math.abs(a.diffuseLab[0] - b.diffuseLab[0]) < 1, "Reduced material sampling lost region alignment");
      return { width: reduced.width, height: reduced.height, bounds: reduced.bounds, fullLab: a.diffuseLab, reducedLab: b.diffuseLab };
    });
    await run("Committed PSD and PSB reopen with native controls, masks and Adobe RGB", async () => {
      // The deliberate rollback can change a history token; use a fresh preview.
      const outputSession = await adapter.createPreview(snapshot);
      owned.add(outputSession.documentId);
      await adapter.render(outputSession, candidates[0], mask);
      const expected = await adapter.readPixels(outputSession.documentId);
      const manifest = await adapter.commit(outputSession);
      let doc = Array.from(photoshop.app.documents).find(v => v.id === manifest.documentId);
      const saved = [];
      for (const extension of ["psd", "psb"]) {
        const file = await folder.createFile("editable-fixture." + extension, { overwrite: false });
        await doc.saveAs[extension](file, { layers: true, embedColorProfile: true, maximizeCompatibility: true }, true);
        const reopened = await adapter.openDocument(file);
        owned.add(reopened.id);
        assert(reopened.colorProfileName === ADOBE_RGB, "Embedded production profile did not survive " + extension);
        assert(reopened.layers.some(v => v.name === "Designer Final Touch-ups"), "Designer corrections group missing");
        assert(reopened.layers.some(v => v.name === "Original source notes"), "Existing source group was lost");
        assert(Array.from(reopened.channels).some(v => v.name === "Original saved selection"), "Original alpha channel was lost");
        assert(Array.from(reopened.pathItems).some(v => v.name === "Original source path"), "Original vector path was lost");
        const group = reopened.layers.find(v => v.name.indexOf("AI Recolor") === 0);
        assert(group && group.layers.length >= 3, "Native recolor structure missing");
        assert(group.layers.some(v => v.name === "Edge Corrections" && v.kind === photoshop.constants.LayerKind.NORMAL), "Editable edge correction layer missing");
        await adapter.acquireMask(reopened.id, { kind: "layerMask", layerId: group.id });
        const actual = await adapter.readPixels(reopened.id);
        assert(actual.data.every((v, i) => Math.abs(v - expected.data[i]) <= 2), "Saved master differs from approved preview");
        const prior = await adapter.readPixels(reopened.id);
        group.opacity = 50;
        assert(Math.abs(group.opacity - 50) <= 100 / 255, "Reopened opacity is outside native quantization tolerance");
        const changed = await adapter.readPixels(reopened.id);
        assert(changed.data.some((v, i) => v !== prior.data[i]), "Reopened native group is not editable");
        await reopened.closeWithoutSaving();
        owned.delete(reopened.id);
        saved.push(file.name);
      }
      return { saved, manifest };
    });
    await run("Manual Photoshop changes prevent destructive reapplication and cancellation", async () => {
      const edited = await adapter.createPreview(snapshot);
      owned.add(edited.documentId);
      await adapter.render(edited, candidates[0], mask);
      const doc = Array.from(photoshop.app.documents).find(v => v.id === edited.documentId);
      await doc.createPixelLayer({ name: "Designer hand work" });
      const before = adapter.nativeLayers(doc.id);
      let blocked = false;
      try { await adapter.render(edited, candidates[1], mask); } catch (error) { blocked = error.code === "MANUAL_EDITS"; }
      assert(blocked, "Manual edits were not detected");
      try { await adapter.cancel(edited); } catch (_error) {}
      assert(JSON.stringify(before) === JSON.stringify(adapter.nativeLayers(doc.id)), "Manual work was discarded");
    });
    await run("Independent variants do not recolor the preceding variant", async () => {
      const one = await adapter.createPreview(snapshot), two = await adapter.createPreview(snapshot);
      owned.add(one.documentId); owned.add(two.documentId);
      await adapter.render(one, candidates[0], mask);
      const a = await adapter.readPixels(one.documentId);
      await adapter.render(two, candidates[2], mask);
      const unchanged = await adapter.readPixels(one.documentId);
      assert(unchanged.data.every((v, i) => v === a.data[i]), "Another variant changed an earlier result");
      const frozen = await adapter.readPixels(snapshot.documentId);
      assert(frozen.data.every((v, i) => v === baseline.data[i]), "Frozen source pixels changed");
    });
    await run("Existing selections, saved alpha channels and vector paths are reusable", async () => {
      const doc = await fixture();
      await doc.selection.selectRectangle({ left: 20, top: 15, right: 52, bottom: 35 }, photoshop.constants.SelectionType.REPLACE);
      const current = await adapter.acquireMask(doc.id, { kind: "selection" });
      const expectedArea = 32 * 20;
      const area = m => Array.from(m.data).reduce((sum, v) => sum + v / m.maximum, 0);
      assert(Math.abs(area(current) - expectedArea) < 1, "Current selection coverage changed");
      await doc.selection.save("Owned saved garment selection");
      const channel = Array.from(doc.channels).find(v => v.name === "Owned saved garment selection");
      await doc.selection.deselect();
      const saved = await adapter.acquireMask(doc.id, { kind: "channel", channelIndex: Array.from(doc.channels).findIndex(v => v.name === channel.name), name: channel.name });
      assert(Math.abs(area(saved) - expectedArea) < 1, "Saved alpha selection changed coverage");
      const path = await doc.selection.makeWorkPath(0.5);
      const vector = await adapter.acquireMask(doc.id, { kind: "path", pathIndex: Array.from(doc.pathItems).findIndex(v => v.name === path.name), name: path.name });
      assert(Math.abs(area(vector) - expectedArea) < 5, "Vector path selection changed expected coverage");
      return { currentArea: area(current), alphaArea: area(saved), vectorArea: area(vector), sources: await adapter.maskSources(doc.id) };
    });
    await run("Opt-in bounded fitting evaluates A/B/C/D Photoshop composites and restores its winner", async () => {
      const preview = await adapter.createPreview(snapshot);
      owned.add(preview.documentId);
      const result = await fit(measureMaterial(baseline, mask), candidates[0].target, async recipe => {
        await adapter.render(preview, recipe, mask);
        return evaluateRender(baseline, await adapter.readPixels(preview.documentId), mask, recipe.target);
      }, { maxEvaluations: 10, includeTintedBlackWhite: true });
      assert(result.evaluations <= 10 && result.quality.available && !result.quality.integrity.critical, "Rendered fitting did not produce a valid provisional candidate");
      assert(result.history.slice(0, 4).map(value => value.method).join(",") === "A,B,C,D", "An eligible native candidate was not actually evaluated");
      const actual = evaluateRender(baseline, await adapter.readPixels(preview.documentId), mask, result.recipe.target);
      assert(Math.abs(actual.score - result.quality.score) < 0.001, "Visible preview is not the fitted winner");
      return { method: result.recipe.method, anchorDeltaE00: result.quality.anchorDeltaE00, evaluations: result.evaluations,
        candidateMethods: result.history.slice(0, 4).map(value => value.method) };
    });
  } finally {
    const cleanupErrors = [];
    for (const documentId of owned) {
      if (initialDocumentIds.has(documentId)) { cleanupErrors.push("Refused cleanup of pre-existing document " + documentId); continue; }
      const doc = Array.from(photoshop.app.documents).find(v => v.id === documentId);
      if (doc) try { await doc.closeWithoutSaving(); } catch (error) { cleanupErrors.push(error.message); }
    }
    if (originalDocument && Array.from(photoshop.app.documents).some(v => v.id === originalDocument)) {
      await executeChecked(photoshop, [{ _obj: "select", _target: [{ _ref: "document", _id: originalDocument }] }]);
    }
    report.cleanupErrors = cleanupErrors;
    const remaining = Array.from(photoshop.app.documents).map(doc => doc.id);
    report.initialDocumentsPreserved = Array.from(initialDocumentIds).every(id => remaining.includes(id));
    report.unexpectedNewDocumentIds = remaining.filter(id => !initialDocumentIds.has(id));
  }
  report.finishedAt = new Date().toISOString();
  report.passed = cases.filter(v => v.status === "PASS").length;
  report.failed = cases.filter(v => v.status === "FAIL").length;
  report.technicalGatePassed = report.failed === 0 && report.cleanupErrors.length === 0 && report.initialDocumentsPreserved && report.unexpectedNewDocumentIds.length === 0;
  return report;
}

module.exports = { runHostTests, runDimensionReadTest, runEightBitReadTest };
