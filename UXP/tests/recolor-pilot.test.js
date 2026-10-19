const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createPilotSession } = require('../recolor/pilot-session');
const { ADOBE_RGB, labToRgb } = require('../recolor/color');

// Adapter seam: session tests exercise real color/quality/fitting logic. Native
// Photoshop fixtures separately establish actual rendering and PSD editability.
function workstation() {
  const docs = new Map(), marked = new Set(), saved = [], captures = [];
  let next = 0, active = null, valid = true, rendered = 0, failRender = false;
  const copyFrame = f => ({ ...f, data: new Uint16Array(f.data) });
  function image(rgb) {
    const data = new Uint16Array(32 * 32 * 3);
    for (let i = 0; i < 32 * 32; i++) for (let c = 0; c < 3; c++) data[i * 3 + c] = rgb[c] * 257;
    return { width: 32, height: 32, components: 3, maximum: 65535, profile: ADOBE_RGB, bounds: { left: 0, top: 0, right: 32, bottom: 32 }, data };
  }
  function add(rgb, name) { const id = ++next; docs.set(id, { id, name, path: 'C:/' + name, profile: ADOBE_RGB, historyId: 1, frame: image(rgb) }); active = id; return id; }
  const sourceId = add([40, 90, 30], 'product.psd'), referenceId = add([125, 40, 70], 'reference.jpg');
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
    async createPreview(snapshot) { const id = ++next; docs.set(id, { ...docs.get(snapshot.documentId), id, frame: copyFrame(docs.get(snapshot.documentId).frame) }); active = id; return { documentId: id, committed: false, snapshot, recipe: null }; },
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
    async releaseSource(snapshot) { docs.delete(snapshot.documentId); }
  };
  const reference = { clientId: 'cbi', colorId: 'wine', referenceId: 'crop', versionId: 'v1', colorName: 'Wine', checksumSha256: '', filename: 'reference.jpg' };
  const session = createPilotSession({ adapter, referenceIsCurrent: () => valid });
  async function ready() {
    await session.begin(sourceId); await session.useMask({ kind: 'selection' });
    await session.chooseReference(reference, referenceId);
    await session.sampleReference();
  }
  return { session, adapter, docs, sourceId, referenceId, reference, ready, saved, captures,
    activate(id) { active = id; }, withdraw() { valid = false; }, get renders() { return rendered; },
    blockRender() { failRender = true; } };
}

test('pilot binds the product while references become active; soft mask and frozen source survive target changes', async () => {
  const w = workstation(), original = new Uint16Array(w.docs.get(w.sourceId).frame.data);
  await w.ready(); await w.session.preview('A'); await w.session.update({ lightness: 6 });
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
  const applied = await w.session.apply();
  assert.equal(applied.fullResolutionIntegrity.protectedPixelsChanged, 0);
  await w.session.newVariant(); w.withdraw();
  await assert.rejects(() => w.session.preview(), /approved reference changed/);
  assert.equal(w.docs.has(applied.documentId), true);
  assert.equal(w.session.view().outputs.length, 1);
  assert.equal(applied.productionQualified, false);
});

test('manual preview edits survive new variant and end; frozen source is not a recolored result', async () => {
  const w = workstation(); await w.ready(); await w.session.preview('A');
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
  const w = workstation(); await w.ready(); await w.session.preview('B'); await w.session.apply();
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

test('a saved master remains recorded when session-record storage fails', async () => {
  const w = workstation(); await w.ready(); await w.session.preview('A'); await w.session.apply();
  const folder = { async createFile() { throw new Error('disk full'); } };
  await assert.rejects(() => w.session.save({ nativePath: 'C:/retained.psd' }, folder), /Master saved at C:\/retained.psd.*disk full/);
  assert.equal(w.session.view().outputs[0].savedPath, 'C:/retained.psd');
  assert.equal(w.saved.length, 1); assert.equal(w.session.view().busy, false);
});

test('an opened reference is never silently rebound as the next product source', async () => {
  const w = workstation(); await w.ready(); await w.session.end();
  await assert.rejects(() => w.session.begin(w.referenceId), /reference cannot become the source/);
  assert.equal(w.session.view().source, null); assert.equal(w.session.view().busy, false);
});
