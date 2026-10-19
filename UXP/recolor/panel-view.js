const controlIds = ['recolorClose', 'recolorBegin', 'recolorProduct', 'recolorMaskSource', 'recolorMask',
  'recolorTarget', 'recolorSample', 'recolorPreview', 'recolorBefore', 'recolorCancel', 'recolorMethod',
  'recolorApply', 'recolorSave', 'recolorSaveJpeg', 'recolorNew', 'recolorEnd'];

function panelMarkup(version) {
  const step = (number, title, body) => `<section class="recolor-step" data-recolor-step="${number}">
    <div class="recolor-step-toggle" role="button" tabindex="0" data-recolor-toggle="${number}" aria-expanded="false" aria-controls="recolorStepBody${number}">
      <span class="recolor-step-number">${number}</span><div class="recolor-step-copy"><strong>${title}</strong><span id="recolorStepSummary${number}"></span></div>
      <span id="recolorStepBadge${number}" class="recolor-step-badge"></span><span class="recolor-step-chevron" aria-hidden="true">+</span>
    </div><div id="recolorStepBody${number}" class="recolor-step-body">${body}</div></section>`;
  return `<div class="recolor-heading"><div class="recolor-title"><div class="recolor-title-line"><h2>Recolor</h2><span class="recolor-build">Pilot ${version}</span></div><p>From approved reference to editable color.</p></div>
    <button id="recolorClose" class="secondary-button recolor-library-button" type="button">Browse library</button></div>
    <div id="recolorContext" class="recolor-context"><div class="recolor-context-copy"><span class="recolor-caption">PRODUCT</span><strong id="recolorContextName"></strong></div><button id="recolorProduct" class="secondary-button" type="button">Go to preview</button></div>
    <div id="recolorNotice" class="recolor-notice"><div class="recolor-notice-heading"><span class="recolor-status-dot"></span><strong id="recolorStatusTitle">Start with your product</strong></div><p id="recolorStatus" role="status" aria-live="polite"></p></div>
    <div class="recolor-content">
      ${step(1, 'Product image', `<p id="recolorSource"></p><button id="recolorBegin" class="primary-button recolor-full" type="button">Use active product</button><p id="recolorSourceHint" class="recolor-help">Open the original product tab first. A layered working copy keeps your source intact.</p><div class="recolor-profile-note">Adobe RGB master <span>16-bit working copy</span></div>`)}
      ${step(2, 'Material selection', `<p class="recolor-help">In the preview, select only the fabric or surface you want to recolor.</p><div class="recolor-field-label">Use a selection, mask or path</div><select id="recolorMaskSource" aria-label="Material mask source"><option value='{"kind":"selection"}'>Current Photoshop selection</option></select><button id="recolorMask" class="secondary-button recolor-full" type="button">Use material selection</button><p id="recolorMaskStatus" role="status" aria-live="polite"></p>`)}
      ${step(3, 'Target color', `<button id="recolorBrowseTarget" class="secondary-button recolor-full" type="button">Choose approved color</button><div id="recolorTargetField"><div class="recolor-field-label">Selected color</div><select id="recolorTarget" aria-label="Recolor target"></select></div><p id="recolorReference" class="recolor-reference"></p><div id="recolorSampleArea"><p class="recolor-help">On the reference image, select an evenly lit fabric patch. Avoid shadows, shine and background.</p><button id="recolorSample" class="secondary-button recolor-full" type="button">Sample reference</button></div>`)}
      ${step(4, 'Preview & adjust', `<div class="recolor-row recolor-preview-actions"><button id="recolorPreview" class="primary-button" type="button">Preview color</button><button id="recolorBefore" class="secondary-button" type="button">Show original</button></div><div id="recolorCompareState" class="recolor-compare-state"></div><button id="recolorCancel" class="secondary-button recolor-full is-hidden" type="button">Cancel matching</button>
        <p id="recolorTuneHint" class="recolor-help">Create a preview to compare the result and fine-tune it.</p>
        <details id="recolorFineTune" class="recolor-tuning"><summary>Fine-tune color & tone</summary>
          ${[['intensity', 'Color intensity', 0, 100, 100], ['lightness', 'Brightness', -60, 60, 0], ['contrast', 'Contrast', -40, 40, 0], ['shadows', 'Shadows', -25, 25, 0], ['highlights', 'Highlights', -25, 25, 0]].map(([key, label, min, max, value]) => `<label class="recolor-slider"><span class="recolor-slider-label">${label}</span><input aria-label="${label}" data-recolor-parameter="${key}" type="range" min="${min}" max="${max}" value="${value}"><span class="recolor-slider-value">${value}</span></label>`).join('')}
          <div class="recolor-method"><div class="recolor-field-label">Recoloring method</div><select id="recolorMethod" aria-label="Recoloring method"><option value="AUTO">Automatic comparison</option><option value="A">Color and curves</option><option value="B">Hue and selective color</option><option value="C">Gradient and tone</option><option value="D">Tint and levels</option></select><p class="recolor-help">Method changes take effect on the next preview.</p></div>
        </details><p id="recolorMeasurement" class="recolor-measurement"></p>`)}
    </div>
    <div class="recolor-footer"><div id="recolorApplyArea"><button id="recolorApply" class="primary-button recolor-full" type="button">Apply Color</button><p id="recolorApplyHint" class="recolor-footer-hint">Complete the steps above to create a preview.</p></div>
      <div id="recolorSaveArea"><div class="recolor-save-heading"><strong>Save your result</strong><span>Editable layers applied</span></div><div class="recolor-row recolor-save-actions"><div><button id="recolorSave" class="secondary-button" type="button">Save PSD/PSB</button><span>Editable · Adobe RGB</span></div><div><button id="recolorSaveJpeg" class="secondary-button" type="button">Save JPEG</button><span>Delivery · sRGB</span></div></div></div>
      <div id="recolorSessionActions" class="recolor-row recolor-session-actions"><button id="recolorNew" class="recolor-text-button" type="button">New variant</button><button id="recolorEnd" class="recolor-text-button" type="button" title="Choose another source; your open results stay in Photoshop">Change product</button></div>
    </div>`;
}

