const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createPilotSession } = require('../recolor/pilot-session');
const { ADOBE_RGB, labToRgb } = require('../recolor/color');
const { panelMarkup } = require('../recolor/panel-view');
const { previewPresentation } = require('../recolor/preview-review');
const { createActionJournal } = require('../recolor/action-journal');

test('crash journal retains bounded action values across reloads without image paths or storage errors escaping', async () => {
  let saved = JSON.stringify({records:[{action:'previous',phase:'started'}]});
  const file={async read(){return saved;},async write(text){saved=text;}};
  const journal=createActionJournal({async getDataFolder(){return{async getEntry(){return file;}};}});
  for(let i=0;i<30;i++)await journal.record('manual-adjustment','started',{recipe:{method:'C',parameters:{lightness:i}},source:{width:1300,height:2000,path:'private-source'}},{lightness:i});
  const record=JSON.parse(saved);
  assert.equal(record.records.length,24);assert.equal(record.records.at(-1).parameters.lightness,29);
  assert.ok(!saved.includes('private-source'));
  await createActionJournal({async getDataFolder(){throw new Error('disk unavailable');}}).record('preview','started',{});
});

// Adapter seam: session tests exercise real color/quality/fitting logic. Native
// Photoshop fixtures separately establish actual rendering and PSD editability.
function workstation(options = {}) {
  const docs = new Map(), marked = new Set(), saved = [], captures = [], deliveries = [];
  let next = 0, active = null, valid = true, rendered = 0, failRender = false;
  const copyFrame = f => ({ ...f, data: new Uint16Array(f.data) });
  function image(rgb) {
    const data = new Uint16Array(32 * 32 * 3);
    for (let i = 0; i < 32 * 32; i++) for (let c = 0; c < 3; c++) data[i * 3 + c] = rgb[c] * 257;
    return { width: 32, height: 32, components: 3, maximum: 65535, profile: ADOBE_RGB, bounds: { left: 0, top: 0, right: 32, bottom: 32 }, data };
  }
  function add(rgb, name) { const id = ++next; docs.set(id, { id, name, path: 'C:/' + name, profile: ADOBE_RGB, historyId: 1, frame: image(rgb) }); active = id; return id; }
  const sourceId = add(options.sourceRgb || [40, 90, 30], 'product.psd'), referenceId = add(options.targetRgb || [125, 40, 70], 'reference.jpg');
  const mask = { left: 8, top: 8, width: 16, height: 16, maximum: 255, data: new Uint8Array(256).fill(255) };
  const inspect = id => { const { frame, ...binding } = docs.get(id == null ? active : id); return { ...binding }; };
  const adapter = {
    inspect,
    async captureSource(id) {
      if (marked.has(id)) throw new Error('A reference cannot become the source');
      const original = inspect(id), frozen = ++next;
      docs.set(frozen, { ...docs.get(id), id: frozen, frame: copyFrame(docs.get(id).frame) }); captures.push(id);
      return { original, documentId: frozen, sourceQualification: 'UNREVIEWED_VISIBLE_STATE' };
    },
    async createPreview(snapshot) {
      if (docs.get(snapshot.documentId).frozenEdited) throw Object.assign(new Error('Frozen source changed'), { code: 'FROZEN_SOURCE_CHANGED' });
      const id = ++next; docs.set(id, { ...docs.get(snapshot.documentId), id, frame: copyFrame(docs.get(snapshot.documentId).frame) }); active = id; return { documentId: id, committed: false, snapshot, recipe: null };
    },
    async recoverSource(snapshot) {
      if (inspect(snapshot.original.id).historyId !== snapshot.original.historyId) throw Object.assign(new Error('Original source changed'), { code: 'ORIGINAL_SOURCE_CHANGED' });
      return adapter.captureSource(snapshot.original.id);
    },
    async showMaterialSelection(preview, mask) { docs.get(preview.documentId).displayedSelection = mask; active = preview.documentId; },
    async readPixels(id) { return copyFrame(docs.get(id).frame); },
    async acquireMask(id) { docs.get(id).historyId++; return mask; },
    async maskSources() { return { layers: [], channels: [], paths: [] }; },
    markReference(id) { marked.add(id); },
    async activateDocument(id) { active = id; },
    async cancel(preview) { if (docs.get(preview.documentId).edited) throw Object.assign(new Error('Manual edits'), { code: 'MANUAL_EDITS' }); docs.delete(preview.documentId); },
    async render(preview, recipe) {
      if (failRender) throw Object.assign(new Error('Manual edits preserved'), { code: 'MANUAL_EDITS' });
      const f = docs.get(preview.documentId).frame, rgb = labToRgb(recipe.target.diffuseLab, ADOBE_RGB).rgb;
      for (let y = 8; y < 24; y++) for (let x = 8; x < 24; x++) for (let c = 0; c < 3; c++) f.data[(y * 32 + x) * 3 + c] = Math.round(rgb[c] * 257);
      preview.recipe = recipe; rendered++; return { targetGamutClipped: false };
    },
    async toggle(preview, visible) { preview.visible = visible; },
    async commit(preview) { preview.committed = true; return { sessionId: 'case-' + preview.documentId, documentId: preview.documentId, sourceQualification: preview.snapshot.sourceQualification, recipe: preview.recipe }; },
    async saveMaster(id, file, paths) { if (paths.includes(file.nativePath)) throw new Error('Source protected'); saved.push(id); return { path: file.nativePath }; },
    async saveJpeg(id, file, paths) {
      if (paths.includes(file.nativePath)) throw new Error('Source protected');
      const jpeg = { path: file.nativePath, profile: 'sRGB IEC61966-2.1', format: 'jpg', verified: true };
      deliveries.push(jpeg); return jpeg;
    },
    async saveOutputs(id, file, jpegFile, paths) {
      const master = await this.saveMaster(id, file, paths);
      const jpeg = { path: jpegFile.nativePath, profile: 'sRGB IEC61966-2.1', format: 'jpg', verified: true };
      deliveries.push(jpeg); return { master, jpeg };
    },
    async releaseSource(snapshot) { docs.delete(snapshot.documentId); }
  };
  const reference = { clientId: 'cbi', colorId: 'wine', referenceId: 'crop', versionId: 'v1', colorName: 'Wine', checksumSha256: '', filename: 'reference.jpg' };
  const session = createPilotSession({ adapter, referenceIsCurrent: () => valid, onChange: options.onChange });
  async function ready() {
    await session.begin(sourceId); await session.useMask({ kind: 'selection' });
    await session.chooseReference(reference, referenceId);
    await session.sampleReference();
  }
  return { session, adapter, docs, sourceId, referenceId, reference, ready, saved, captures, deliveries,
    activate(id) { active = id; }, withdraw() { valid = false; }, get renders() { return rendered; },
    blockRender() { failRender = true; } };
}

