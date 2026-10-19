const { createPhotoshopAdapter } = require('./photoshop-adapter');
const { createPilotSession } = require('./pilot-session');
const { fingerprintFile } = require('./file-identity');
const { latestQueue } = require('./fitting');

function mountRecolorPilot({ document, photoshop, storage, referenceIsCurrent, getReferenceFile }) {
  const adapter = createPhotoshopAdapter(photoshop), fs = storage.localFileSystem;
  const shell = document.querySelector('.app-shell');
  const toolbar = document.createElement('div'); toolbar.className = 'recolor-toolbar';
  toolbar.innerHTML = '<button id="recolorShow" type="button">Recolor <span>Pilot ' + require('../package.json').version + '</span></button><span id="recolorBinding">Select your product in Photoshop</span>';
  shell.insertBefore(toolbar, document.getElementById('librarySwitch'));
  const pane = document.createElement('aside'); pane.className = 'recolor-panel is-hidden'; pane.setAttribute('aria-label', 'Product recoloring');
  pane.innerHTML = `
    <div class="recolor-heading"><div><span class="eyebrow">RECOLOR PILOT</span><h2>Apply approved color</h2></div><button id="recolorClose" class="secondary-button" type="button">Browse library</button></div>
    <p class="recolor-help">Matte fabrics and solid surfaces. Review the result before delivery.</p>
    <p id="recolorStatus" role="status" aria-live="polite"></p>
    <div class="recolor-content">
    <section><h3>1. Product</h3><p id="recolorSource">Activate the original product image. Its current appearance will be the source.</p>
      <div class="recolor-row"><button id="recolorBegin" class="primary-button" type="button">Use active product</button><button id="recolorProduct" class="secondary-button" type="button">Go to preview</button></div>
      <p class="recolor-help">Work uses a layered duplicate in Adobe RGB. Prepare any existing recoloring visibility yourself before starting.</p></section>
    <section><h3>2. Material</h3><p class="recolor-help">Select the fabric in the product preview, or reuse a mask, saved selection or path.</p>
      <select id="recolorMaskSource" aria-label="Material mask source"></select><button id="recolorMask" class="secondary-button" type="button">Use material selection</button><p id="recolorMaskStatus"></p></section>
    <section><h3>3. Approved target</h3><p id="recolorReference">Browse an approved color and choose Apply Color on its reference.</p>
      <select id="recolorTarget" aria-label="Recolor target"></select><button id="recolorSample" class="secondary-button" type="button">Sample reference</button>
      <p class="recolor-help">On the opened reference, select diffuse fabric without deep shadows or bright reflections. No HEX is required.</p></section>
    <section><h3>4. Preview and apply</h3><div class="recolor-row"><button id="recolorPreview" class="primary-button" type="button">Preview color</button><button id="recolorBefore" class="secondary-button" type="button">Show original</button></div>
      <button id="recolorCancel" class="secondary-button is-hidden" type="button">Cancel matching</button>
      <details><summary>Fine-tune color and tone</summary><select id="recolorMethod" aria-label="Recoloring method"><option value="AUTO">Automatic comparison</option><option value="A">Color and curves</option><option value="B">Hue and selective color</option><option value="C">Gradient and tone</option><option value="D">Tint and levels</option></select>
      ${[['intensity','Color intensity',0,100,100],['lightness','Brightness',-60,60,0],['contrast','Contrast',-40,40,0],['shadows','Shadows',-25,25,0],['highlights','Highlights',-25,25,0]].map(([key,label,min,max,value]) => `<label class="recolor-slider">${label}<input data-recolor-parameter="${key}" type="range" min="${min}" max="${max}" value="${value}"><span>${value}</span></label>`).join('')}</details>
      <p id="recolorMeasurement" class="recolor-help"></p><button id="recolorApply" class="primary-button" type="button">Apply Color</button>
      <div class="recolor-row"><button id="recolorSave" class="secondary-button" type="button">Save editable PSD/PSB</button><button id="recolorNew" class="secondary-button" type="button">New variant</button></div></section>
    <button id="recolorEnd" class="secondary-button" type="button">End source session</button></div>`;
  shell.appendChild(pane);
  const $ = id => document.getElementById(id);
  let pending = null, opening = false, deferredUpdates = false, queuedUpdates = 0, latestView;
  const session = createPilotSession({ adapter, referenceIsCurrent, onChange: paint });
  function show() { shell.classList.add('is-recolor'); pane.classList.remove('is-hidden'); paint(session.view()); }
  function paint(state) {
    latestView = state;
    pane.setAttribute('data-source-document-id', state.source ? String(state.source.id) : '');
    pane.setAttribute('data-working-document-id', state.workingSourceDocumentId ? String(state.workingSourceDocumentId) : '');
    pane.setAttribute('data-preview-document-id', state.previewDocumentId ? String(state.previewDocumentId) : '');
    const busy = state.busy || opening;
    $('recolorBinding').textContent = state.source ? state.source.name : 'Select your product in Photoshop';
    $('recolorSource').textContent = state.source ? 'Bound source: ' + state.source.name + ' · Adobe RGB working copy' : 'Activate the original product image. Its current appearance will be the source.';
    $('recolorStatus').textContent = state.message;
    $('recolorMaskStatus').textContent = state.hasMask ? 'Material mask ready. Use New variant before replacing it.' : '';
    $('recolorReference').textContent = state.target ? state.target.reference.colorName + ' · ' + state.target.reference.filename + (state.target.sampled ? ' · sampled' : ' · select fabric, then sample') : pending ? pending.reference.colorName + ' selected. Bind your product first.' : 'Browse an approved color and choose Apply Color on its reference.';
    for (const id of ['recolorBegin', 'recolorProduct', 'recolorMask', 'recolorSample', 'recolorPreview', 'recolorBefore', 'recolorApply', 'recolorSave', 'recolorNew', 'recolorEnd', 'recolorTarget', 'recolorMaskSource', 'recolorMethod']) $(id).disabled = busy;
    $('recolorBegin').disabled = busy || Boolean(state.source);
    $('recolorProduct').disabled = busy || !state.source;
    $('recolorMask').disabled = busy || !state.source || state.committed || state.rendered;
    $('recolorSample').disabled = busy || !state.target;
    $('recolorPreview').disabled = busy || !state.hasMask || !state.target || !state.target.sampled;
    $('recolorBefore').disabled = busy || !state.rendered || state.committed;
    $('recolorApply').disabled = busy || !state.rendered || state.committed;
    $('recolorSave').disabled = busy || !state.committed;
    $('recolorNew').disabled = busy || !state.source;
    $('recolorEnd').disabled = busy || !state.source;
    $('recolorCancel').classList.toggle('is-hidden', !state.fitting);
    $('recolorBefore').textContent = state.showingAfter ? 'Show original' : 'Show recolored';
    const oldTarget = $('recolorTarget').value;
    $('recolorTarget').innerHTML = '';
    for (const t of state.targets) { const option = document.createElement('option'); option.value = t.id; option.textContent = t.name + (t.sampled ? '' : ' (sample required)'); $('recolorTarget').appendChild(option); }
    $('recolorTarget').selectedIndex = state.targets.findIndex(target => target.id === (state.target ? state.target.key : oldTarget));
    const quality = state.quality;
    $('recolorMeasurement').textContent = quality && quality.available ? 'Diffuse reference difference: ΔE00 ' + quality.anchorDeltaE00.toFixed(2) + '. Inspect texture and edges at 100%; this is not a final quality pass.' : '';
    for (const slider of pane.querySelectorAll('[data-recolor-parameter]')) {
      slider.disabled = (busy && !deferredUpdates) || !state.rendered || state.committed;
      if (state.recipe && !deferredUpdates) { slider.value = state.recipe.parameters[slider.getAttribute('data-recolor-parameter')]; slider.nextElementSibling.textContent = slider.value; }
    }
  }
  async function run(work) {
    try { await work(); }
    catch (error) { $('recolorStatus').textContent = error.message || String(error); console.error('Recolor operation failed', error); }
  }
  async function refreshMasks() {
    const choices = await session.maskSources(), select = $('recolorMaskSource'); select.innerHTML = '';
    const add = (value, text) => { const option = document.createElement('option'); option.value = JSON.stringify(value); option.textContent = text; select.appendChild(option); };
    add({ kind: 'selection' }, 'Current Photoshop selection');
    for (const layer of choices.layers) add({ kind: 'layerMask', layerId: layer.id }, 'Layer mask: ' + layer.name);
    for (const channel of choices.channels) add({ kind: 'channel', channelIndex: channel.index, name: channel.name }, 'Saved selection: ' + channel.name);
    for (const path of choices.paths) add({ kind: 'path', pathIndex: path.index, name: path.name }, 'Path: ' + path.name);
    // Photoshop UXP leaves a populated select at -1; browsers select item 0.
    select.selectedIndex = 0;
  }
  async function openPendingReference() {
    if (!pending || !session.view().source || opening) return;
    opening = true; paint(session.view());
    $('recolorStatus').textContent = 'Loading and checking the approved reference. Photoshop remains available.';
    const chosen = pending;
    try {
      const entry = await getReferenceFile(chosen.ref);
      const temp = await fs.getTemporaryFolder(), folder = await temp.createFolder('recolor-reference-' + Date.now());
      const copy = await entry.copyTo(folder, { overwrite: false });
      const identity = await fingerprintFile(copy.url, require('fs'));
      if (chosen.reference.checksumSha256 && chosen.reference.checksumSha256.toLowerCase() !== identity.sha256) throw new Error('The reference file differs from its approved version. Sync the library before recoloring.');
      const descriptor = { ...chosen.reference, originalAssetPath: String(entry.nativePath), verifiedAssetSha256: identity.sha256 };
      if (!referenceIsCurrent(descriptor)) throw new Error('The client or approved reference changed during loading. Choose the reference again.');
      const referenceDoc = await adapter.openDocument(copy);
      await session.chooseReference(descriptor, referenceDoc.id);
      await refreshMasks();
      pending = null;
    } finally { opening = false; paint(session.view()); }
  }
  $('recolorShow').addEventListener('click', show);
  $('recolorClose').addEventListener('click', () => { pane.classList.add('is-hidden'); shell.classList.remove('is-recolor'); });
  $('recolorBegin').addEventListener('click', () => run(async () => { await session.begin(adapter.inspect().id); await refreshMasks(); await openPendingReference(); }));
  $('recolorProduct').addEventListener('click', () => run(() => adapter.activateDocument(session.view().previewDocumentId)));
  $('recolorMask').addEventListener('click', () => run(async () => { await session.useMask(JSON.parse($('recolorMaskSource').value)); await refreshMasks(); }));
  $('recolorSample').addEventListener('click', () => run(() => session.sampleReference()));
  $('recolorPreview').addEventListener('click', () => run(() => session.preview($('recolorMethod').value)));
  $('recolorBefore').addEventListener('click', () => run(() => session.toggle()));
  $('recolorApply').addEventListener('click', () => run(() => session.apply()));
  $('recolorCancel').addEventListener('click', () => session.cancelFit());
  $('recolorNew').addEventListener('click', () => run(async () => { await session.newVariant(); await refreshMasks(); }));
  $('recolorTarget').addEventListener('change', () => run(async () => { await session.selectTarget($('recolorTarget').value); await refreshMasks(); }));
  $('recolorEnd').addEventListener('click', () => run(async () => { await session.end(); pending = null; $('recolorMaskSource').innerHTML = ''; paint(session.view()); }));
  $('recolorSave').addEventListener('click', () => run(async () => {
    const state = session.view(), color = state.target.reference.colorName.replace(/[^\w -]/g, '').slice(0, 40);
    const file = await fs.getFileForSaving('recolor-' + color + '-' + Date.now() + '.psd', { types: ['psd', 'psb'] });
    if (file) await session.save(file, await fs.getDataFolder());
  }));
  const update = latestQueue(parameters => session.update(parameters));
  $('recolorMethod').selectedIndex = 0;
  for (const slider of pane.querySelectorAll('[data-recolor-parameter]')) slider.addEventListener('input', () => {
    if (!latestView.recipe || latestView.committed) return;
    const parameters = {};
    for (const control of pane.querySelectorAll('[data-recolor-parameter]')) { parameters[control.getAttribute('data-recolor-parameter')] = Number(control.value); control.nextElementSibling.textContent = control.value; }
    deferredUpdates = true;
    queuedUpdates++;
    update(parameters).catch(error => { $('recolorStatus').textContent = error.message; }).finally(() => { queuedUpdates--; deferredUpdates = queuedUpdates > 0; paint(session.view()); });
  });
  paint(session.view());
  return {
    chooseReference(group, ref, clientId) {
      if (session.view().busy || opening) { show(); return; }
      pending = { ref, reference: { clientId, colorId: group.id, colorName: group.displayName,
        referenceId: ref.portalReferenceId, versionId: ref.versionId, versionNumber: ref.versionNumber,
        checksumSha256: ref.checksumSha256 || '', filename: ref.baseName, kind: ref.referenceKind,
        approvedAt: ref.approvedAt || null, approvalProvenance: 'EXISTING_CLIENT_LIBRARY', source: 'APPROVED_LIBRARY_REFERENCE' } };
      show(); run(openPendingReference);
    },
    registerReferenceDocument: documentId => adapter.markReference(documentId)
  };
}

module.exports = { mountRecolorPilot };
