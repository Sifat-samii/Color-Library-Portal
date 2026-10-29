const { ADOBE_RGB, SRGB, rgbToLab } = require("./color");
const { ADJUSTMENT_METHODS, createCandidates, adjustRecipe } = require("./recipes");
const { fit } = require("./fitting");
const { measureMaterial, compareFrames, evaluateRender } = require("./quality");
const { createPhotoshopAdapter, executeChecked } = require("./photoshop-adapter");
const { createSourcePreparation } = require("./source-preparation");
const { fingerprintFile } = require("./file-identity");
const { createPilotSession } = require("./pilot-session");
const { chooseOutputFiles } = require("./output-files");

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
async function runHostTests(photoshop, uxp, folder, options = {}) {
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
    if (options.caseNames && !options.caseNames.includes(name)) return;
    require('fs').writeFileSync(folder.url + '/progress.json', JSON.stringify({ current: name, completed: cases.map(({ name, status, milliseconds }) => ({ name, status, milliseconds })) }));
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
    await run('Rendering targets RGB when an alpha channel is selected in an owned preview', async () => {
      const doc = await fixture();
      const group = await doc.createLayerGroup({ name: 'Owned source notes' });
      const note = await doc.createPixelLayer({ name: 'Owned note' });
      await note.move(group, photoshop.constants.ElementPlacement.PLACEINSIDE);
      await doc.selection.selectRectangle({ left: 12, top: 10, right: 84, bottom: 54 });
      await doc.selection.save('Owned alpha context');
      const source = await adapter.captureSource(doc.id); owned.add(source.documentId);
      const baseline = await adapter.readPixels(source.documentId);
      const preview = await adapter.createPreview(source); owned.add(preview.documentId);
      await executeChecked(photoshop, [{ _obj: 'select', _target: [{ _ref: 'channel', _name: 'Owned alpha context' }] }]);
      preview.expectedToken = JSON.stringify(adapter.inspect(preview.documentId));
      const recipe = createCandidates(measureMaterial(baseline, mask), { id: 'alpha-context', material: 'MATTE', measurementSpace: 'CIELAB D50 2deg', diffuseLab: [60, 10, -10] })[0];
      await adapter.render(preview, recipe, mask);
      assert(compareFrames(baseline, await adapter.readPixels(preview.documentId), mask).protectedPixelsChanged === 0, 'Alpha context changed protected material');
      return { alphaContextHandled: true };
    });
    await run('Transparent canvas margins receive complete native tile and master verification', async () => {
      const { analyze } = require('./fabric-analysis'), fabric = require('./fabric-recipes');
      const { evaluate } = require('./fabric-quality'), { createRecolorEngine } = require('./recolor-engine');
      const doc = await addOwnedDocument(photoshop, { name: 'Owned transparent fabric canvas', width: 1320, height: 1120,
        resolution: 72, mode: photoshop.constants.NewDocumentMode.RGB, fill: photoshop.constants.DocumentFill.TRANSPARENT, depth: 16, profile: ADOBE_RGB }, owned);
      const data = new Uint16Array(64 * 64 * 3);
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) for (let c = 0; c < 3; c++) data[(y * 64 + x) * 3 + c] = Math.round((80 + x / 4 + Math.sin(y) * 3) * 257);
      const pixels = await photoshop.imaging.createImageDataFromBuffer(data, { width: 64, height: 64, components: 3, colorSpace: 'RGB', colorProfile: ADOBE_RGB, fullRange: true });
      try { await photoshop.imaging.putPixels({ documentID: doc.id, layerID: doc.layers[0].id, imageData: pixels, replace: true, targetBounds: { left: 400, top: 400 } }); }
      finally { pixels.dispose(); }
      const original = adapter.inspect(doc.id), source = await adapter.captureSource(doc.id); owned.add(source.documentId);
      const mask = { left: 400, top: 400, width: 64, height: 64, maximum: 255, data: new Uint8Array(4096).fill(255) };
      const before = await adapter.readPixels(source.documentId, 1024), target = { id: 'transparent-fabric', material: 'MATTE', ...measureMaterial(before, mask) };
      const analysis = analyze({ source: before, mask, target, canvasBounds: { left: 0, top: 0, right: 1320, bottom: 1120 } });
      const preview = await adapter.createPreview(source); owned.add(preview.documentId);
      const recipe = fabric.candidates(analysis, ['A'])[0];
      await adapter.render(preview, recipe, mask);
      const quality = evaluate(before, await adapter.readPixels(preview.documentId, 1024), mask, analysis);
      const engine = createRecolorEngine({ sourceDocumentId: source.documentId, previewDocumentId: preview.documentId,
        readPixels: (...args) => adapter.readPixels(...args), readRegion: (...args) => adapter.readRegion(...args), assertCurrent: () => adapter.assertCurrent(preview) });
      const report = await engine.verify(analysis, { recipe, quality });
      assert(report.metrics.protectedPixelsCompared === 1320 * 1120 - 4096, 'Transparent margins were omitted from verification');
      assert(report.metrics.protectedPixelsChanged === 0, 'Transparent margin changed');
      await adapter.commit(preview);
      const saved = await adapter.saveMaster(preview.documentId, await folder.createFile('transparent-fabric-verified.psb', { overwrite: false }));
      assert(saved.verification.pixelsCompared === 1320 * 1120, 'Master verification omitted transparent margins');
      assert(JSON.stringify(adapter.inspect(doc.id)) === JSON.stringify(original), 'Transparent source changed');
      return { tiles: report.metrics.tiles, protectedPixelsCompared: report.metrics.protectedPixelsCompared, master: saved };
    });
    for (const method of ['A', 'B', 'C', 'D']) await run('Fabric v2 ' + method + ' uses editable color/tone and local masks with verified master round trip', async () => {
      const { analyze } = require('./fabric-analysis');
      const fabric = require('./fabric-recipes');
      const doc = await fixture(), original = adapter.inspect(doc.id);
      const frozen = await adapter.captureSource(doc.id); owned.add(frozen.documentId);
      const before = await adapter.readPixels(frozen.documentId, 1024);
      const target = { id: 'synthetic-fabric-aqua', name: 'Synthetic aqua', measurementSpace: 'CIELAB D50 2deg', material: 'MATTE', diffuseLab: [86, -16, -8] };
      const analysis = analyze({ source: before, mask, target }), recipe = fabric.candidates(analysis, [method])[0];
      const preview = await adapter.createPreview(frozen); owned.add(preview.documentId);
      const local = fabric.zoneMasks(analysis);
      await adapter.render(preview, recipe, mask, local);
      adapter.assertCurrent(preview);
      const first = await adapter.readPixels(preview.documentId);
      assert(compareFrames(before, first, mask).protectedPixelsChanged === 0, 'Fabric recipe changed protected pixels');
      const groupId = preview.groupId;
      let queuedRenders = 0;
      const update = require('./fitting').latestQueue(async value => { queuedRenders++; await adapter.render(preview, adjustRecipe(recipe, 'lightness', value), mask, local); }, { delayMs: 180 });
      const updates = [];
      for (let i = 0; i < 500; i++) updates.push(update(i === 499 ? -2 : i % 5));
      await Promise.all(updates);
      assert(queuedRenders === 1, 'Rapid slider requests did not coalesce');
      assert(preview.groupId === groupId, 'V2 live update rebuilt the group');
      assert(adapter.nativeLayers(preview.documentId).some(layer => /colorBalance/i.test(layer.kind)), 'Missing editable undertone correction');
      if (recipe.localCorrections.enabled) {
        for (const role of ['shadowLocal', 'highlightLocal']) {
          const actual = await adapter.acquireMask(preview.documentId, { kind: 'layerMask', layerId: preview.roles[role] });
          assert(actual.data.some(value => value > 0) && actual.data.some(value => value < actual.maximum), 'Local correction mask has no tonal range');
        }
        // Mask inspection can change selection history. Preserve only our own verified fixture revision.
        preview.expectedToken = JSON.stringify(adapter.inspect(preview.documentId));
      }
      await adapter.commit(preview);
      const saved = await adapter.saveMaster(preview.documentId, await folder.createFile('fabric-v2-' + method + '.psd', { overwrite: false }));
      assert(saved.verified && saved.verification.fullResolution, 'Master was not verified at full resolution');
      assert(JSON.stringify(adapter.inspect(doc.id)) === JSON.stringify(original), 'Original fixture changed');
      return { method, schemaVersion: 2, protectedPixelsChanged: 0, sliderEvents: 500, queuedRenders, localCorrections: recipe.localCorrections.enabled, master: saved };
    });
    await run('Changed internal source recovers from the unchanged original and restores an inspectable soft selection', async () => {
      const source = await fixture(), original = adapter.inspect(source.id);
      const snapshot = await adapter.captureSource(source.id); owned.add(snapshot.documentId);
      await executeChecked(photoshop, [{ _obj: 'select', _target: [{ _ref: 'document', _id: snapshot.documentId }] }]);
      const edited = Array.from(photoshop.app.documents).find(doc => doc.id === snapshot.documentId);
      await edited.selection.selectRectangle({ left: 8, top: 8, right: 40, bottom: 40 });
      let guarded = false;
      try { await adapter.createPreview(snapshot); } catch (error) { guarded = error.code === 'FROZEN_SOURCE_CHANGED'; }
      assert(guarded, 'An edited frozen source was not rejected');
      const recovered = await adapter.recoverSource(snapshot); owned.add(recovered.documentId);
      assert(Array.from(photoshop.app.documents).some(doc => doc.id === edited.id), 'Edited internal source was discarded');
      const preview = await adapter.createPreview(recovered); owned.add(preview.documentId);
      const material = { left: 12, top: 10, width: 24, height: 16, maximum: 65535, data: new Uint16Array(24 * 16).fill(65535) };
      for (let y = 0; y < material.height; y++) material.data[y * material.width] = 21845;
      await adapter.showMaterialSelection(preview, material);
      const restored = await adapter.acquireMask(preview.documentId, { kind: 'selection' });
      assert(restored.left === material.left && restored.top === material.top && restored.width === material.width && restored.height === material.height, 'Displayed selection lost material coordinates');
      assert(restored.data.every((value, index) => Math.abs(value / restored.maximum - material.data[index] / material.maximum) <= 1 / 255), 'Displayed selection lost soft coverage');
      const zero = { left: 0, top: 0, width: 1, height: 1, maximum: 255, data: new Uint8Array([0]) };
      const pixels = compareFrames(await adapter.readPixels(source.id), await adapter.readPixels(preview.documentId), zero);
      assert(pixels.protectedPixelsChanged === 0, 'Source recovery or selection display changed image pixels');
      assert(JSON.stringify(adapter.inspect(source.id)) === JSON.stringify(original), 'Recovery changed the original source');
      source.layers[0].name = 'Synthetic original edit';
      let refused = false;
      try { await adapter.recoverSource(snapshot); } catch (error) { refused = error.code === 'ORIGINAL_SOURCE_CHANGED'; }
      assert(refused, 'Changed original source was silently recaptured');
      return { editedCopyRetained: true, originalPreserved: true, protectedPixelsChanged: pixels.protectedPixelsChanged,
        selectionCoordinatesPreserved: true, softSelectionPreservedWithin: '1/255 native selection precision', changedOriginalRejected: true };
    });
    await run('Large dark-to-light and light-to-dark pilot transitions compare real renders and apply the current manual recipe', async () => {
      const results = [];
      for (const [sourceLevel, targetLevel, direction] of [[35, 220, 'DARK_TO_LIGHT'], [220, 35, 'LIGHT_TO_DARK']]) {
        const source = await fixture(), reference = await fixture();
        for (const [doc, level] of [[source, sourceLevel], [reference, targetLevel]]) {
          const data = new Uint16Array(96 * 64 * 3);
          for (let y = 0; y < 64; y++) for (let x = 0; x < 96; x++) {
            const shade = 0.68 + x / 96 * 0.28 + 0.025 * Math.sin(x * 2) * Math.cos(y * 2);
            for (let c = 0; c < 3; c++) data[(y * 96 + x) * 3 + c] = Math.round(level * shade / 255 * 65535);
          }
          const image = await photoshop.imaging.createImageDataFromBuffer(data, { width: 96, height: 64, components: 3,
            colorSpace: 'RGB', colorProfile: ADOBE_RGB, fullRange: true });
          try { await photoshop.imaging.putPixels({ documentID: doc.id, layerID: doc.layers[0].id, imageData: image, replace: true }); }
          finally { image.dispose(); }
        }
        const pilotAdapter = { ...adapter,
          captureSource: async (...args) => { const value = await adapter.captureSource(...args); owned.add(value.documentId); return value; },
          createPreview: async (...args) => { const value = await adapter.createPreview(...args); owned.add(value.documentId); return value; } };
        const pilot = createPilotSession({ adapter: pilotAdapter });
        await pilot.begin(source.id);
        const product = Array.from(photoshop.app.documents).find(doc => doc.id === pilot.view().previewDocumentId);
        await product.selection.selectRectangle({ left: 12, top: 10, right: 84, bottom: 54 });
        await pilot.useMask({ kind: 'selection' });
        await pilot.chooseReference({ clientId: 'synthetic', colorId: direction, referenceId: 'stress', versionId: '1', colorName: direction }, reference.id);
        await reference.selection.selectRectangle({ left: 12, top: 10, right: 84, bottom: 54 });
        await pilot.sampleReference(); await pilot.preview();
        const automatic = pilot.view();
        assert(automatic.previewReview.transition.direction === direction, 'Incorrect lightness transition');
        assert(automatic.quality.matching.budget === 160, 'Extreme transition did not receive extended fitting');
        assert(automatic.quality.matching.methods.map(entry => entry.method).sort().join(',') === 'A,B,C,D', 'Extreme transition skipped a method');
        assert(Number.isFinite(automatic.quality.score), 'Extreme transition was not measured');
        assert(automatic.quality.anchorDeltaE00 < 3, 'Extreme transition did not reach the target color: ' + automatic.quality.anchorDeltaE00);
        assert(automatic.quality.integrity.normalizedDetailRatio > 0.75, 'Extreme transition lost source detail');
        assert(automatic.quality.integrity.addedClippingFraction < 0.01, 'Extreme transition clipped source tones');
        await pilot.update({ lightness: automatic.recipe.parameters.lightness + (automatic.recipe.parameters.lightness < 59 ? 1 : -1), intensity: 95 });
        const manual = pilot.view();
        const output = await pilot.apply({ reviewOverride: true });
        assert(JSON.stringify(output.recipe) === JSON.stringify(manual.recipe), 'Apply changed the current manual recipe');
        assert(output.previewReview.manuallyAdjusted && output.previewReview.requestedMethod === 'AUTO', 'Apply lost automatic/manual attribution');
        assert(output.fullResolutionIntegrity.protectedPixelsChanged === 0, 'Extreme transition escaped the material mask');
        results.push({ direction, automatic: { method: automatic.recipe.method, quality: automatic.quality }, manual: manual.quality,
          appliedRecipeMatches: true, protectedPixelsChanged: output.fullResolutionIntegrity.protectedPixelsChanged });
        await pilot.end();
      }
      return results;
    });
    await run('Integrated pilot samples an approved image, fits independent variants and reopens an editable master', async () => {
      const source = await fixture(), sourceBefore = adapter.inspectSource(source.id);
      const reference = await fixture();
      const data = new Uint16Array(96 * 64 * 3);
      for (let p = 0; p < 96 * 64; p++) for (let c = 0; c < 3; c++) data[p * 3 + c] = [125, 45, 75][c] * 257;
      const image = await photoshop.imaging.createImageDataFromBuffer(data, { width: 96, height: 64, components: 3, colorSpace: 'RGB', colorProfile: ADOBE_RGB, fullRange: true });
      try { await photoshop.imaging.putPixels({ documentID: reference.id, layerID: reference.layers[0].id, imageData: image, replace: true }); }
      finally { image.dispose(); }
      const pilotAdapter = { ...adapter,
        captureSource: async (...args) => { const value = await adapter.captureSource(...args); owned.add(value.documentId); return value; },
        createPreview: async (...args) => { const value = await adapter.createPreview(...args); owned.add(value.documentId); return value; } };
      const pilot = createPilotSession({ adapter: pilotAdapter });
      await pilot.begin(source.id);
      const previewDoc = Array.from(photoshop.app.documents).find(doc => doc.id === pilot.view().previewDocumentId);
      await previewDoc.selection.selectRectangle({ left: 12, top: 10, right: 84, bottom: 54 });
      await pilot.useMask({ kind: 'selection' });
      const target = { clientId: 'synthetic-client', colorId: 'wine', referenceId: 'crop', versionId: '1', colorName: 'Synthetic Wine', checksumSha256: '', filename: 'synthetic-reference' };
      await pilot.chooseReference(target, reference.id);
      await reference.selection.selectRectangle({ left: 12, top: 10, right: 84, bottom: 54 });
      await pilot.sampleReference();
      await pilot.preview('AUTO');
      assert(pilot.view().quality.matching.methods.map(value => value.method).sort().join(',') === 'A,B,C,D', 'Pilot Auto skipped a fabric candidate');
      await pilot.update({ lightness: 2 });
      const savedSettings = pilot.view().recipe.parameters.lightness;
      const wineKey = pilot.view().target.key;
      await pilot.toggle(); // Apply must compare the After rendering.
      const output = await pilot.apply({ reviewOverride: true });
      assert(output.fullResolutionIntegrity.protectedPixelsChanged === 0, 'Pilot changed protected source pixels');
      const file = await folder.createFile('integrated-pilot.psd', { overwrite: false });
      const pair = await chooseOutputFiles({ getFileForSaving: async () => file,
        getEntryWithUrl: url => uxp.storage.localFileSystem.getEntryWithUrl(url) }, file.name);
      const beforeSave = adapter.inspectSource(output.documentId), beforePixels = await adapter.readPixels(output.documentId);
      const savedPair = await pilot.save(pair.masterFile, folder, { jpegFile: pair.jpegFile });
      assert(savedPair.jpeg.verified && savedPair.jpeg.profile === SRGB, 'Paired save did not verify an sRGB JPEG');
      assert(JSON.stringify(beforeSave) === JSON.stringify(adapter.inspectSource(output.documentId)), 'Export modified editable master structure or history');
      assert((await adapter.readPixels(output.documentId)).data.every((v, i) => v === beforePixels.data[i]), 'Export changed editable master pixels');
      const jpeg = await adapter.openDocument(pair.jpegFile); owned.add(jpeg.id);
      assert(jpeg.colorProfileName === SRGB && jpeg.bitsPerChannel === photoshop.constants.BitsPerChannelType.EIGHT && jpeg.width === 96 && jpeg.height === 64, 'JPEG format/profile/dimensions differ');
      const jpegPixels = await adapter.readPixels(jpeg.id), comparable = { left: 24, top: 20, width: 48, height: 24, maximum: 255, data: new Uint8Array(48 * 24).fill(255) };
      const originalColor = measureMaterial(beforePixels, comparable), jpegColor = measureMaterial(jpegPixels, comparable);
      const { deltaE00 } = require('./color');
      const jpegDifference = deltaE00(originalColor.diffuseLab, jpegColor.diffuseLab);
      assert(jpegDifference < 2, 'JPEG differs excessively from the color-managed master: ' + jpegDifference);
      await jpeg.closeWithoutSaving(); owned.delete(jpeg.id);
      const savedIdentity = await fingerprintFile(file.url, require('fs'));
      let overwriteRejected = false;
      try { await pilot.save(file, folder); } catch (error) { overwriteRejected = /already exists/.test(error.message); }
      const afterRejectedSave = await fingerprintFile(file.url, require('fs'));
      assert(overwriteRejected && savedIdentity.sha256 === afterRejectedSave.sha256, 'Pilot overwrote an existing master');
      const psb = await folder.createFile('integrated-pilot.psb', { overwrite: false });
      await pilot.save(psb, folder);
      const master = Array.from(photoshop.app.documents).find(doc => doc.id === output.documentId);
      const expected = await adapter.readPixels(master.id);
      await master.closeWithoutSaving(); owned.delete(master.id);
      const reopened = await adapter.openDocument(file); owned.add(reopened.id);
      const layers = adapter.nativeLayers(reopened.id);
      assert(layers.some(layer => String(layer.kind).toLowerCase().includes('solidcolor')) === (output.recipe.method === 'A'), 'Reopened native layers differ from the selected method');
      assert(layers.some(layer => layer.name === 'Designer Final Touch-ups') && layers.some(layer => layer.name === 'Edge Corrections'), 'Pilot master lost editable structure');
      assert(reopened.colorProfileName === ADOBE_RGB, 'Pilot master profile did not reopen as Adobe RGB');
      const recolorGroup = layers.find(layer => layer.name.startsWith('AI Recolor'));
      assert(Boolean(recolorGroup), 'Pilot recoloring group is missing');
      const reopenedMask = await adapter.acquireMask(reopened.id, { kind: 'layerMask', layerId: recolorGroup.id });
      assert(reopenedMask.data.some(value => value === 0) && reopenedMask.data.some(value => value === reopenedMask.maximum), 'Pilot lost editable material mask coverage');
      const actual = await adapter.readPixels(reopened.id);
      assert(actual.data.every((value, index) => Math.abs(value - expected.data[index]) <= 2), 'Pilot save/reopen changed rendering');
      const reopenedPsb = await adapter.openDocument(psb); owned.add(reopenedPsb.id);
      const actualPsb = await adapter.readPixels(reopenedPsb.id);
      assert(reopenedPsb.colorProfileName === ADOBE_RGB && actualPsb.data.every((value, index) => Math.abs(value - expected.data[index]) <= 2), 'Pilot PSB profile or rendering did not survive reopening');
      await pilot.newVariant();
      await pilot.chooseReference({ ...target, colorId: 'royal', referenceId: 'full' }, reference.id);
      await pilot.sampleReference(); await pilot.preview('C');
      await pilot.selectTarget(wineKey);
      assert(pilot.view().recipe.parameters.lightness === savedSettings, 'Target controls were not retained independently');
      assert(JSON.stringify(sourceBefore) === JSON.stringify(adapter.inspectSource(source.id)), 'Pilot modified original source structure or history');
      await pilot.end();
      return { originalUnchanged: true, solidColorFill: output.recipe.method === 'A', method: output.recipe.method, protectedPixelsChanged: output.fullResolutionIntegrity.protectedPixelsChanged, reopenedEditable: true, reopenedFormats: ['PSD', 'PSB', 'JPEG'], jpeg: savedPair.jpeg, jpegDiffuseDeltaE00: jpegDifference, masterUnchangedByExport: true, editableMask: true, overwriteRefused: true, profile: reopened.colorProfileName, independentVariants: true, settingsRetained: true };
    });
    await run('Independent JPEG saving needs no PSD, and independent PSD saving creates no additional JPEG', async () => {
      const source = await fixture();
      await source.createLayerGroup({ name: 'Independent save editable fixture' });
      const before = adapter.inspectSource(source.id), beforePixels = await adapter.readPixels(source.id);
      const jpeg = await folder.createFile('independent-save.jpg', { overwrite: false });
      const saved = await adapter.saveJpeg(source.id, jpeg);
      assert(saved.verified && saved.profile === SRGB, 'Independent JPEG was not verified');
      const names = async () => (await folder.getEntries()).filter(e => /^independent-save\./.test(e.name)).map(e => e.name).sort();
      assert(JSON.stringify(await names()) === JSON.stringify(['independent-save.jpg']), 'JPEG saving created a master');
      const identity = await fingerprintFile(jpeg.url, require('fs'));
      const master = await folder.createFile('independent-save.psd', { overwrite: false });
      await adapter.saveMaster(source.id, master);
      assert(JSON.stringify(await names()) === JSON.stringify(['independent-save.jpg', 'independent-save.psd']), 'PSD save created extra outputs');
      assert((await fingerprintFile(jpeg.url, require('fs'))).sha256 === identity.sha256, 'PSD save re-exported or changed the JPEG');
      assert(JSON.stringify(before) === JSON.stringify(adapter.inspectSource(source.id)), 'Independent saves changed source history or structure');
      assert((await adapter.readPixels(source.id)).data.every((v, i) => v === beforePixels.data[i]), 'Independent saves changed source pixels');
      const reopened = await adapter.openDocument(master); owned.add(reopened.id);
      assert(reopened.layers.some(layer => layer.name === 'Independent save editable fixture') && reopened.colorProfileName === ADOBE_RGB, 'Independent master lost editable layers or profile');
      return { jpegWithoutMaster: true, masterWithoutJpegExport: true, originalPreserved: true, jpeg: saved };
    });
    await run('Paired exports matte transparency white, preserve 8/16-bit sources, and refuse JPEG collisions before writing a master', async () => {
      const results = [];
      for (const depth of [8, 16]) {
        const transparent = await addOwnedDocument(photoshop, { name: 'Owned transparent JPEG fixture ' + depth,
          width: 96, height: 64, resolution: 144, mode: photoshop.constants.NewDocumentMode.RGB,
          fill: photoshop.constants.DocumentFill.TRANSPARENT, depth, profile: ADOBE_RGB }, owned);
        const data = new Uint8Array(32 * 32 * 3).fill(120);
        const image = await photoshop.imaging.createImageDataFromBuffer(data, { width: 32, height: 32, components: 3, colorSpace: 'RGB', colorProfile: ADOBE_RGB });
        try { await photoshop.imaging.putPixels({ documentID: transparent.id, layerID: transparent.layers[0].id, imageData: image, targetBounds: { left: 32, top: 16 }, replace: true }); }
        finally { image.dispose(); }
        const before = adapter.inspectSource(transparent.id), pixelsBefore = await adapter.readPixels(transparent.id);
        const master = await folder.createFile('transparent-' + depth + '.psb', { overwrite: false });
        const jpeg = await folder.createFile('transparent-' + depth + '.jpg', { overwrite: false });
        const pair = await adapter.saveOutputs(transparent.id, master, jpeg);
        assert(JSON.stringify(before) === JSON.stringify(adapter.inspectSource(transparent.id)), 'JPEG export changed source structure, depth, profile or history');
        assert((await adapter.readPixels(transparent.id)).data.every((v, i) => v === pixelsBefore.data[i]), 'JPEG export changed transparent source pixels');
        const reopened = await adapter.openDocument(jpeg); owned.add(reopened.id);
        const frame = await adapter.readPixels(reopened.id);
        assert([0, 1, 2].every(channel => frame.data[channel] >= frame.maximum - 1), 'Transparent JPEG background did not become white');
        assert(reopened.resolution === 144 && pair.jpeg.resolution === 144, 'JPEG did not retain resolution metadata');
        await reopened.closeWithoutSaving(); owned.delete(reopened.id);
        const identity = await fingerprintFile(jpeg.url, require('fs'));
        const unusedMaster = await folder.createFile('must-not-save-' + depth + '.psd', { overwrite: false });
        let refused = false;
        try { await adapter.saveOutputs(transparent.id, unusedMaster, jpeg); } catch (error) { refused = /already exists/.test(error.message); }
        let created = false;
        try { created = (await unusedMaster.getMetadata()).size > 0; } catch (_) { /* No master should exist. */ }
        assert(refused && !created, 'JPEG collision wrote a partial master or was not refused');
        assert((await fingerprintFile(jpeg.url, require('fs'))).sha256 === identity.sha256, 'Existing JPEG was overwritten');
        let protectedRefused = false;
        const protectedFile = await folder.createFile('protected-' + depth + '.jpg', { overwrite: false });
        try { await adapter.saveOutputs(transparent.id, unusedMaster, protectedFile, [protectedFile.nativePath]); } catch (error) { protectedRefused = /protected/.test(error.message); }
        assert(protectedRefused, 'Protected source/reference JPEG path was not refused');
        results.push({ depth, sourceDocumentId: transparent.id, whiteMatte: true, unchangedSource: true, collisionRefusedBeforeMaster: true, protectedPathRefused: true, jpeg: pair.jpeg });
      }
      return { results };
    });
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
      const measuredTarget = measureMaterial(baseline, mask);
      const calibratedTarget = { ...candidates[0].target, lightness: measuredTarget.lightness, zones: measuredTarget.zones };
      const recipe = createCandidates(measuredTarget, calibratedTarget, { includeTintedBlackWhite: true }).find(v => v.method === "D");
      await adapter.render(preview, recipe, mask);
      const layers = adapter.nativeLayers(preview.documentId);
      for (const kind of ["blackAndWhite", "levels", "hueSaturation", "colorBalance"]) assert(layers.some(layer => layer.kind === kind), "Missing native " + kind + " in calibrated candidate D");
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
    await run('Adjustment-only comparison fits B/C/D against legacy Auto and preserves native detail without a Solid Color fill', async () => {
      const measured = measureMaterial(baseline, mask), target = candidates[0].target;
      const preview = await adapter.createPreview(snapshot); owned.add(preview.documentId);
      const evaluate = async recipe => {
        await adapter.render(preview, recipe, mask);
        return evaluateRender(baseline, await adapter.readPixels(preview.documentId), mask, target);
      };
      const legacy = await fit(measured, target, evaluate, { includeTintedBlackWhite: true, maxEvaluations: 18 });
      const result = await fit(measured, target, evaluate, { methods: ADJUSTMENT_METHODS,
        includeTintedBlackWhite: true, refineAllCandidates: true, maxEvaluations: 40 });
      assert(result.history.every(entry => entry.method !== 'A'), 'A fill candidate entered adjustment-only fitting');
      assert(result.comparison.map(entry => entry.method).join(',') === 'B,C,D', 'An adjustment family was not compared');
      assert(result.quality.score <= legacy.quality.score + 0.25, 'Adjustment-only matching regressed versus legacy Auto: ' + JSON.stringify({ legacy: legacy.quality, current: result.quality }));
      assert(result.quality.integrity.protectedPixelsChanged === 0, 'No-fill result changed protected pixels');
      assert(result.quality.integrity.normalizedDetailRatio > 0.5, 'No-fill result lost critical fixture detail');
      assert(result.quality.integrity.addedClippingFraction < 0.02, 'No-fill result clipped fixture tones');
      const layers = adapter.nativeLayers(preview.documentId);
      assert(!layers.some(layer => String(layer.kind).toLowerCase().includes('solidcolor')), 'No-fill comparison left a Solid Color layer');
      const actual = evaluateRender(baseline, await adapter.readPixels(preview.documentId), mask, target);
      assert(Math.abs(actual.score - result.quality.score) < 0.001, 'Comparison did not restore the measured winner');
      return { legacy: { method: legacy.recipe.method, quality: legacy.quality, evaluations: legacy.evaluations },
        adjustmentOnly: { method: result.recipe.method, quality: result.quality, evaluations: result.evaluations, comparison: result.comparison },
        layers, scope: 'Synthetic anchor/detail comparison; not a garment or human-edit benchmark' };
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
  report.technicalGatePassed = cases.length > 0 && report.failed === 0 && report.cleanupErrors.length === 0 && report.initialDocumentsPreserved && report.unexpectedNewDocumentIds.length === 0;
  return report;
}

// Modeless panel probe: unlike a standalone .psjs suite, every adapter call
// enters/releases its own modal scope while slider input continues arriving.
async function runSliderStress(photoshop, uxp, settings = {}) {
  const owned = new Set(), initialIds = Array.from(photoshop.app.documents).map(doc => doc.id);
  const prior = photoshop.app.documents.length ? photoshop.app.activeDocument.id : null;
  const width = settings.width || 1300, height = settings.height || 2000;
  const events = settings.events || 120, interval = settings.interval || 16;
  let rendered = 0, pilot;
  const base = createPhotoshopAdapter(photoshop);
  const adapter = { ...base,
    captureSource: async (...args) => { const value = await base.captureSource(...args); owned.add(value.documentId); return value; },
    createPreview: async (...args) => { const value = await base.createPreview(...args); owned.add(value.documentId); return value; },
    render: async (...args) => { const value = await base.render(...args); rendered++; return value; }
  };
  const progress = value => { if (settings.onProgress) settings.onProgress(value); };
  try {
    let source, reference;
    await photoshop.core.executeAsModal(async () => {
      for (const light of [false, true]) {
        const doc = await addOwnedDocument(photoshop, { name: 'Owned slider crash probe ' + (light ? 'reference' : 'source'),
          width, height, resolution: 72, mode: photoshop.constants.NewDocumentMode.RGB,
          fill: photoshop.constants.DocumentFill.TRANSPARENT, depth: 16, profile: ADOBE_RGB }, owned);
        const data = new Uint16Array(width * height * 3);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const shade = 0.35 + 0.6 * x / width + 0.04 * Math.sin(x * 0.4) * Math.cos(y * 0.4);
          const color = light ? [215, 220, 225] : [30, 45, 60];
          for (let c = 0; c < 3; c++) data[(y * width + x) * 3 + c] = Math.round(color[c] * shade / 255 * 65535);
        }
        const image = await photoshop.imaging.createImageDataFromBuffer(data, { width, height, components: 3,
          colorSpace: 'RGB', colorProfile: ADOBE_RGB, fullRange: true });
        try { await photoshop.imaging.putPixels({ documentID: doc.id, layerID: doc.layers[0].id, imageData: image, replace: true }); }
        finally { image.dispose(); }
        if (light) reference = doc; else source = doc;
      }
    }, { commandName: 'Prepare disposable slider stability images' });
    pilot = createPilotSession({ adapter });
    await pilot.begin(source.id);
    const select = async id => photoshop.core.executeAsModal(async () => {
      await executeChecked(photoshop, [{ _obj: 'select', _target: [{ _ref: 'document', _id: id }] }]);
      const doc = Array.from(photoshop.app.documents).find(doc => doc.id === id);
      await doc.selection.selectRectangle({ left: 100, top: 100, right: width - 100, bottom: height - 100 });
    }, { commandName: 'Select owned probe material' });
    await select(pilot.view().previewDocumentId); await pilot.useMask({ kind: 'selection' });
    await pilot.chooseReference({ clientId: 'probe', colorId: 'light', referenceId: 'synthetic', versionId: '1', colorName: 'Synthetic light fabric' }, reference.id);
    await select(reference.id); await pilot.sampleReference();
    const cycles = [];
    for (const method of settings.methods || ['C']) {
      progress({ stage: 'fit', method, rendered });
      const fitStart = rendered;
      await pilot.preview(method);
      const fittingRenders = rendered;
      const update = require('./fitting').latestQueue(parameters => pilot.update(parameters), { delayMs: settings.delayMs || 0 });
      const requests = [];
      progress({ stage: 'sliders', method, events, rendered });
      for (let index = 0; index < events; index++) {
        requests.push(update({ lightness: (index % 21) - 10, shadows: (index % 13) - 6, highlights: 6 - (index % 13) }));
        await new Promise(resolve => setTimeout(resolve, interval));
      }
      await Promise.all(requests);
      if (!pilot.view().rendered) throw new Error('Slider updates lost the completed preview');
      cycles.push({ method, events, nativeSliderRenders: rendered - fittingRenders, fittingRenders: fittingRenders - fitStart });
    }
    return { passed: true, width, height, cycles, rendered, initialDocumentIds: initialIds };
  } finally {
    if (pilot) await pilot.end().catch(() => {});
    await photoshop.core.executeAsModal(async () => {
      for (const id of owned) {
        if (initialIds.includes(id)) throw new Error('Probe attempted cleanup of an original document');
        const doc = Array.from(photoshop.app.documents).find(doc => doc.id === id);
        if (doc) await doc.closeWithoutSaving();
      }
      if (prior && Array.from(photoshop.app.documents).some(doc => doc.id === prior)) {
        await executeChecked(photoshop, [{ _obj: 'select', _target: [{ _ref: 'document', _id: prior }] }]);
      }
    }, { commandName: 'Close only owned slider probe images' });
  }
}