test('preview controls stage automatic matching before method choice and manual adjustments', () => {
  const markup = panelMarkup('test');
  assert.ok(markup.indexOf('id="recolorPreview"') < markup.indexOf('id="recolorReviewControls"'));
  assert.match(markup, /id="recolorReviewControls" class="[^"]*is-hidden/);
  assert.match(markup, /id="recolorMethod"[^>]*>[\s\S]*Automatic[^<]*best match/);
  assert.match(markup, /id="recolorTuneToggle"[^>]*aria-expanded="false"[^>]*>Manual adjustments/);
  assert.match(markup, /id="recolorFineTune" class="[^"]*is-hidden/);
  assert.doesNotMatch(markup, /<details|<summary/);
  for (const parameter of ['intensity', 'lightness', 'contrast', 'shadows', 'highlights']) {
    assert.match(markup, new RegExp('data-recolor-parameter="' + parameter + '"'));
  }
});

test('apply commits the method and manual adjustments in the current preview', async () => {
  const w = workstation(); await w.ready();
  await w.session.preview('D');
  await w.session.update({ intensity: 82, lightness: 9, contrast: -4, shadows: 3, highlights: -2 });
  const applied = await w.session.apply({ reviewOverride: true });
  assert.equal(applied.recipe.method, 'D');
  assert.deepEqual({
    intensity: applied.recipe.parameters.intensity,
    lightness: applied.recipe.parameters.lightness,
    contrast: applied.recipe.parameters.contrast,
    shadows: applied.recipe.parameters.shadows,
    highlights: applied.recipe.parameters.highlights
  }, { intensity: 82, lightness: 9, contrast: -4, shadows: 3, highlights: -2 });
  assert.equal(applied.previewReview.requestedMethod, 'D');
  assert.equal(applied.previewReview.manuallyAdjusted, true);
  assert.equal(applied.quality.matching.requestedMethod, 'D');
});

