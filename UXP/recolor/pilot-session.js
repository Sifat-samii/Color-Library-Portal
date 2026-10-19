const { measureMaterial, evaluateRender, compareFrames } = require('./quality');
const { createCandidates, validateRecipe } = require('./recipes');
const { fit } = require('./fitting');
const sha256 = require('./vendor/sha256');

function frameSignature(frame) {
  return sha256.create().update(JSON.stringify([frame.width, frame.height, frame.components, frame.maximum, frame.profile, frame.bounds]))
    .update(new Uint8Array(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength)).hex();
}

// Workstation-only session. Catalog approval remains owned by the library.
function createPilotSession({ adapter, referenceIsCurrent = () => true, onChange = () => {} }) {
  let snapshot = null, preview = null, baseline = null, mask = null, sourceStats = null;
  let selected = null, busy = false, signal = null, showingAfter = true;
  let sourceRecovered = false;
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
      rendered: Boolean(preview && preview.recipe && preview.recipe.target.id === selected),
      recipe: clone(target && target.recipe), quality: clone(target && target.quality),
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
        if (frameSignature(await adapter.readPixels(recovered.documentId, 640)) !== frameSignature(baseline)) {
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
    preview = next; showingAfter = true;
    if (selection) await adapter.showMaterialSelection(preview, selection);
    if (previous && !previous.committed) {
      try { await adapter.cancel(previous); }
      catch (error) { if (!['MANUAL_EDITS', 'DOCUMENT_CLOSED'].includes(error.code)) throw error; }
    }
  }
  async function render(target, recipe) {
    const native = await adapter.render(preview, recipe, mask);
    const quality = evaluateRender(baseline, await adapter.readPixels(preview.documentId, 640), mask, recipe.target);
    quality.targetGamutClipped = native.targetGamutClipped;
    target.recipe = clone(recipe); target.quality = quality; showingAfter = true;
    emit('Preview updated. Check the Photoshop canvas at 100% before applying.');
    return quality;
  }
  return {
    view,
    begin: documentId => task(async () => {
      if (snapshot) throw new Error('End this source session before choosing another product. Saved and edited results stay open.');
      const captured = await adapter.captureSource(documentId);
      snapshot = captured;
      try {
        baseline = await adapter.readPixels(snapshot.documentId, 640);
        await freshPreview();
      } catch (error) {
        try { await adapter.releaseSource(snapshot); } catch (_) { /* Preserve edited source. */ }
        snapshot = null; baseline = null; preview = null;
        throw error;
      }
      emit('Source fixed: ' + snapshot.original.name + '. In the preview, select only the garment or material.');
      return view();
    }),
    useMask: source => task(async () => {
      requireSource();
      if (preview.committed || preview.recipe) throw new Error('Choose New variant before changing the material mask.');
      if (adapter.inspect().id !== preview.documentId) throw new Error('Activate the bound product preview before capturing its material mask.');
      const candidate = await adapter.acquireMask(preview.documentId, source || { kind: 'selection' });
      const measured = measureMaterial(baseline, candidate);
      if (!measured.available) throw new Error(measured.reason);
      await freshPreview(candidate); // Retain the captured outline in the new preview.
      mask = candidate; sourceStats = measured;
      for (const target of targets.values()) { target.recipe = null; target.quality = null; }
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
      const signature = frameSignature(await adapter.readPixels(doc.id));
      const id = key(reference), previous = targets.get(id);
      if (!previous || previous.reference.checksumSha256 !== reference.checksumSha256) {
        targets.set(id, { reference: clone(reference), referenceDocument: doc, referenceSignature: signature, measurement: null, recipe: null, quality: null });
      } else {
        previous.referenceDocument = doc;
        if (previous.referenceSignature !== signature) { previous.measurement = null; previous.recipe = null; previous.quality = null; }
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
      if (target.recipe && mask) { targetForRender(); await render(target, target.recipe); }
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
      const pixels = await adapter.readPixels(doc.id);
      if (frameSignature(pixels) !== target.referenceSignature) throw new Error('The reference image was edited after opening. Reopen its approved file before sampling.');
      const measured = measureMaterial(pixels, selection);
      if (!measured.available) throw new Error(measured.reason);
      target.measurement = { id: selected, name: target.reference.colorName, revision: 1, material: 'MATTE',
        measurementSpace: measured.measurementSpace, diffuseLab: measured.diffuseLab, lightness: measured.lightness,
        approvedReference: clone(target.reference), preparationStatus: 'DESIGNER_SESSION_SAMPLE' };
      target.sampledHistoryId = doc.historyId; target.recipe = null; target.quality = null;
      await adapter.activateDocument(preview.documentId);
      emit('Reference sampled. Choose Preview color to compare native Photoshop recoloring methods.');
    }),
    preview: (method = 'AUTO') => task(async () => {
      const target = targetForRender();
      if (preview.committed) await freshPreview();
      if (method === 'AUTO' && target.recipe && !preview.recipe) {
        await render(target, target.recipe);
      } else if (method === 'AUTO') {
        signal = { aborted: false }; emit();
        try {
          const result = await fit(sourceStats, target.measurement, recipe => render(target, recipe), {
            includeTintedBlackWhite: true, maxEvaluations: 18, signal,
            onProgress: p => emit('Matching color in Photoshop: ' + p.evaluations + '/' + p.budget + '. Cancel is available.')
          });
          target.recipe = clone(result.recipe); target.quality = result.quality;
        } finally { signal = null; }
      } else {
        const recipe = createCandidates(sourceStats, target.measurement, { includeTintedBlackWhite: true }).find(v => v.method === method);
        if (!recipe) throw new Error('Choose a supported recoloring method.');
        await render(target, recipe);
      }
      emit('Preview ready. Inspect color, fabric detail and edges, then Apply Color to keep an editable result.');
      return view();
    }),
    update: parameters => task(async () => {
      const target = targetForRender();
      if (!target.recipe || preview.committed) throw new Error('Preview a new variant before adjusting its controls.');
      const recipe = clone(target.recipe);
      const supported = ['intensity', 'lightness', 'contrast', 'shadows', 'highlights'];
      for (const [name, value] of Object.entries(parameters)) {
        if (!supported.includes(name)) throw new Error('Unsupported designer control.');
        recipe.parameters[name] = value;
      }
      validateRecipe(recipe); await render(target, recipe);
    }),
    toggle: () => task(async () => {
      targetForRender();
      await adapter.toggle(preview, !showingAfter); showingAfter = !showingAfter; emit();
    }),
    newVariant: () => task(async () => { requireSource(); await freshPreview(); emit('New independent variant. Preview the selected target or choose another approved color.'); }),
    apply: () => task(async () => {
      const target = targetForRender();
      if (!preview.recipe) throw new Error('Preview the selected color before applying.');
      // Compare the recolored appearance even if the Before toggle is active.
      if (!showingAfter) { await adapter.toggle(preview, true); showingAfter = true; }
      const integrity = compareFrames(await adapter.readPixels(snapshot.documentId), await adapter.readPixels(preview.documentId), mask);
      if (integrity.critical) throw new Error('Pixels outside the material mask changed. Keep this preview for inspection; it cannot be applied automatically.');
      const manifest = await adapter.commit(preview);
      manifest.quality = clone(target.quality); manifest.fullResolutionIntegrity = integrity;
      manifest.libraryReference = clone(target.reference); manifest.productionQualified = false;
      outputs.push(manifest);
      emit('Editable result kept in Photoshop. Save its PSD/PSB, or start another independent variant.');
      return clone(manifest);
    }),
    save: (file, manifestFolder) => task(async () => {
      const output = outputs.find(v => preview && v.documentId === preview.documentId);
      if (!output) throw new Error('Apply Color before saving the editable master.');
      const protectedPaths = [snapshot.original.path, ...[...targets.values()].flatMap(t => [t.referenceDocument.path, t.reference.originalAssetPath])].filter(Boolean);
      const saved = await adapter.saveMaster(output.documentId, file, protectedPaths);
      const record = { ...output, output: saved.path, savedAt: new Date().toISOString(), productionQualified: false };
      output.savedPath = saved.path;
      try {
        const manifestFile = await manifestFolder.createFile(output.sessionId + '-' + Date.now() + '.json', { overwrite: false });
        await manifestFile.write(JSON.stringify(record, null, 2)); output.manifestPath = manifestFile.nativePath;
      } catch (error) { throw new Error('Master saved at ' + saved.path + ', but its session record could not be saved: ' + error.message); }
      emit('Layered Adobe RGB master saved. You can continue normal Photoshop editing.');
      return clone(record);
    }),
    cancelFit: () => { if (signal) { signal.aborted = true; emit('Cancelling after the current Photoshop operation.'); } },
    end: () => task(async () => {
      // All results and previews remain open: ending a session never discards work.
      if (snapshot) { try { await adapter.releaseSource(snapshot); } catch (_) { /* Preserve native edits. */ } }
      snapshot = null; preview = null; baseline = null; mask = null; sourceStats = null; selected = null;
      targets.clear(); outputs.length = 0;
      sourceRecovered = false;
      emit('Session ended. Existing result and preview documents remain open. Activate a new product to begin.');
    })
  };
}

module.exports = { createPilotSession };