async function compareMaterialLighting(photoshop, uxp, folder, sourceId, references) {
  const initial = Array.from(photoshop.app.documents).map(doc => doc.id), owned = new Set();
  const prior = photoshop.app.activeDocument.id, adapter = createPhotoshopAdapter(photoshop);
  const reports = [];
  let snapshot;
  try {
    snapshot = await adapter.captureSource(sourceId); owned.add(snapshot.documentId);
    const baseline = await adapter.readPixels(snapshot.documentId, 640);
    // Deliberately an interior test patch, not an inferred garment mask.
    const mask = {left:450,top:850,width:370,height:620,maximum:255,data:new Uint8Array(370*620).fill(255)};
    const source = measureMaterial(baseline, mask);
    for (const reference of references) {
      const file = await uxp.storage.localFileSystem.getEntryWithUrl(reference.url);
      const document = await adapter.openDocument(file); owned.add(document.id);
      const targetMask = {left:620,top:600,width:280,height:400,maximum:255,data:new Uint8Array(280*400).fill(255)};
      const measured = measureMaterial(await adapter.readPixels(document.id, 640), targetMask);
      const target = {id:reference.name,name:reference.name,material:'MATTE',measurementSpace:measured.measurementSpace,
        diffuseLab:measured.diffuseLab,lightness:measured.lightness,zones:measured.zones};
      if (!source.available || !measured.available) throw new Error('Material patch was not measurable');
      const comparisons = [];
      for (const natural of [false, true]) {
        const preview = await adapter.createPreview(snapshot); owned.add(preview.documentId);
        const result = await fit(source, target, async recipe => {
          await adapter.render(preview, recipe, mask);
          return evaluateRender(baseline, await adapter.readPixels(preview.documentId, 640), mask, target, {preserveLighting:natural});
        }, {methods:ADJUSTMENT_METHODS,includeTintedBlackWhite:true,refineAllCandidates:true,maxEvaluations:64,
          demandingTransition:true,transitionAware:true,naturalLighting:natural});
        const image = await folder.createFile(reference.name.replace(/[^a-z0-9]/gi,'-')+(natural?'-natural':'-previous')+'.jpg',{overwrite:false});
        await adapter.saveJpeg(preview.documentId, image, [snapshot.original.path, file.nativePath]);
        comparisons.push({natural,method:result.recipe.method,engine:result.recipe.engineVersion,quality:result.quality,path:image.nativePath});
      }
      reports.push({reference:reference.name,comparisons});
    }
    return {scope:'Interior fabric patch on an untouched-source duplicate; not a complete garment mask or approved delivery',reports};
  } finally {
    if (snapshot) await adapter.releaseSource(snapshot).catch(()=>{});
    await photoshop.core.executeAsModal(async()=>{
      for (const id of owned) {
        if(initial.includes(id))throw new Error('Original document entered diagnostic cleanup');
        const doc=Array.from(photoshop.app.documents).find(doc=>doc.id===id); if(doc)await doc.closeWithoutSaving();
      }
      if(Array.from(photoshop.app.documents).some(doc=>doc.id===prior))await executeChecked(photoshop,[{_obj:'select',_target:[{_ref:'document',_id:prior}]}]);
    },{commandName:'Close owned lighting diagnostics'});
  }
}

module.exports = { runHostTests, runDimensionReadTest, runEightBitReadTest, runSliderStress, compareMaterialLighting };