test('unresolved checks require an explicit draft override, which records the unresolved evidence', async () => {
  const w = workstation(); await w.ready(); await w.session.preview('A');
  await assert.rejects(() => w.session.apply(), { code: 'REVIEW_OVERRIDE_REQUIRED' });
  assert.equal(w.session.view().committed, false);
  const applied = await w.session.apply({ reviewOverride: true });
  assert.equal(applied.reviewOverride.explicit, true);
  assert.ok(applied.reviewOverride.unresolved.length > 0);
  assert.equal(applied.recipe.schemaVersion, 2);
});

test('draft override cannot authorize changed protected pixels discovered at Apply', async () => {
  const w = workstation(); await w.ready(); await w.session.preview('A');
  w.docs.get(w.session.view().previewDocumentId).frame.data[0]++;
  await assert.rejects(() => w.session.apply({ reviewOverride: true }), /Protected pixels/);
  assert.equal(w.session.view().committed, false);
});

test('fabric appearance changes invalidate cached analysis and require a new variant after rendering', async () => {
  const w = workstation(); await w.ready(); await w.session.setMaterial('SATIN'); await w.session.preview('A');
  assert.equal(w.session.view().analysis.material, 'SATIN');
  assert.match(w.session.view().quality.report.risks.join(' '), /reflection/);
  await assert.rejects(() => w.session.setMaterial('MATTE'), /New variant/);
  await w.session.newVariant(); await w.session.setMaterial('MATTE');
  assert.equal(w.session.view().recipe, null); assert.equal(w.session.view().analysis, null);
});

test('completed recipe crash breadcrumbs retain parameter evidence while omitting image paths', async () => {
  let saved;
  const file = {async write(value){saved=value;}};
  const journal = createActionJournal({async getDataFolder(){return{async getEntry(){throw new Error('missing');},async createFile(){return file;}};}});
  await journal.record('preview','completed',{recipe:{method:'A',parameters:{lightness:3},target:{approvedReference:{originalAssetPath:'private-image-path'}}}});
  assert.ok(!saved.includes('private-image-path')); assert.equal(JSON.parse(saved).records[0].recipe.parameters.lightness,3);
});

test('large lightness changes receive extended comparison in either direction', async () => {
  for (const [sourceRgb, targetRgb, direction] of [
    [[20, 20, 20], [220, 220, 220], 'DARK_TO_LIGHT'],
    [[220, 220, 220], [20, 20, 20], 'LIGHT_TO_DARK']
  ]) {
    const w = workstation({ sourceRgb, targetRgb }); await w.ready(); await w.session.preview();
    const state = w.session.view(), matching = state.quality.matching;
    assert.equal(state.previewReview.transition.direction, direction);
    assert.equal(matching.budget, 160);
    assert.deepEqual(matching.methods.map(item => item.method).sort(), ['A', 'B', 'C', 'D']);
    assert.ok(matching.methods.every(item => item.quality && Number.isFinite(item.quality.score)));
    assert.equal(state.previewReview.requestedMethod, 'AUTO');
    assert.ok(matching.evaluations <= matching.budget);
  }
});

