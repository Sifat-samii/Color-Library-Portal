const { createPhotoshopAdapter, executeChecked } = require('./photoshop-adapter');
const { eligibility } = require('./benchmark-input');
const { createRecolorEngine } = require('./recolor-engine');
const { zoneMasks, METHODS } = require('./fabric-recipes');
const { measureMaterial, compareGold } = require('./quality');

async function runBenchmark(photoshop, uxp, folder, job) {
  const context = uxp.script.executionContext, adapter = createPhotoshopAdapter(photoshop, { executionContext: context });
  const initial = new Set(Array.from(photoshop.app.documents).map(doc => doc.id)), active = initial.size ? photoshop.app.activeDocument.id : null;
  const diagnosticMode = job.mode === 'DEVELOPMENT_DIAGNOSTIC';
  const report = { schemaVersion: 2, host: uxp.host, startedAt: new Date().toISOString(), expectedCaseCount: job.cases.length,
    engineVersion: 'native-fabric-1', sourceQualification: diagnosticMode ? 'UNQUALIFIED_DIAGNOSTIC_SOURCE' : 'PER_CASE_SHA256_VERIFIED_ORIGINAL_CHECKPOINT', candidateMethods: METHODS,
    referencePreparation: diagnosticMode ? 'PROVISIONAL_DIAGNOSTIC_ROI' : 'PER_CASE_REVIEWED_SAMPLE', registrationStatus: 'PER_CASE_ALIGNMENT_REQUIRED',
    scoredBenchmarkEligible: false, productionQualified: false, cases: [], cleanupErrors: [] };
  const write = () => require('fs').writeFileSync(folder.url + '/report.json', JSON.stringify(report, null, 2));
  const file = path => uxp.storage.localFileSystem.getEntryWithUrl('file:/' + path.replace(/\\/g, '/'));
  const signal = { get aborted() { return context.isCancelled; } };
  for (const input of job.cases) {
    const diagnostic = job.mode === 'DEVELOPMENT_DIAGNOSTIC';
    const entry = { id: input.id, target: input.target, status: 'PENDING', evaluations: [], eligibility: eligibility(input) }, owned = new Set(), started = Date.now();
    report.cases.push(entry); write();
    if (!entry.eligibility.eligible && !diagnostic) { entry.status = 'EXCLUDED'; entry.reason = entry.eligibility.reason; write(); continue; }
    if (signal.aborted) { entry.status = 'CANCELLED'; write(); continue; }
    try {
      let source;
      if (diagnostic) {
        if (!input.source || !input.materialRegion || !input.originalAppearanceEvidence) throw new Error('Diagnostic needs explicit source appearance provenance and material region');
        const original = await adapter.openDocument(await file(input.source)); owned.add(original.id);
        source = await adapter.captureSource(original.id, { untaggedProfile: input.untaggedProfile });
        entry.diagnostic = { scope: 'DEVELOPMENT_ONLY_NOT_SCORED', sourceAppearanceEvidence: input.originalAppearanceEvidence, materialRegion: input.materialRegion };
      } else source = await adapter.restoreSourceCheckpoint(await file(input.sourceCheckpoint));
      owned.add(source.documentId);
      entry.sourceQualification = source.sourceQualification; entry.inputProvenance = source.recovery;
      const reference = await adapter.openDocument(await file(input.reference)); owned.add(reference.id);
      const r = input.referenceRegion;
      if (!r || !['left', 'top', 'right', 'bottom'].every(key => Number.isFinite(r[key])) || r.left < 0 || r.top < 0 || r.right > 1 || r.bottom > 1 || r.right <= r.left || r.bottom <= r.top) throw new Error('Invalid reviewed reference region');
      const left = Math.floor(reference.width * r.left), top = Math.floor(reference.height * r.top);
      const refMask = { left, top, width: Math.ceil(reference.width * r.right) - left, height: Math.ceil(reference.height * r.bottom) - top, maximum: 255 };
      refMask.data = new Uint8Array(refMask.width * refMask.height).fill(255);
      const measured = measureMaterial(await adapter.readPixels(reference.id, 1024), refMask);
      if (!measured.available) throw new Error(measured.reason);
      const target = { id: input.referenceId || input.id, name: input.target, material: 'MATTE', ...measured };
      // Reopened layer IDs have no authority. Resolve a reviewed structural path.
      let maskSource = { ...input.mask }, mask;
      if (diagnostic) {
        const region = input.materialRegion, doc = adapter.inspect(source.documentId);
        if (!['left', 'top', 'right', 'bottom'].every(key => Number.isFinite(region[key])) || region.left < 0 || region.top < 0 || region.right > 1 || region.bottom > 1
          || region.right <= region.left || region.bottom <= region.top) throw new Error('Invalid diagnostic material region');
        const left = Math.floor(region.left * doc.width), top = Math.floor(region.top * doc.height);
        mask = { left, top, width: Math.ceil(region.right * doc.width) - left, height: Math.ceil(region.bottom * doc.height) - top, maximum: 255 };
        mask.data = new Uint8Array(mask.width * mask.height).fill(255);
      }
      if (maskSource.kind === 'layerMask') {
        let layers = Array.from(photoshop.app.documents).find(doc => doc.id === source.documentId).layers, layer;
        if (!Array.isArray(maskSource.indices) || !maskSource.indices.length) throw new Error('Reviewed mask layer indices required');
        for (const index of maskSource.indices) { layer = Array.from(layers)[index]; if (!layer) throw new Error('Reviewed mask location missing'); layers = layer.layers; }
        if (maskSource.name && layer.name !== maskSource.name) throw new Error('Reviewed mask layer identity differs');
        maskSource = { kind: 'layerMask', layerId: layer.id };
      }
      if (!mask) mask = await adapter.acquireMask(source.documentId, maskSource);
      // Reading a selection/path can change selection history. Capture only that
      // verified state before creating the independent preview.
      source.snapshotToken = JSON.stringify(adapter.inspect(source.documentId));
      const preview = await adapter.createPreview(source); owned.add(preview.documentId);
      const engine = createRecolorEngine({ sourceDocumentId: source.documentId, previewDocumentId: preview.documentId,
        readPixels: (...args) => adapter.readPixels(...args), readRegion: (...args) => adapter.readRegion(...args),
        assertCurrent: () => adapter.assertCurrent(preview), render: recipe => adapter.render(preview, recipe, mask, localMasks) });
      const sourceGeometry = adapter.inspect(source.documentId);
      const analysis = engine.analyze({ source: await adapter.readPixels(source.documentId, 1024), mask, target,
        canvasBounds: { left: 0, top: 0, right: sourceGeometry.width, bottom: sourceGeometry.height },
        provenance: source.recovery, material: input.material || 'MATTE' });
      const localMasks = analysis.transition.demanding ? zoneMasks(analysis) : {};
      analysis.localMasksAvailable = Boolean(localMasks);
      const result = await engine.fit(analysis, { maxEvaluations: job.maxEvaluations || 160, signal,
        onProgress(progress) { entry.phase = progress.phase; entry.progress = progress; write(); } });
      entry.winner = { method: result.recipe.method, recipe: result.recipe, quality: result.quality, evaluations: result.evaluations };
      entry.evaluations = result.comparison; entry.analysis = result.analysis; entry.fullResolutionIntegrity = result.quality.report.metrics;
      entry.scoredBenchmarkEligible = !diagnostic;
      // Gold is opened only AFTER fitting and final verification are complete.
      if (input.goldJpg) {
        const gold = await adapter.openDocument(await file(input.goldJpg)); owned.add(gold.id);
        entry.goldComparison = compareGold(await adapter.readPixels(preview.documentId, 1024), await adapter.readPixels(gold.id, 1024), mask,
          { alignmentValidated: input.alignmentValidated === true });
      }
      if (job.saveMasters !== false && result.quality.report.verdict !== 'INTEGRITY_FAILURE') {
        const manifest = await adapter.commit(preview), name = 'case-' + report.cases.length + '.' + (input.masterFormat === 'psb' ? 'psb' : 'psd');
        const saved = await adapter.saveMaster(preview.documentId, await folder.createFile(name, { overwrite: false }));
        entry.master = { ...saved, manifest, reviewRequired: result.quality.report.verdict !== 'CHECKS_PASSED' };
      }
      entry.status = 'RENDERED_RETOUCHER_REVIEW_REQUIRED';
    } catch (error) { entry.status = signal.aborted ? 'CANCELLED' : 'ERROR'; entry.error = error.message; }
    finally {
      entry.milliseconds = Date.now() - started;
      for (const id of owned) {
        if (initial.has(id)) throw new Error('Pre-existing document entered benchmark cleanup');
        const doc = Array.from(photoshop.app.documents).find(doc => doc.id === id);
        if (doc) try { await doc.closeWithoutSaving(); } catch (error) { report.cleanupErrors.push({ id, error: error.message }); }
      }
      write();
    }
  }
  if (active && Array.from(photoshop.app.documents).some(doc => doc.id === active)) await executeChecked(photoshop, [{ _obj: 'select', _target: [{ _ref: 'document', _id: active }] }]);
  report.scoredBenchmarkEligible = report.cases.length > 0 && report.cases.every(entry => entry.scoredBenchmarkEligible === true);
  report.finishedAt = new Date().toISOString(); report.cancelled = signal.aborted; write(); return report;
}
module.exports = { runBenchmark };
