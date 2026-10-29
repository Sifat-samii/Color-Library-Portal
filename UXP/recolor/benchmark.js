const { ADOBE_RGB } = require("./color");
const { createPhotoshopAdapter, executeChecked } = require("./photoshop-adapter");
const { measureMaterial, compareFrames, compareGold, evaluateRender } = require("./quality");
const { fit } = require("./fitting");

// Instrumented feasibility runs on local copies, never the production library.
async function runBenchmark(photoshop, uxp, folder, job) {
  if (job.engineVersion === 'native-fabric-1') return require('./fabric-benchmark').runBenchmark(photoshop, uxp, folder, job);
  const context = uxp.script.executionContext;
  let currentEntry;
  const adapter = createPhotoshopAdapter(photoshop, { executionContext: context, onOperation(name) {
    if (currentEntry) { currentEntry.nativeOperation = name; write(); }
  } });
  const initial = new Set(Array.from(photoshop.app.documents).map(doc => doc.id));
  const originalActive = initial.size ? photoshop.app.activeDocument.id : null;
  const report = { schemaVersion: 1, host: uxp.host, startedAt: new Date().toISOString(),
    expectedCaseCount: job.cases.length,
    productionQualified: false, referencePreparation: "PROVISIONAL_INTERNAL_ROI_NOT_CLIENT_APPROVAL",
    registrationStatus: "PAIRED_VIEWS_REQUIRE_ALIGNMENT_AND_REGION_REVIEW",
    sourceQualification: "SAVED_VISIBLE_STATE_ONLY_SOURCE_PREPARATION_NOT_IMPLEMENTED",
    scoredBenchmarkEligible: false,
    candidateMethods: job.includeTintedBlackWhite === true ? ["A", "B", "C", "D"] : ["A", "B", "C"],
    cases: [], cleanupErrors: [] };
  const write = () => require("fs").writeFileSync(folder.url + "/report.json", JSON.stringify(report, null, 2));
  let stopped = false;
  const signal = { get aborted() { return stopped || context.isCancelled; } };
  async function open(filename, owned) {
    const file = await uxp.storage.localFileSystem.getEntryWithUrl("file:/" + filename.replace(/\\/g, "/"));
    const doc = await adapter.openDocument(file);
    if (!initial.has(doc.id)) owned.add(doc.id);
    if (doc.colorProfileName !== ADOBE_RGB) throw new Error("This pilot requires the audited embedded Adobe RGB profile");
    return doc;
  }
  async function thumbnail(documentId, directory, name) {
    const result = await photoshop.imaging.getPixels({ documentID: documentId, targetSize: { height: 900 },
      colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1", componentSize: 8, applyAlpha: true });
    try {
      const bytes = await photoshop.imaging.encodeImageData({ imageData: result.imageData });
      const file = await directory.createFile(name, { overwrite: false });
      await file.write(new Uint8Array(bytes), { format: uxp.storage.formats.binary });
    } finally { result.imageData.dispose(); }
  }
  for (let n = 0; n < job.cases.length; n += 1) {
    if (signal.aborted) break;
    const input = job.cases[n], owned = new Set(), started = Date.now();
    const entry = { id: input.id, target: input.target, status: "RUNNING", evaluations: [],
      inputProvenance: input.provenance, alignmentValidated: input.alignmentValidated === true };
    currentEntry = entry;
    report.cases.push(entry); write();
    const phase = name => { entry.phase = name; write(); };
    try {
      const directory = await folder.createFolder("case-" + String(n + 1).padStart(2, "0"));
      entry.artifactDirectory = directory.name;
      phase("OPEN_REFERENCE");
      const reference = await open(input.reference, owned);
      const r = input.referenceRegion;
      if (!r || ![r.left, r.top, r.right, r.bottom].every(Number.isFinite)
        || r.left < 0 || r.top < 0 || r.right > 1 || r.bottom > 1 || r.right <= r.left || r.bottom <= r.top) throw new Error("Explicit normalized reference sampling region required");
      const left = Math.floor(reference.width * r.left), top = Math.floor(reference.height * r.top);
      const width = Math.ceil(reference.width * r.right) - left, height = Math.ceil(reference.height * r.bottom) - top;
      const referenceMask = { left, top, width, height, maximum: 255, data: new Uint8Array(width * height).fill(255) };
      phase("MEASURE_REFERENCE");
      const targetMeasurement = measureMaterial(await adapter.readPixels(reference.id, 640), referenceMask);
      if (!targetMeasurement.available) throw new Error("Reference region could not be measured");
      const target = { id: input.referenceId, name: input.target, material: "MATTE", revision: 1,
        measurementSpace: "CIELAB D50 2deg", diffuseLab: targetMeasurement.diffuseLab, lightness: targetMeasurement.lightness,
        zones: targetMeasurement.zones,
        preparationStatus: "PROVISIONAL_ROI_REQUIRES_RETOUCHER_REVIEW" };
      entry.reference = { path: input.reference, region: r, measurement: targetMeasurement };
      await thumbnail(reference.id, directory, "reference.jpg");
      phase("OPEN_SOURCE");
      const source = await open(input.source, owned);
      const before = adapter.inspect(source.id);
      phase("FREEZE_AND_NORMALIZE_SOURCE");
      const snapshot = await adapter.captureSource(source.id); owned.add(snapshot.documentId);
      entry.workingSourceDocumentId = snapshot.documentId;
      const frozen = Array.from(photoshop.app.documents).find(doc => doc.id === snapshot.documentId);
      const groups = Array.from(frozen.layers).filter(layer => layer.name === input.maskGroup && layer.kind === photoshop.constants.LayerKind.GROUP);
      if (groups.length !== 1) throw new Error("Material group is missing or ambiguous; require an explicit designer selection");
      phase("READ_EXISTING_MATERIAL_MASK");
      const mask = await adapter.acquireMask(frozen.id, { kind: "layerMask", layerId: groups[0].id });
      entry.mask = { source: "EXISTING_PSD_GROUP_MASK", group: input.maskGroup, width: mask.width, height: mask.height,
        left: mask.left, top: mask.top, maximum: mask.maximum, reviewStatus: "BOUNDARIES_REQUIRE_RETOUCHER_REVIEW" };
      const maskFile = await directory.createFile("material-mask.bin", { overwrite: false });
      await maskFile.write(mask.data.buffer, { format: uxp.storage.formats.binary });
      const baseline = await adapter.readPixels(snapshot.documentId, 640);
      const sourceMeasurements = measureMaterial(baseline, mask);
      const preview = await adapter.createPreview(snapshot); owned.add(preview.documentId);
      entry.previewDocumentId = preview.documentId;
      await thumbnail(snapshot.documentId, directory, "source.jpg");
      const result = await fit(sourceMeasurements, target, async recipe => {
        phase("RENDER_AND_MEASURE_" + recipe.method);
        const start = Date.now();
        const rendering = await adapter.render(preview, recipe, mask);
        const quality = evaluateRender(baseline, await adapter.readPixels(preview.documentId, 640), mask, target);
        quality.targetGamutClipped = rendering.targetGamutClipped;
        entry.evaluations.push({ method: recipe.method, parameters: recipe.parameters, quality, milliseconds: Date.now() - start });
        if (entry.evaluations.length <= report.candidateMethods.length) await thumbnail(preview.documentId, directory, "method-" + recipe.method + ".jpg");
        write(); return quality;
      }, { maxEvaluations: job.maxEvaluations || 12, signal, includeTintedBlackWhite: job.includeTintedBlackWhite === true });
      phase("VERIFY_FULL_RESOLUTION_INTEGRITY");
      const fullSource = await adapter.readPixels(snapshot.documentId);
      const fullWinner = await adapter.readPixels(preview.documentId);
      entry.fullResolutionIntegrity = compareFrames(fullSource, fullWinner, mask);
      if (entry.fullResolutionIntegrity.critical) throw new Error("Full-resolution protected pixels changed; candidate rejected");
      phase("EVALUATE_PAIRED_HUMAN_IMAGE");
      const gold = await open(input.goldJpg, owned);
      await thumbnail(gold.id, directory, "human.jpg");
      const goldPixels = await adapter.readPixels(gold.id);
      entry.goldComparison = compareGold(fullWinner, goldPixels, mask, { alignmentValidated: input.alignmentValidated === true });
      entry.humanDiffuse = measureMaterial(goldPixels, mask);
      await thumbnail(preview.documentId, directory, "fitted.jpg");
      entry.winner = { method: result.recipe.method, recipe: result.recipe, quality: result.quality, evaluations: result.evaluations };
      if (job.saveMasters !== false) {
        phase("SAVE_AND_REOPEN_NATIVE_MASTER");
        const manifest = await adapter.commit(preview);
        const format = input.masterFormat === "psb" ? "psb" : "psd";
        const file = await directory.createFile("experimental-master." + format, { overwrite: false });
        const doc = Array.from(photoshop.app.documents).find(value => value.id === preview.documentId);
        await doc.saveAs[format](file, { layers: true, embedColorProfile: true, maximizeCompatibility: true }, true);
        const reopened = await open(file.nativePath, owned);
        const actual = await adapter.readPixels(reopened.id);
        if (actual.data.length !== fullWinner.data.length || !actual.data.every((value, index) => Math.abs(value - fullWinner.data[index]) <= 2)) throw new Error("Saved master rendering does not match the fitted preview");
        const groups = Array.from(reopened.layers).filter(layer => layer.name.startsWith("AI Recolor") && layer.name.includes(manifest.sessionId));
        if (groups.length !== 1 || !reopened.layers.some(layer => layer.name === "Designer Final Touch-ups")) throw new Error("Reopened native ownership hierarchy is ambiguous");
        await adapter.acquireMask(reopened.id, { kind: "layerMask", layerId: groups[0].id });
        groups[0].opacity = 50;
        // Photoshop stores layer opacity in 255 steps (50 reads as 50.196...).
        const editedOpacity = groups[0].opacity;
        if (Math.abs(editedOpacity - 50) > 100 / 255) throw new Error("Reopened group controls cannot be edited");
        const editedPixels = await adapter.readPixels(reopened.id, 640);
        const priorPixels = await adapter.readPixels(preview.documentId, 640);
        if (!editedPixels.data.some((value, index) => value !== priorPixels.data[index])) throw new Error("Reopened adjustment edit did not change the rendering");
        entry.master = { file: file.name, manifest, editedOpacity,
          reopenedValidation: "PIXELS_PROFILE_MASK_STRUCTURE_AND_RENDERED_GROUP_CONTROL_VERIFIED" };
      }
      if (JSON.stringify(adapter.inspect(source.id)) !== JSON.stringify(before)) throw new Error("Source document state changed during benchmark");
      entry.status = "RENDERED_RETOUCHER_REVIEW_REQUIRED";
      entry.phase = "COMPLETE";
    } catch (error) {
      if (error.code === "CANCELLED") stopped = true;
      entry.status = signal.aborted ? "CANCELLED" : "ERROR"; entry.error = error.message; entry.stack = error.stack;
    } finally {
      entry.milliseconds = Date.now() - started;
      for (const id of owned) {
        const doc = Array.from(photoshop.app.documents).find(value => value.id === id);
        if (doc) try { await doc.closeWithoutSaving(); } catch (error) { report.cleanupErrors.push({ id, error: error.message }); }
      }
      write();
    }
  }
  if (originalActive && Array.from(photoshop.app.documents).some(doc => doc.id === originalActive)) {
    await executeChecked(photoshop, [{ _obj: "select", _target: [{ _ref: "document", _id: originalActive }] }]);
  }
  report.finishedAt = new Date().toISOString(); report.cancelled = signal.aborted; write();
  return report;
}

module.exports = { runBenchmark };