test('a new automatic preview compares all methods even when the previous variant used an explicit method', async () => {
  const w = workstation(); await w.ready(); await w.session.preview('D'); await w.session.newVariant();
  const methods = [], render = w.adapter.render;
  w.adapter.render = async (...args) => { methods.push(args[1].method); return render(...args); };
  await w.session.preview();
  assert.deepEqual([...new Set(methods)].sort(), ['A', 'B', 'C', 'D']);
});

test('pilot records constrained dark-to-light selection but preserves an explicit method override', async () => {
  const w=workstation({sourceRgb:[20,20,35],targetRgb:[190,220,225]});await w.ready();await w.session.preview();
  assert.equal(w.session.view().recipe.method,'D');
  assert.equal(w.session.view().quality.matching.selection.version,'fabric-constrained-selection-1');
  assert.match(previewPresentation(w.session.view(),'AUTO').review,/priors/);
  await w.session.preview('B');assert.equal(w.session.view().recipe.method,'B');
  assert.equal(w.session.view().quality.matching.selection.requestedMethod,'B');
  assert.doesNotMatch(previewPresentation(w.session.view(),'B').review,/Designer feedback/);
});

test('review describes the rendered method until a new selection is refreshed and retains measured manual review', async () => {
  const w = workstation(); await w.ready(); await w.session.preview('C');
  const before = w.session.view();
  const pending = previewPresentation(before, 'AUTO');
  assert.equal(pending.pending, true);
  assert.equal(pending.title, 'Preview: Gradient and tone');
  assert.doesNotMatch(pending.title, /Automatic chose/);
  assert.match(pending.review, /canvas still shows Gradient and tone/);
  await w.session.update({ lightness: 7, shadows: -3 });
  const after = w.session.view(), review = previewPresentation(after, 'C');
  assert.equal(after.quality.matching.requestedMethod, 'C');
  assert.equal(after.previewReview.manuallyAdjusted, true);
  assert.match(review.title, /manually adjusted/);
  assert.match(review.review, /ΔE00/);
  assert.match(review.review, /Needs review|checks passed/);
  assert.ok(after.quality.report.checks.clipping);
  assert.deepEqual(after.methodReviews[0].quality, after.quality);
  await w.session.preview('D');
  assert.equal(w.session.view().previewReview.manuallyAdjusted, false);
  assert.deepEqual(w.session.view().methodReviews.map(item => item.requestedMethod), ['C', 'D']);
  assert.match(previewPresentation(w.session.view(), 'C').review, /Previous color difference/);
});

test('unfinished fitting trials never become an applicable first preview', async () => {
  const states = [], w = workstation({ onChange: state => states.push(state) }); await w.ready();
  const render = w.adapter.render;
  w.adapter.render = async (...args) => { const result = await render(...args); w.session.cancelFit(); return result; };
  await assert.rejects(() => w.session.preview(), /cancelled/);
  assert.equal(w.session.view().rendered, false);
  assert.ok(states.every(state => !state.rendered));
  await assert.rejects(() => w.session.apply(), /Preview the selected color/);
  await assert.rejects(() => w.session.update({ intensity: 80 }), /Preview a new variant/);
});

test('cancelled method refresh restores the exact last accepted manual preview and comparison visibility', async () => {
  const w = workstation(); await w.ready(); await w.session.preview('C');
  await w.session.update({ intensity: 81, lightness: 8 }); await w.session.toggle();
  const previous = w.session.view(), render = w.adapter.render;
  let trials = 0;
  w.adapter.render = async (...args) => {
    const result = await render(...args);
    if (++trials === 1) w.session.cancelFit();
    return result;
  };
  await assert.rejects(() => w.session.preview('D'), /cancelled/);
  const restored = w.session.view();
  assert.equal(restored.rendered, true);
  assert.equal(restored.showingAfter, false);
  assert.deepEqual(restored.recipe, previous.recipe);
  assert.deepEqual(restored.quality, previous.quality);
  assert.deepEqual((await w.session.apply({ reviewOverride: true })).recipe, previous.recipe);
});