// A presentation-only view. Preserving controls allows an active development
// session to adopt the layout without replacing listeners, masks or documents.
function createPanelView({ document, pane, version, onBrowse, preserveControls = false }) {
  const selectIds = ['recolorMaskSource', 'recolorTarget', 'recolorMethod'], selections = new Map();
  const rememberSelections = () => {
    for (const id of selectIds) {
      const select = pane.querySelector('#' + id);
      if (select && select.selectedIndex >= 0 && select.value != null) selections.set(id, select.value);
    }
  };
  if (preserveControls) rememberSelections();
  const content = document.createElement('div');
  content.innerHTML = panelMarkup(version);
  if (preserveControls) {
    for (const id of controlIds) {
      const previous = pane.querySelector('#' + id), next = content.querySelector('#' + id);
      if (previous && next) {
        previous.className = next.className;
        if (next.tagName.toLowerCase() === 'button') previous.textContent = next.textContent;
        next.parentNode.replaceChild(previous, next);
      }
    }
    for (const previous of pane.querySelectorAll('[data-recolor-parameter]')) {
      const next = content.querySelector('[data-recolor-parameter="' + previous.getAttribute('data-recolor-parameter') + '"]');
      if (next) next.parentNode.replaceChild(previous, next);
    }
  }
  pane.innerHTML = '';
  while (content.firstChild) pane.appendChild(content.firstChild);
  const $ = id => pane.querySelector('#' + id);
  let lastPhase = null, lastState, selectionTimer;
  function restoreSelections() {
    for (const id of selectIds) {
      const select = $(id), wanted = id === 'recolorTarget' && lastState && lastState.target ? lastState.target.key : selections.get(id);
      const options = Array.from(select.querySelectorAll('option'));
      const index = options.findIndex(option => option.value === wanted);
      if (index >= 0) select.selectedIndex = index;
      else if (select.selectedIndex < 0 && options.length && id !== 'recolorTarget') select.selectedIndex = 0;
    }
  }
  function settleSelections() {
    restoreSelections(); clearTimeout(selectionTimer);
    // UXP recreates native select widgets after reparenting/visibility updates.
    selectionTimer = setTimeout(restoreSelections, 0);
  }
  for (const id of selectIds) $(id).addEventListener('change', rememberSelections);
  function scrollActive() {
    if (!lastPhase || pane.classList.contains('is-hidden')) return;
    const area = pane.querySelector('.recolor-content'), card = pane.querySelector('[data-recolor-step="' + lastPhase + '"]');
    area.scrollTop += card.getBoundingClientRect().top - area.getBoundingClientRect().top;
  }
  const viewport = document.defaultView || (typeof window !== 'undefined' ? window : null);
  const resize = () => setTimeout(scrollActive, 0);
  if (viewport && viewport.addEventListener) viewport.addEventListener('resize', resize);
  function openStep(number) {
    rememberSelections();
    for (const section of pane.querySelectorAll('[data-recolor-step]')) {
      const open = Number(section.getAttribute('data-recolor-step')) === number;
      section.classList.toggle('is-collapsed', !open);
      section.querySelector('[data-recolor-toggle]').setAttribute('aria-expanded', String(open));
      section.querySelector('.recolor-step-chevron').textContent = open ? '−' : '+';
    }
    settleSelections();
  }
  // Native UXP buttons flatten nested content into one label. A focusable
  // disclosure row preserves the number, two text lines and separate status.
  for (const toggle of pane.querySelectorAll('[data-recolor-toggle]')) {
    const activate = () => openStep(toggle.getAttribute('aria-expanded') === 'true' ? 0 : Number(toggle.getAttribute('data-recolor-toggle')));
    toggle.addEventListener('click', activate);
    toggle.addEventListener('keydown', event => {
      if (!['Enter', ' ', 'Spacebar'].includes(event.key)) return;
      event.preventDefault();
      if (!event.repeat) activate();
    });
  }
  $('recolorBrowseTarget').addEventListener('click', onBrowse);
  function visible(id, show) { $(id).classList.toggle('is-hidden', !show); }
  function notice(title, message, kind) {
    $('recolorStatusTitle').textContent = title;
    $('recolorStatus').textContent = message;
    $('recolorNotice').className = 'recolor-notice' + (kind ? ' is-' + kind : '');
    $('recolorStatus').setAttribute('role', kind === 'error' ? 'alert' : 'status');
  }
  function paint(state, { opening = false, pending = null } = {}) {
    rememberSelections();
    if (lastState && (lastState.source && lastState.source.id) !== (state.source && state.source.id)) {
      selections.delete('recolorMaskSource');
      const source = $('recolorMaskSource');
      if (source.querySelectorAll('option').length) source.selectedIndex = 0;
    }
    lastState = state;
    const phase = !state.source ? 1 : !state.hasMask ? 2 : !state.target || !state.target.sampled ? 3 : 4;
    const busy = state.busy || opening;
    if (phase !== lastPhase) {
      openStep(phase); lastPhase = phase;
      setTimeout(scrollActive, 0);
    }
    pane.setAttribute('data-recolor-phase', String(phase));
    pane.setAttribute('aria-busy', String(busy));
    visible('recolorContext', Boolean(state.source));
    $('recolorContextName').textContent = state.source ? state.source.name : '';
    $('recolorContextName').setAttribute('title', state.source ? state.source.name : '');
    $('recolorSource').textContent = state.source ? state.source.name : 'Activate the original product image in Photoshop.';
    $('recolorSourceHint').textContent = state.sourceRecovered ? 'Working copy recovered. Earlier edited copies remain open.' : 'Your original stays intact. Prepare any existing recoloring visibility before starting.';
    visible('recolorBegin', !state.source);
    $('recolorMaskStatus').textContent = state.hasMask ? 'Material mask ready. You can inspect it in the preview.' : 'No material mask captured yet.';
    $('recolorMaskStatus').classList.toggle('is-ready', state.hasMask);
    visible('recolorTargetField', state.targets.length > 0);
    visible('recolorSampleArea', Boolean(state.target));
    $('recolorBrowseTarget').textContent = state.target ? 'Choose another approved color' : 'Choose approved color';
    $('recolorBrowseTarget').disabled = busy;
    $('recolorReference').textContent = state.target ? state.target.reference.filename + (state.target.sampled ? ' · sampled' : ' · sample required') : pending ? pending.reference.colorName + ' selected. Start with your product.' : 'Choose a client-approved reference from the library.';
    $('recolorReference').setAttribute('title', $('recolorReference').textContent);
    visible('recolorFineTune', Boolean(state.rendered && !state.committed));
    visible('recolorTuneHint', !state.rendered);
    visible('recolorCompareState', Boolean(state.rendered));
    $('recolorCompareState').textContent = state.committed ? 'Editable result applied. Continue normal Photoshop editing.' : state.showingAfter ? 'Viewing recolored preview' : 'Viewing original appearance';
    $('recolorPreview').textContent = state.rendered ? 'Refresh preview' : 'Preview color';
    $('recolorMeasurement').classList.toggle('is-hidden', !state.rendered || !state.quality || !state.quality.available);
    visible('recolorApplyArea', !state.committed);
    visible('recolorSaveArea', state.committed);
    visible('recolorSessionActions', Boolean(state.source));
    $('recolorApplyHint').textContent = state.rendered ? 'Keeps editable layers and the material mask.' : 'Create a preview before applying the color.';
    const summaries = [state.source ? state.source.name : 'Choose the original image', state.hasMask ? 'Material mask captured' : 'Isolate the fabric or surface', state.target ? state.target.reference.colorName : 'Choose an approved reference', state.committed ? 'Editable result applied' : state.rendered ? 'Preview ready for review' : 'Compare, adjust and apply'];
    const badges = [state.source ? 'Ready' : '', state.hasMask ? 'Ready' : '', state.target && state.target.sampled ? 'Sampled' : state.target ? 'Sample' : '', state.committed ? 'Applied' : state.rendered ? 'Ready' : ''];
    for (let i = 1; i <= 4; i++) {
      $('recolorStepSummary' + i).textContent = summaries[i - 1];
      $('recolorStepSummary' + i).setAttribute('title', summaries[i - 1]);
      $('recolorStepBadge' + i).textContent = badges[i - 1];
      pane.querySelector('[data-recolor-step="' + i + '"]').classList.toggle('is-current', phase === i);
    }
    const title = opening ? 'Opening approved reference' : state.fitting ? 'Matching color' : busy ? 'Working in Photoshop' : !state.source ? 'Start with your product' : !state.hasMask ? 'Select the material' : !state.target ? 'Choose your target color' : !state.target.sampled ? 'Sample the reference' : state.committed ? 'Ready to save' : state.rendered ? 'Review your preview' : 'Create your preview';
    notice(title, state.message, busy ? 'busy' : state.committed ? 'success' : '');
    settleSelections();
  }
  return { paint, error: message => notice('Action needed', message, 'error'),
    loading: message => notice('Opening approved reference', message, 'busy'),
    state: () => lastState, destroy: () => { clearTimeout(selectionTimer); if (viewport && viewport.removeEventListener) viewport.removeEventListener('resize', resize); } };
}

module.exports = { panelMarkup, createPanelView };
