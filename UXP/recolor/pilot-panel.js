const { createPhotoshopAdapter } = require('./photoshop-adapter');
const { createPilotSession } = require('./pilot-session');
const { fingerprintFile } = require('./file-identity');
const { latestQueue } = require('./fitting');
const { createPanelView } = require('./panel-view');
const { createActionJournal } = require('./action-journal');
const { createFeedbackStore } = require('./feedback-store');

function mountRecolorPilot({ document, photoshop, storage, referenceIsCurrent, getReferenceFile }) {
  const adapter = createPhotoshopAdapter(photoshop), fs = storage.localFileSystem;
  const journal = createActionJournal(fs);
  const feedback = createFeedbackStore(fs);
  const shell = document.querySelector('.app-shell');
  const toolbar = document.createElement('div'); toolbar.className = 'recolor-toolbar';
  toolbar.innerHTML = '<button id="recolorShow" type="button">Recolor <span>Pilot ' + require('../package.json').version + '</span></button><span id="recolorBinding">Select your product in Photoshop</span>';
  shell.insertBefore(toolbar, document.getElementById('librarySwitch'));
  const pane = document.createElement('aside'); pane.className = 'recolor-panel is-hidden'; pane.setAttribute('aria-label', 'Product recoloring');
  const browse = () => { pane.classList.add('is-hidden'); shell.classList.remove('is-recolor'); };
  const panelView = createPanelView({ document, pane, version: require('../package.json').version, onBrowse: browse,
    onMethodChange: () => paint(session.view()) });
  shell.appendChild(pane);
  const $ = id => document.getElementById(id);
  let pending = null, opening = false, deferredUpdates = false, queuedUpdates = 0, latestView, targetListSignature = '';
  const session = createPilotSession({ adapter, referenceIsCurrent, onChange: paint, recordFeedback: input => feedback.record(input) });
  function show() { shell.classList.add('is-recolor'); pane.classList.remove('is-hidden'); paint(session.view()); }
  function paint(state) {
    latestView = state;
    pane.setAttribute('data-source-document-id', state.source ? String(state.source.id) : '');
    pane.setAttribute('data-working-document-id', state.workingSourceDocumentId ? String(state.workingSourceDocumentId) : '');
    pane.setAttribute('data-preview-document-id', state.previewDocumentId ? String(state.previewDocumentId) : '');
    const busy = state.busy || opening || queuedUpdates > 0;
    $('recolorBinding').textContent = state.source ? state.source.name : 'Select your product in Photoshop';
    $('recolorSource').textContent = state.source ? 'Bound source: ' + state.source.name + ' · Adobe RGB working copy' + (state.sourceRecovered ? '. Internal source recovered from the unchanged original; edited copies kept open.' : '') : 'Activate the original product image. Its current appearance will be the source.';
    $('recolorStatus').textContent = state.message;
    $('recolorMaskStatus').textContent = state.hasMask ? 'Material mask ready. Selection outline restored. Next: choose an approved reference.' : 'No material mask captured yet.';
    $('recolorMaskStatus').classList.toggle('is-ready', state.hasMask);
    $('recolorReference').textContent = state.target ? state.target.reference.colorName + ' · ' + state.target.reference.filename + (state.target.sampled ? ' · sampled' : ' · select fabric, then sample') : pending ? pending.reference.colorName + ' selected. Bind your product first.' : 'Browse an approved color and choose Apply Color on its reference.';
    for (const id of ['recolorBegin', 'recolorProduct', 'recolorMask', 'recolorSample', 'recolorPreview', 'recolorBefore', 'recolorApply', 'recolorSave', 'recolorSaveJpeg', 'recolorNew', 'recolorEnd', 'recolorTarget', 'recolorMaskSource', 'recolorMethod', 'recolorTuneToggle']) $(id).disabled = busy;
    $('recolorBegin').disabled = busy || Boolean(state.source);
    $('recolorProduct').disabled = busy || !state.source;
    $('recolorMask').disabled = busy || !state.source || state.committed || state.rendered;
    $('recolorSample').disabled = busy || !state.target;
    $('recolorPreview').disabled = busy || !state.hasMask || !state.target || !state.target.sampled;
    $('recolorBefore').disabled = busy || !state.rendered || state.committed;
    $('recolorApply').disabled = busy || !state.rendered || state.committed;
    $('recolorSave').disabled = busy || !state.committed;
    $('recolorSaveJpeg').disabled = busy || !state.committed;
    $('recolorNew').disabled = busy || !state.source;
    $('recolorEnd').disabled = busy || !state.source;
    $('recolorCancel').classList.toggle('is-hidden', !state.fitting);
    $('recolorBefore').textContent = state.showingAfter ? 'Show original' : 'Show recolored';
    const oldTarget = $('recolorTarget').value, nextTargetSignature = JSON.stringify(state.targets);
    if (nextTargetSignature !== targetListSignature) {
      $('recolorTarget').innerHTML = '';
      for (const t of state.targets) { const option = document.createElement('option'); option.value = t.id; option.textContent = t.name + (t.sampled ? '' : ' (sample required)'); $('recolorTarget').appendChild(option); }
      targetListSignature = nextTargetSignature;
    }
    $('recolorTarget').selectedIndex = state.targets.findIndex(target => target.id === (state.target ? state.target.key : oldTarget));
    for (const slider of pane.querySelectorAll('[data-recolor-parameter]')) {
      slider.disabled = (busy && !deferredUpdates) || !state.rendered || state.committed;
      if (state.recipe && !deferredUpdates) { slider.value = state.recipe.parameters[slider.getAttribute('data-recolor-parameter')]; slider.nextElementSibling.textContent = slider.value; }
    }
    panelView.paint(state, { opening, pending, updating: queuedUpdates > 0 });
  }
  async function run(work) {
    try { await work(); }
    catch (error) { panelView.error(error.message || String(error)); console.error('Recolor operation failed', error); }
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
    panelView.loading('Loading and checking the approved reference. Photoshop remains available.');
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
  $('recolorClose').addEventListener('click', browse);
  $('recolorBegin').addEventListener('click', () => run(async () => { await session.begin(adapter.inspect().id); await refreshMasks(); await openPendingReference(); }));
  $('recolorProduct').addEventListener('click', () => run(() => adapter.activateDocument(session.view().previewDocumentId)));
  $('recolorMaterial').addEventListener('change', () => run(() => session.setMaterial($('recolorMaterial').value)));
  $('recolorMask').addEventListener('click', () => run(async () => { await session.useMask(JSON.parse($('recolorMaskSource').value), { material: $('recolorMaterial').value }); await refreshMasks(); }));
  $('recolorSample').addEventListener('click', () => run(() => session.sampleReference()));
  $('recolorPreview').addEventListener('click', () => run(() => {
    const state = session.view();
    const method = state.rendered ? panelView.selectedMethod() : 'AUTO';
    journal.record('preview-' + method, 'started', state);
    return session.preview(method).then(result=>{journal.record('preview-' + method,'completed',session.view());return result;},error=>{journal.record('preview-' + method,'failed',session.view());throw error;});
  }));
  $('recolorBefore').addEventListener('click', () => run(() => session.toggle()));
  $('recolorApply').addEventListener('click', () => run(() => session.apply({ reviewOverride: $('recolorDraftOverride').getAttribute('aria-pressed') === 'true' })));
  $('recolorDraftOverride').addEventListener('click', () => {
    const control = $('recolorDraftOverride');
    control.setAttribute('aria-pressed', control.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
    paint(session.view());
  });
  $('recolorFeedbackSave').addEventListener('click', () => run(() => session.feedback({ outcome: $('recolorFeedbackOutcome').value, note: $('recolorFeedbackNote').value })));
  $('recolorCancel').addEventListener('click', () => session.cancelFit());
  $('recolorNew').addEventListener('click', () => run(async () => { await session.newVariant(); await refreshMasks(); }));
  $('recolorTarget').addEventListener('change', () => run(async () => { await session.selectTarget($('recolorTarget').value); await refreshMasks(); }));
  $('recolorEnd').addEventListener('click', () => run(async () => { await session.end(); pending = null; $('recolorMaskSource').innerHTML = ''; paint(session.view()); }));
  $('recolorSave').addEventListener('click', () => run(async () => {
    const state = session.view(), color = state.target.reference.colorName.replace(/[^\w -]/g, '').slice(0, 40);
    const file = await fs.getFileForSaving('recolor-' + color + '-' + Date.now() + '.psd', { types: ['psd', 'psb'] });
    if (file) await session.save(file, await fs.getDataFolder());
  }));
  $('recolorSaveJpeg').addEventListener('click', () => run(async () => {
    const state = session.view(), color = state.target.reference.colorName.replace(/[^\w -]/g, '').slice(0, 40);
    const file = await fs.getFileForSaving('recolor-' + color + '-' + Date.now() + '.jpg', { types: ['jpg', 'jpeg'] });
    if (file) await session.saveJpeg(file, await fs.getDataFolder());
  }));
  const update = latestQueue(async parameters => {
    journal.record('manual-adjustment', 'started', session.view(), parameters);
    try { await session.update(parameters); journal.record('manual-adjustment','completed',session.view()); }
    catch(error){journal.record('manual-adjustment','failed',session.view(),parameters);throw error;}
  }, { delayMs: 180 });
  $('recolorMethod').selectedIndex = 0;
  for (const slider of pane.querySelectorAll('[data-recolor-parameter]')) slider.addEventListener('input', () => {
    if (slider.disabled || !latestView.rendered || !latestView.recipe || latestView.committed) return;
    const parameters = {};
    for (const control of pane.querySelectorAll('[data-recolor-parameter]')) { parameters[control.getAttribute('data-recolor-parameter')] = Number(control.value); control.nextElementSibling.textContent = control.value; }
    deferredUpdates = true;
    queuedUpdates++;
    if (queuedUpdates === 1) paint(session.view());
    let updateError;
    update(parameters).catch(error => { updateError = error.message; }).finally(() => {
      queuedUpdates--; deferredUpdates = queuedUpdates > 0;
      if (!deferredUpdates) { paint(session.view()); if (updateError) panelView.error(updateError); }
    });
  });
  paint(session.view());
  return {
    chooseReference(group, ref, clientId) {
      if (session.view().busy || opening || queuedUpdates > 0) { show(); return; }
      pending = { ref, reference: { clientId, colorId: group.id, colorName: group.displayName,
        referenceId: ref.portalReferenceId, versionId: ref.versionId, versionNumber: ref.versionNumber,
        checksumSha256: ref.checksumSha256 || '', filename: ref.baseName, kind: ref.referenceKind,
        approvedAt: ref.approvedAt || null, approvalProvenance: 'EXISTING_CLIENT_LIBRARY', source: 'APPROVED_LIBRARY_REFERENCE' } };
      show(); run(openPendingReference);
    },
    registerReferenceDocument: documentId => adapter.markReference(documentId),
    destroy: () => panelView.destroy()
  };
}

module.exports = { mountRecolorPilot };