test('failed refresh restoration disables Apply instead of committing an unreviewed trial', async () => {
  const w = workstation(); await w.ready(); await w.session.preview('B');
  const render = w.adapter.render;
  w.adapter.render = async (...args) => {
    const result = await render(...args);
    w.session.cancelFit(); w.blockRender(); return result;
  };
  await assert.rejects(() => w.session.preview('D'), /cancelled/);
  assert.equal(w.session.view().rendered, false);
  await assert.rejects(() => w.session.apply(), /Preview the selected color/);
});

test('pilot binds the product while references become active; soft mask and frozen source survive target changes', async () => {
  const w = workstation(), original = new Uint16Array(w.docs.get(w.sourceId).frame.data);
  await w.ready(); await w.session.preview('B'); await w.session.update({ lightness: 6 });
  const wine = w.session.view().target.key;
  const other = { ...w.reference, colorId: 'royal', colorName: 'Royal', referenceId: 'full' };
  await w.session.chooseReference(other, w.referenceId); await w.session.sampleReference(); await w.session.preview('C');
  assert.equal(w.session.view().recipe.parameters.lightness, 0);
  await w.session.selectTarget(wine);
  assert.equal(w.session.view().recipe.parameters.lightness, 6);
  assert.equal(w.session.view().source.id, w.sourceId);
  assert.deepEqual(w.captures, [w.sourceId]);
  assert.deepEqual(w.docs.get(w.sourceId).frame.data, original);
  assert.equal(w.session.view().hasMask, true);
});

test('a reference selection can change history; pixel edits and wrong-document sampling are rejected', async () => {
  const w = workstation(); await w.session.begin(w.sourceId);
  await w.session.chooseReference(w.reference, w.referenceId);
  w.docs.get(w.referenceId).historyId += 5; // Native selection is not an image edit.
  await w.session.sampleReference();
  assert.equal(w.session.view().target.sampled, true);
  await assert.rejects(() => w.session.sampleReference(), /Activate.*reference/);
  w.activate(w.referenceId); w.docs.get(w.referenceId).frame.data[0]++;
  await assert.rejects(() => w.session.sampleReference(), /image was edited/);
});

test('withdrawal blocks further fitting or apply without altering a completed variant', async () => {
  const w = workstation(); await w.ready(); await w.session.preview('AUTO');
  const applied = await w.session.apply({ reviewOverride: true });
  assert.equal(applied.fullResolutionIntegrity.protectedPixelsChanged, 0);
  await w.session.newVariant(); w.withdraw();
  await assert.rejects(() => w.session.preview(), /approved reference changed/);
  assert.equal(w.docs.has(applied.documentId), true);
  assert.equal(w.session.view().outputs.length, 1);
  assert.equal(applied.productionQualified, false);
});

test('manual preview edits survive new variant and end; frozen source is not a recolored result', async () => {
  const w = workstation(); await w.ready(); await w.session.preview('B');
  const edited = w.session.view().previewDocumentId; w.docs.get(edited).edited = true;
  await w.session.newVariant();
  assert.equal(w.docs.has(edited), true);
  const next = w.session.view().previewDocumentId;
  assert.deepEqual(w.docs.get(next).frame.data, w.docs.get(w.sourceId).frame.data);
  await w.session.end();
  assert.equal(w.docs.has(edited), true); assert.equal(w.docs.has(next), true);
  assert.equal(w.session.view().source, null);
});

test('master saving carries approved-reference provenance and refuses a protected source path', async () => {
  const w = workstation(); await w.ready(); await w.session.preview('B'); await w.session.apply({ reviewOverride: true });
  const written = [], folder = { async createFile(name) { return { nativePath: 'C:/manifests/' + name, async write(text) { written.push(JSON.parse(text)); } }; } };
  await assert.rejects(() => w.session.save({ nativePath: 'C:/product.psd' }, folder), /protected/);
  await w.session.save({ nativePath: 'C:/result.psd' }, folder);
  assert.equal(written.length, 1); assert.deepEqual(written[0].libraryReference, w.reference);
  assert.equal(written[0].productionQualified, false);
});

