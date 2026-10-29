const { measureMaterial, evaluateRender, compareFrames } = require('./quality');
const { ADJUSTMENT_METHODS, validateRecipe } = require('./recipes');
const sha256 = require('./vendor/sha256');
const { saveOutput } = require('./output-save');
const { isNearWhite } = require('./method-policy');
const { createRecolorEngine } = require('./recolor-engine');
const { METHODS, zoneMasks } = require('./fabric-recipes');
const { publicAnalysis } = require('./fabric-analysis');
const { signature } = require('./fabric-analysis');

function frameSignature(frame) {
  return sha256.create().update(JSON.stringify([frame.width, frame.height, frame.components, frame.maximum, frame.profile, frame.bounds]))
    .update(new Uint8Array(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength)).hex();
}

// Workstation-only session. Catalog approval remains owned by the library.
function createPilotSession({ adapter, referenceIsCurrent = () => true, onChange = () => {}, recordFeedback }) {
  let snapshot = null, preview = null, baseline = null, mask = null, sourceStats = null;
  let selected = null, busy = false, signal = null, showingAfter = true;
  let sourceRecovered = false, previewReady = false;
  let analysis = null, analysisTarget = null, localMasks = null, material = 'MATTE';
  let message = 'Activate your original product image, then choose Use active product.';
  const targets = new Map(), outputs = [];
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const key = ref => [ref.clientId, ref.colorId, ref.referenceId, ref.versionId].join(':');
  function view() {
    const target = targets.get(selected);
    return { busy, fitting: Boolean(signal), message, source: snapshot && clone(snapshot.original),
      sourceQualification: snapshot && snapshot.sourceQualification, workingSourceDocumentId: snapshot && snapshot.documentId,
      previewDocumentId: preview && preview.documentId,
      hasMask: Boolean(mask), sourceRecovered, target: target && { key: selected, reference: clone(target.reference), sampled: Boolean(target.measurement) },
      targets: [...targets].map(([id, t]) => ({ id, name: t.reference.colorName, sampled: Boolean(t.measurement) })),
      rendered: Boolean(previewReady && preview && preview.recipe && preview.recipe.target.id === selected),
      recipe: clone(target && target.recipe), quality: clone(target && target.quality),
      analysis: analysis ? publicAnalysis(analysis) : null, material,
      previewReview: clone(target && target.review), methodReviews: clone(target && target.methodReviews || []),
      committed: Boolean(preview && preview.committed), showingAfter, outputs: clone(outputs) };
  }
  const emit = text => { if (text) message = text; onChange(view()); };
  async function task(work) {
    if (busy) throw new Error('Finish or cancel the current recoloring operation first.');
    busy = true; emit();
    try { return await work(); }
    catch (error) { emit(error.message); throw error; }
    finally { busy = false; emit(); }
  }
  function requireSource() { if (!snapshot) throw new Error('Use active product before choosing an approved color.'); }
  function targetForRender() {
    const target = targets.get(selected);
    if (!target || !target.measurement) throw new Error('Select diffuse fabric on the approved reference, then sample it.');
    if (!referenceIsCurrent(target.reference)) throw new Error('This approved reference changed or is unavailable in the current library. Select it again after syncing.');
    if (!mask) throw new Error('Select the material in the product preview, then choose Use material selection.');
    return target;
  }
  async function freshPreview(selection = mask) {
    const previous = preview;
    let next;
    try { next = await adapter.createPreview(snapshot); }
    catch (error) {
      if (error.code !== 'FROZEN_SOURCE_CHANGED') throw error;
      const recovered = await adapter.recoverSource(snapshot);
      try {
        if (frameSignature(await adapter.readPixels(recovered.documentId, 1024)) !== frameSignature(baseline)) {
          throw new Error('Recovery does not match the captured source. Existing work was preserved; begin a new source session.');
        }
        next = await adapter.createPreview(recovered);
      } catch (failure) {
        try { await adapter.releaseSource(recovered); } catch (_) { /* Preserve any concurrent manual edits. */ }
        throw failure;
      }
      // The changed internal source stays open. Never merge or discard edits.
      snapshot = recovered; sourceRecovered = true;
    }
    preview = next; showingAfter = true; previewReady = false;
    if (selection) await adapter.showMaterialSelection(preview, selection);
    if (previous && !previous.committed) {
      try { await adapter.cancel(previous); }
      catch (error) { if (!['MANUAL_EDITS', 'DOCUMENT_CLOSED'].includes(error.code)) throw error; }
    }
  }
  function engineFor(target) {
    const engine = createRecolorEngine({ render: recipe => adapter.render(preview, recipe, mask, localMasks || {}),
      readPixels: (...args) => adapter.readPixels(...args), readRegion: adapter.readRegion ? (...args) => adapter.readRegion(...args) : null,
      assertCurrent: adapter.assertCurrent ? () => adapter.assertCurrent(preview) : null,
      sourceDocumentId: snapshot.documentId, previewDocumentId: preview.documentId });
    if (!analysis || analysisTarget !== target.measurement) {
      const geometry = adapter.inspect(snapshot.documentId);
      analysis = engine.analyze({ source: baseline, mask, target: target.measurement, material,
        canvasBounds: geometry.width && geometry.height ? { left: 0, top: 0, right: geometry.width, bottom: geometry.height } : baseline.bounds,
        provenance: { sourceQualification: snapshot.sourceQualification, reference: target.reference } });
      analysisTarget = target.measurement;
      localMasks = analysis.transition.demanding ? zoneMasks(analysis) : null;
      analysis.localMasksAvailable = !analysis.transition.demanding || Boolean(localMasks);
      if (analysis.transition.demanding && !localMasks) analysis.risks.push('Material mask exceeds the bounded local-correction memory budget');
    }
    return engine;
  }
  async function evaluate(recipe) {
    if (recipe.schemaVersion === 2) {
      const target = targetForRender(), engine = engineFor(target);
      return (await engine.evaluate(analysis, recipe)).quality;
    }
    if (!ADJUSTMENT_METHODS.includes(recipe.method)) throw new Error('Unsupported legacy method');
    const native = await adapter.render(preview, recipe, mask);
    const quality = evaluateRender(baseline, await adapter.readPixels(preview.documentId, 640), mask, recipe.target,
      { preserveLighting: /natural-lighting-4$/.test(recipe.engineVersion),
        protectHighlights: isNearWhite(recipe.target) && recipe.target.diffuseLab[0] - recipe.sourceAnchor[0] >= 12 });
    quality.targetGamutClipped = native.targetGamutClipped;
    return quality;
  }
  async function render(target, recipe) {
    let quality;
    try { quality = await evaluate(recipe); }
    catch (error) { previewReady = false; throw error; }
    target.recipe = clone(recipe); target.quality = quality; showingAfter = true; previewReady = true;
    emit('Preview updated. Check the Photoshop canvas at 100% before applying.');
    return quality;
  }
  const save = (file, manifestFolder, settings = {}) => task(async () => {
    const output = outputs.find(v => preview && v.documentId === preview.documentId);
    const protectedPaths = snapshot ? [snapshot.original.path, ...[...targets.values()].flatMap(t => [t.referenceDocument.path, t.reference.originalAssetPath])].filter(Boolean) : [];
    const record = await saveOutput({ adapter, output, protectedPaths, file, manifestFolder, jpegFile: settings.jpegFile, format: settings.format });
    emit(record.master && record.jpeg ? 'Saved editable Adobe RGB master and sRGB JPEG in the selected folder.'
      : record.jpeg ? 'sRGB JPEG saved. The editable Photoshop document remains available.' : 'Layered Adobe RGB master saved. You can continue normal Photoshop editing.');
    return clone(record);
  });
  return {
    view,
    setMaterial: value => task(async () => {
      requireSource();
      if (!['MATTE', 'SATIN', 'VELVET', 'PATTERNED', 'TRANSLUCENT', 'MIXED'].includes(value)) throw new Error('Choose a supported fabric appearance.');
      if (preview.committed || preview.recipe) throw new Error('Choose New variant before changing fabric appearance.');
      material = value; analysis = null; analysisTarget = null; localMasks = null;
      for (const target of targets.values()) { target.recipe = null; target.quality = null; target.review = null; target.methodReviews = []; }
      emit('Fabric appearance updated. Confirm the material selection before previewing.');
    }),
    begin: documentId => task(async () => {
      if (snapshot) throw new Error('End this source session before choosing another product. Saved and edited results stay open.');
      const captured = await adapter.captureSource(documentId);
      snapshot = captured;
      try {
        baseline = await adapter.readPixels(snapshot.documentId, 1024);
        await freshPreview();
      } catch (error) {
        try { await adapter.releaseSource(snapshot); } catch (_) { /* Preserve edited source. */ }
        snapshot = null; baseline = null; preview = null;
        throw error;
      }
      emit('Source fixed: ' + snapshot.original.name + '. In the preview, select only the garment or material.');
      return view();
    }),
    useMask: (source, settings = {}) => task(async () => {
      requireSource();
      if (preview.committed || preview.recipe) throw new Error('Choose New variant before changing the material mask.');
      if (adapter.inspect().id !== preview.documentId) throw new Error('Activate the bound product preview before capturing its material mask.');
      const candidate = await adapter.acquireMask(preview.documentId, source || { kind: 'selection' });
      const measured = measureMaterial(baseline, candidate);
      if (!measured.available) throw new Error(measured.reason);
      await freshPreview(candidate); // Retain the captured outline in the new preview.
      mask = candidate; sourceStats = measured;
      material = settings.material || 'MATTE'; analysis = null; analysisTarget = null; localMasks = null;
      for (const target of targets.values()) { target.recipe = null; target.quality = null; target.review = null; target.methodReviews = []; }
      emit('Material mask captured. Browse the approved library and choose Apply Color on a reference.');
    }),
    maskSources: () => { requireSource(); return adapter.maskSources(preview.documentId); },
    chooseReference: (reference, documentId) => task(async () => {
      requireSource();
      if (!reference || !reference.clientId || !reference.colorId || !reference.referenceId || !reference.versionId
        || !referenceIsCurrent(reference)) throw new Error('Choose a current approved reference from the client library.');
      const doc = adapter.inspect(documentId);
      if ([snapshot.documentId, snapshot.original.id, preview.documentId].includes(doc.id)
        || outputs.some(output => output.documentId === doc.id)) throw new Error('A product or result cannot be used as the approved reference.');
      adapter.markReference(doc.id);
      const signature = adapter.fingerprintPixels ? await adapter.fingerprintPixels(doc.id) : frameSignature(await adapter.readPixels(doc.id));
      const id = key(reference), previous = targets.get(id);
      if (!previous || previous.reference.checksumSha256 !== reference.checksumSha256) {
        targets.set(id, { reference: clone(reference), referenceDocument: doc, referenceSignature: signature, measurement: null, recipe: null, quality: null, review: null, methodReviews: [] });
      } else {
        previous.referenceDocument = doc;
        if (previous.referenceSignature !== signature) { previous.measurement = null; previous.recipe = null; previous.quality = null; previous.review = null; previous.methodReviews = []; }
        previous.referenceSignature = signature;
      }
      if (selected !== id || preview.recipe || preview.committed) await freshPreview();
      selected = id;
      // Creating the preview must not steal the reference while the designer samples.
      await adapter.activateDocument(doc.id);
      emit('Target: ' + reference.colorName + '. Select representative diffuse fabric in the opened reference, then Sample reference.');
    }),
    selectTarget: id => task(async () => {
      requireSource();
      if (!targets.has(id)) throw new Error('Choose a sampled target from this session.');
      await freshPreview(); selected = id;
      const target = targets.get(id);
      if (target.recipe && mask) {
        targetForRender(); const matching = clone(target.quality && target.quality.matching);
        await render(target, target.recipe);
        if (matching) target.quality.matching = matching;
      }
      emit('Target selected. Preview uses the frozen original; its previous settings are retained.');
    }),
    sampleReference: () => task(async () => {
      const target = targets.get(selected);
      if (!target) throw new Error('Choose Apply Color on an approved reference first.');
      if (!referenceIsCurrent(target.reference)) throw new Error('Sync and select the current approved reference again.');
      const doc = adapter.inspect();
      if (doc.id !== target.referenceDocument.id) throw new Error('Activate the selected approved reference document before sampling.');
      if (!doc.profile || doc.profile === 'None') throw new Error('Interpret the untagged reference profile explicitly in Photoshop before sampling.');
      const selection = await adapter.acquireMask(doc.id, { kind: 'selection' });
      const currentSignature = adapter.fingerprintPixels ? await adapter.fingerprintPixels(doc.id) : frameSignature(await adapter.readPixels(doc.id));
      if (currentSignature !== target.referenceSignature) throw new Error('The reference image was edited after opening. Reopen its approved file before sampling.');
      const pixels = await adapter.readPixels(doc.id, 1024);
      const measured = measureMaterial(pixels, selection);
      if (!measured.available) throw new Error(measured.reason);
      target.measurement = { id: selected, name: target.reference.colorName, revision: 1, material: 'MATTE',
        measurementSpace: measured.measurementSpace, diffuseLab: measured.diffuseLab, lightness: measured.lightness, zones: measured.zones,
        sample: { referencePixelsSha256: target.referenceSignature, selectionSha256: signature(selection) },
        approvedReference: clone(target.reference), preparationStatus: 'DESIGNER_SESSION_SAMPLE' };
      target.sampledHistoryId = doc.historyId; target.recipe = null; target.quality = null; target.review = null; target.methodReviews = []; previewReady = false;
      await adapter.activateDocument(preview.documentId);
      emit('Reference sampled. Choose Preview color to compare native Photoshop recoloring methods.');
    }),
    preview: (method = 'AUTO') => task(async () => {
      const target = targetForRender();
      if (method !== 'AUTO' && !METHODS.includes(method)) throw new Error('Choose a supported recoloring method.');
      if (preview.committed) await freshPreview();
      const previous = previewReady ? { recipe: clone(target.recipe), quality: clone(target.quality), showingAfter } : null;
      emit('Analyzing fabric color, lighting, texture and exposure...');
      const engine = engineFor(target), transition = analysis.transition;
      const budget = transition.demanding ? 160 : 96;
      signal = { aborted: false }; emit();
      try {
        const result = await engine.fit(analysis, {
          requestedMethod: method, maxEvaluations: budget, signal,
          onProgress: p => emit((analysis.risks.length ? analysis.risks[0] + '. ' : '')
            + (p.phase === 'VERIFYING' ? 'Checking full-resolution fabric and protected pixels: tile ' + p.tiles
              : 'Matching color in Photoshop: ' + p.evaluations + '/' + p.budget + '. Cancel is available.'))
        });
        target.recipe = clone(result.recipe); target.quality = result.quality;
        target.quality.matching = { version: 'fabric-constrained-selection-1', solidColorFill: result.recipe.method === 'A',
          requestedMethod: method, transition, budget, evaluations: result.evaluations, methods: clone(result.comparison), selection: result.selection };
        target.review = { requestedMethod: method, transition, manuallyAdjusted: false };
        const reviewed = { requestedMethod: method, method: result.recipe.method, quality: clone(target.quality) };
        target.methodReviews = (target.methodReviews || []).filter(item => item.requestedMethod !== method).concat(reviewed);
        showingAfter = true; previewReady = true;
      } catch (error) {
        // A search trial is never an accepted preview. Restore the last
        // completed recipe on cancel/failure before enabling Apply again.
        previewReady = false;
        if (previous) {
          try {
            await evaluate(previous.recipe);
            target.recipe = previous.recipe; target.quality = previous.quality; previewReady = true;
            showingAfter = previous.showingAfter;
            if (!showingAfter) await adapter.toggle(preview, false);
          } catch (_) { previewReady = false; }
        }
        throw error;
      } finally { signal = null; }
      emit('Preview ready. Inspect color, fabric detail and edges, then Apply Color to keep an editable result.');
      return view();
    }),
    update: parameters => task(async () => {
      const target = targetForRender();
      if (!previewReady || !target.recipe || preview.committed) throw new Error('Preview a new variant before adjusting its controls.');
      const recipe = clone(target.recipe);
      const supported = ['intensity', 'lightness', 'contrast', 'shadows', 'highlights', 'chromaA', 'chromaB', 'balanceCyanRed', 'balanceMagentaGreen', 'balanceYellowBlue'];
      for (const [name, value] of Object.entries(parameters)) {
        if (!supported.includes(name)) throw new Error('Unsupported designer control.');
        recipe.parameters[name] = value;
      }
      validateRecipe(recipe);
      const matching = clone(target.quality && target.quality.matching);
      await render(target, recipe);
      if (matching) target.quality.matching = matching;
      if (target.review) target.review.manuallyAdjusted = true;
      const reviewed = (target.methodReviews || []).find(item => item.requestedMethod === (target.review && target.review.requestedMethod));
      if (reviewed) reviewed.quality = clone(target.quality);
      emit('Manual adjustments previewed. Apply Color keeps this result.');
    }),
    toggle: () => task(async () => {
      targetForRender();
      if (!previewReady || preview.committed) throw new Error('Create a completed preview before comparing.');
      await adapter.toggle(preview, !showingAfter); showingAfter = !showingAfter; emit();
    }),
    newVariant: () => task(async () => { requireSource(); await freshPreview(); emit('New independent variant. Preview the selected target or choose another approved color.'); }),
    apply: (settings = {}) => task(async () => {
      const target = targetForRender();
      if (!previewReady || !preview.recipe || preview.recipe.target.id !== selected || preview.committed) throw new Error('Preview the selected color before applying.');
      // Compare the recolored appearance even if the Before toggle is active.
      if (!showingAfter) { await adapter.toggle(preview, true); showingAfter = true; }
      let integrity;
      if (preview.recipe.schemaVersion === 2) {
        const engine = engineFor(target);
        const report = await engine.verify(analysis, { recipe: target.recipe, quality: target.quality });
        target.quality.report = report;
        if (report.verdict === 'INTEGRITY_FAILURE') throw new Error('Protected pixels or native ownership changed; this preview cannot be applied.');
        if (report.verdict !== 'CHECKS_PASSED' && settings.reviewOverride !== true) throw Object.assign(new Error('This preview needs review. Correct it or explicitly choose Apply as reviewed draft.'), { code: 'REVIEW_OVERRIDE_REQUIRED' });
        integrity = report.metrics;
      } else integrity = compareFrames(await adapter.readPixels(snapshot.documentId), await adapter.readPixels(preview.documentId), mask);
      if (integrity.critical) throw new Error('Pixels outside the material mask changed. Keep this preview for inspection; it cannot be applied automatically.');
      const manifest = await adapter.commit(preview);
      manifest.quality = clone(target.quality); manifest.fullResolutionIntegrity = integrity;
      manifest.previewReview = clone(target.review);
      manifest.analysis = analysis ? publicAnalysis(analysis) : null;
      manifest.reviewOverride = target.quality.report && target.quality.report.verdict !== 'CHECKS_PASSED'
        ? { explicit: true, reviewedAt: new Date().toISOString(), unresolved: clone(target.quality.report.issues), risks: clone(target.quality.report.risks) } : null;
      manifest.libraryReference = clone(target.reference); manifest.productionQualified = false;
      outputs.push(manifest);
      emit('Editable result kept in Photoshop. Save its PSD/PSB, or start another independent variant.');
      return clone(manifest);
    }),
    save,
    feedback: input => task(async () => {
      const target = targetForRender();
      if (!previewReady || !target.recipe || !recordFeedback) throw new Error('Complete a preview before recording local feedback.');
      const result = await recordFeedback({ ...input, recipe: clone(target.recipe), report: clone(target.quality.report), analysis: publicAnalysis(analysis) });
      emit('Review recorded locally. Calibration does not change during this session.');
      return result;
    }),
    saveJpeg: (file, manifestFolder) => save(file, manifestFolder, { format: 'jpeg' }),
    cancelFit: () => { if (signal) { signal.aborted = true; emit('Cancelling after the current Photoshop operation.'); } },
    end: () => task(async () => {
      // All results and previews remain open: ending a session never discards work.
      if (snapshot) { try { await adapter.releaseSource(snapshot); } catch (_) { /* Preserve native edits. */ } }
      snapshot = null; preview = null; baseline = null; mask = null; sourceStats = null; selected = null;
      targets.clear(); outputs.length = 0;
      sourceRecovered = false; previewReady = false;
      analysis = null; analysisTarget = null; localMasks = null;
      emit('Session ended. Existing result and preview documents remain open. Activate a new product to begin.');
    })
  };
}

module.exports = { createPilotSession };