test('cancel matching stops later renders and leaves source and preview available', async () => {
  const w = workstation(); await w.ready();
  const render = w.adapter.render;
  w.adapter.render = async (...args) => { const result = await render(...args); w.session.cancelFit(); return result; };
  await assert.rejects(() => w.session.preview('AUTO'), /cancelled/);
  assert.equal(w.renders, 1); assert.equal(w.session.view().busy, false);
  assert.equal(w.docs.has(w.sourceId), true); assert.equal(w.docs.has(w.session.view().previewDocumentId), true);
});

test('automatic fitting restores Solid Color and preserves applied results', async () => {
  const w = workstation(); await w.ready();
  const methods = [], render = w.adapter.render;
  w.adapter.render = async (preview, recipe, ...rest) => { methods.push(recipe.method); return render(preview, recipe, ...rest); };
  await w.session.preview();
  assert.deepEqual([...new Set(methods)].sort(), ['A', 'B', 'C', 'D']);
  assert.equal(w.session.view().quality.matching.solidColorFill, w.session.view().recipe.method === 'A');
  const applied = await w.session.apply({ reviewOverride: true }), documentId = applied.documentId;
  await assert.rejects(() => w.session.preview('Z'), /supported recoloring method/);
  assert.equal(w.session.view().previewDocumentId, documentId);
  assert.equal(w.session.view().committed, true);
  assert.equal(w.docs.has(documentId), true);
  methods.length = 0;
  await w.session.preview('A');
  assert.ok(methods.length > 1, 'An explicit method must also be fitted and restored');
  assert.deepEqual([...new Set(methods)], ['A']);
  assert.notEqual(w.session.view().previewDocumentId, documentId);
});

test('a saved master remains recorded when session-record storage fails', async () => {
  const w = workstation(); await w.ready(); await w.session.preview('B'); await w.session.apply({ reviewOverride: true });
  const folder = { async createFile() { throw new Error('disk full'); } };
  await assert.rejects(() => w.session.save({ nativePath: 'C:/retained.psd' }, folder), /Master saved at C:\/retained.psd.*disk full/);
  assert.equal(w.session.view().outputs[0].savedPath, 'C:/retained.psd');
  assert.equal(w.saved.length, 1); assert.equal(w.session.view().busy, false);
});

test('paired saving records the editable master and JPEG in one output manifest', async () => {
  const w = workstation(); await w.ready(); await w.session.preview('B'); await w.session.apply({ reviewOverride: true });
  const written = [], folder = { async createFile() { return { async write(text) { written.push(JSON.parse(text)); } }; } };
  const result = await w.session.save({ nativePath: 'C:/result.psd' }, folder, { jpegFile: { nativePath: 'C:/result.jpg' } });
  assert.equal(w.saved.length, 1); assert.equal(w.deliveries.length, 1);
  assert.equal(result.output, 'C:/result.psd'); assert.equal(result.jpeg.path, 'C:/result.jpg');
  assert.equal(written[0].jpeg.profile, 'sRGB IEC61966-2.1');
  assert.equal(w.session.view().outputs[0].jpegPath, 'C:/result.jpg');
});

test('JPEG saving works before a PSD save and creates no editable master', async () => {
  const w = workstation(); await w.ready(); await w.session.preview('B'); await w.session.apply({ reviewOverride: true });
  const written = [], folder = { async createFile() { return { async write(text) { written.push(JSON.parse(text)); } }; } };
  const record = await w.session.saveJpeg({ nativePath: 'C:/standalone.jpg' }, folder);
  assert.equal(w.saved.length, 0); assert.equal(w.deliveries.length, 1);
  assert.equal(record.output, 'C:/standalone.jpg'); assert.equal(record.master, undefined);
  assert.equal(w.session.view().outputs[0].savedPath, undefined);
  assert.equal(written[0].jpeg.verified, true);
  await w.session.save({ nativePath: 'C:/standalone.psd' }, folder);
  assert.equal(w.saved.length, 1); assert.equal(w.deliveries.length, 1, 'PSD saving must not export another JPEG');
});

test('separate JPEG failures retain any completed PSD and create no extra master', async () => {
  const w = workstation(); await w.ready(); await w.session.preview('B'); await w.session.apply({ reviewOverride: true });
  const folder = { async createFile() { return { async write() {} }; } };
  await w.session.save({ nativePath: 'C:/retained.psd' }, folder);
  w.adapter.saveJpeg = async () => { throw new Error('JPEG disk full'); };
  await assert.rejects(() => w.session.saveJpeg({ nativePath: 'C:/failed.jpg' }, folder), /JPEG disk full/);
  assert.equal(w.saved.length, 1); assert.equal(w.session.view().outputs[0].savedPath, 'C:/retained.psd');
  assert.equal(w.session.view().busy, false);
});

test('JPEG failure retains a saved master and reports its path without claiming paired success', async () => {
  const w = workstation(); await w.ready(); await w.session.preview('B'); await w.session.apply({ reviewOverride: true });
  w.adapter.saveOutputs = async () => { throw Object.assign(new Error('Master saved at C:/retained.psd, but JPEG export failed: disk full'), { savedMaster: { path: 'C:/retained.psd' } }); };
  const folder = { async createFile() { throw new Error('Unexpected completed manifest'); } };
  await assert.rejects(() => w.session.save({ nativePath: 'C:/retained.psd' }, folder, { jpegFile: { nativePath: 'C:/retained.jpg' } }), /JPEG export failed/);
  assert.equal(w.session.view().outputs[0].savedPath, 'C:/retained.psd');
  assert.equal(w.session.view().outputs[0].jpegPath, undefined);
  assert.equal(w.session.view().busy, false);
});

test('an opened reference is never silently rebound as the next product source', async () => {
  const w = workstation(); await w.ready(); await w.session.end();
  await assert.rejects(() => w.session.begin(w.referenceId), /reference cannot become the source/);
  assert.equal(w.session.view().source, null); assert.equal(w.session.view().busy, false);
});

test('mask capture recovers an altered internal source only from its unchanged original and retains all edited copies', async () => {
  const w = workstation(); await w.session.begin(w.sourceId);
  const before = w.session.view(), oldSource = before.workingSourceDocumentId, oldPreview = before.previewDocumentId;
  w.docs.get(oldSource).frozenEdited = true;
  w.docs.get(oldPreview).edited = true; // Designer's garment selection must survive.
  await w.session.useMask({ kind: 'selection' });
  const after = w.session.view();
  assert.equal(after.hasMask, true); assert.equal(after.sourceRecovered, true);
  assert.notEqual(after.workingSourceDocumentId, oldSource);
  assert.equal(w.docs.has(oldSource), true); assert.equal(w.docs.has(oldPreview), true);
  assert.ok(w.docs.get(after.previewDocumentId).displayedSelection);
  assert.deepEqual(w.captures, [w.sourceId, w.sourceId]);
});

test('internal source recovery refuses a changed original or different normalized pixels without discarding work', async () => {
  const w = workstation(); await w.session.begin(w.sourceId);
  const before = w.session.view(); w.docs.get(before.workingSourceDocumentId).frozenEdited = true;
  w.docs.get(w.sourceId).historyId++;
  await assert.rejects(() => w.session.useMask({ kind: 'selection' }), /Original source changed/);
  assert.equal(w.session.view().hasMask, false); assert.equal(w.docs.has(before.previewDocumentId), true);
  w.docs.get(w.sourceId).historyId--;
  const recover = w.adapter.recoverSource;
  w.adapter.recoverSource = async snapshot => { const next = await recover(snapshot); w.docs.get(next.documentId).frame.data[0]++; return next; };
  await assert.rejects(() => w.session.useMask({ kind: 'selection' }), /does not match the captured source/);
  assert.equal(w.session.view().workingSourceDocumentId, before.workingSourceDocumentId);
  assert.equal(w.docs.has(before.previewDocumentId), true); assert.equal(w.session.view().hasMask, false);
});
