// Exercise the current section-four controller and view in Photoshop's actual
// UXP DOM. A scoped document and in-memory adapter keep the user's documents
// and active recoloring session out of this UI regression test.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { connection } = require('./test-recolor-panel-live');
const root = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  const loaded = JSON.parse(fs.readFileSync(path.join(root, 'storage/recolor-dev/current-ui-session.json')));
  const channel = connection('ws://127.0.0.1:14001/socket/cdt/' + loaded.pluginSessionId);
  const report = { startedAt: new Date().toISOString(), checks: [], photoshopDocumentsTouched: false };
  let contextId, attached = false;
  async function evaluate(expression) {
    const response = await channel.request({ method: 'Runtime.evaluate', params: { expression, contextId, returnByValue: true } });
    if (response.error || response.result.exceptionDetails) throw new Error(response.error?.message || response.result.exceptionDetails.exception?.description || response.result.exceptionDetails.text);
    return response.result.result.value;
  }
  async function until(expression) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await evaluate(expression);
      if (result) return result;
      await pause(30);
    }
    throw new Error('UI did not settle: ' + expression);
  }
  const sources = {};
  for (const name of ['pilot-panel', 'pilot-session', 'panel-view', 'preview-review', 'fitting', 'recipes', 'quality', 'action-journal', 'method-policy', 'color', 'fabric-analysis', 'fabric-quality', 'fabric-recipes', 'recolor-engine', 'feedback-store']) {
    sources['./' + name] = fs.readFileSync(path.join(root, 'UXP/recolor/' + name + '.js'), 'utf8');
  }
  try {
    await channel.ready;
    await channel.request({ method: 'Runtime.enable', params: {} });
    for (let attempt = 0; attempt < 50 && !contextId; attempt++) {
      for (const entry of channel.events.filter(event => event.method === 'Runtime.executionContextCreated')) {
        contextId = entry.params.context.id;
        try { if (await evaluate(`typeof document!=='undefined'&&!!document.querySelector('.app-shell')`)) break; } catch (_) { /* Another execution world. */ }
        contextId = undefined;
      }
      if (!contextId) await pause(50);
    }
    if (!contextId && !await evaluate(`typeof document!=='undefined'&&!!document.querySelector('.app-shell')`)) throw new Error('Open the Color Library panel in Photoshop before running this test.');
    attached = true;
    assert.equal(await evaluate(`document.querySelector('.recolor-panel')?.getAttribute('aria-busy')==='true'`), false, 'Wait for the current Photoshop operation before testing');
    await evaluate(`(() => {
      if (window.__adjustmentUiTest) throw new Error('A previous scoped UI test needs cleanup');
      const sources = ${JSON.stringify(sources)}, cache = {}, nativeRequire = require;
      const container = document.createElement('div');
      container.style.position = 'absolute'; container.style.left = '-10000px'; container.style.width = '360px'; container.style.height = '900px';
      container.innerHTML = '<div class="app-shell"><div id="librarySwitch"></div></div>';
      document.body.appendChild(container);
      const state = window.__adjustmentUiTest = { container, gate: false, renders: [], committed: null };
      const doc = { createElement: tag => document.createElement(tag), defaultView: document.defaultView,
        querySelector: selector => container.querySelector(selector), getElementById: id => container.querySelector('#' + id) };
      let active = 1, next = 2;
      const documents = new Map();
      const frame = value => ({width:32,height:32,components:3,maximum:65535,profile:'Adobe RGB (1998)',bounds:{left:0,top:0,right:32,bottom:32},data:new Uint16Array(32*32*3).fill(value)});
      documents.set(1, frame(15000)); documents.set(2, frame(30000));
      const mask = {left:8,top:8,width:16,height:16,maximum:255,data:new Uint8Array(256).fill(255)};
      const inspect = id => ({id:id||active,name:'Scoped test',path:'C:/scoped-test-'+(id||active),profile:'Adobe RGB (1998)',historyId:1});
      const adapter = { inspect, markReference(){},
        async captureSource(id){const original=inspect(id),documentId=++next;documents.set(documentId,documents.get(id));return{original,documentId};},
        async createPreview(snapshot){const documentId=++next;documents.set(documentId,documents.get(snapshot.documentId));active=documentId;return{documentId,committed:false,recipe:null,snapshot};},
        async showMaterialSelection(){}, async cancel(){}, async releaseSource(){},
        async readPixels(id){return documents.get(id);}, async acquireMask(){return mask;},
        async maskSources(){return{layers:[],channels:[],paths:[]};}, async activateDocument(id){active=id;},
        async openDocument(){return{id:2};}, async toggle(){},
        async render(preview,recipe){
          if(state.gate)await new Promise(resolve=>{state.release=()=>{state.gate=false;resolve();};});
          const baseline=documents.get(preview.snapshot.documentId),result={...baseline,data:new Uint16Array(baseline.data)};
          for(let y=8;y<24;y++)for(let x=8;x<24;x++)for(let c=0;c<3;c++)result.data[(y*32+x)*3+c]=30000;
          documents.set(preview.documentId,result);preview.recipe=JSON.parse(JSON.stringify(recipe));state.renders.push(preview.recipe);
          return{targetGamutClipped:false};
        },
        async commit(preview){preview.committed=true;state.committed=JSON.parse(JSON.stringify(preview.recipe));return{documentId:preview.documentId,recipe:preview.recipe};}
      };
      function load(name){
        if(name==='../package.json')return nativeRequire('./package.json');
        if(name==='./photoshop-adapter')return{createPhotoshopAdapter:()=>adapter};
        if(name==='./file-identity')return{fingerprintFile:async()=>({sha256:'test'})};
        if(!sources[name])return nativeRequire(name.startsWith('./')?'./recolor/'+name.slice(2):name);
        if(!cache[name]){const module={exports:{}};cache[name]=module;new Function('require','module','exports',sources[name])(load,module,module.exports);}
        return cache[name].exports;
      }
      state.feedbackRecords=[];
      function memoryFolder(){const entries=new Map();return{
        async getEntry(name){if(!entries.has(name))throw new Error('Not found');return entries.get(name);},
        async createFolder(name){const f=memoryFolder();entries.set(name,f);return f;},
        async createFile(name){let text='';const f={nativePath:'C:/scoped-test/'+name,async read(){return text;},async write(value){text=value;const record=JSON.parse(value);if(record.outcome)state.feedbackRecords.push(record);}};entries.set(name,f);return f;}
      };}
      const memory=memoryFolder();
      const storage={localFileSystem:{async getTemporaryFolder(){return memory;},async getDataFolder(){return memory;}}};
      state.pilot=load('./pilot-panel').mountRecolorPilot({document:doc,photoshop:{},storage,referenceIsCurrent:()=>true,
        getReferenceFile:async()=>({async copyTo(){return{url:'test',nativePath:'C:/scoped-reference'};}})});
      state.element=id=>doc.getElementById(id);
      return true;
    })()`);
    const event = (id, type = 'click', setup = '') => evaluate(`(()=>{const t=window.__adjustmentUiTest,e=t.element(${JSON.stringify(id)});${setup};e.dispatchEvent(new Event(${JSON.stringify(type)},{bubbles:true}));return true;})()`);
    async function completedPreview() {
      await until(`!window.__adjustmentUiTest.element('recolorPreview').disabled&&!!window.__adjustmentUiTest.element('recolorCurrentMethod').textContent`);
      if (await evaluate(`!window.__adjustmentUiTest.element('recolorDraftArea').classList.contains('is-hidden')`)) {
        assert.equal(await evaluate(`window.__adjustmentUiTest.element('recolorApply').disabled`), true);
        await event('recolorDraftOverride');
      }
      await until(`!window.__adjustmentUiTest.element('recolorApply').disabled`);
    }
    await event('recolorShow'); await event('recolorBegin');
    await until(`!window.__adjustmentUiTest.element('recolorMask').disabled`);
    await event('recolorMask');
    await until(`window.__adjustmentUiTest.element('recolorMaskStatus').textContent.includes('ready')`);
    await evaluate(`(()=>{window.__adjustmentUiTest.pilot.chooseReference({id:'test',displayName:'Test'}, {portalReferenceId:'ref',versionId:'v1',baseName:'ref.jpg'}, 'test');return true;})()`);
    await until(`!window.__adjustmentUiTest.element('recolorSample').disabled`);
    await event('recolorSample');
    await until(`!window.__adjustmentUiTest.element('recolorPreview').disabled`);
    assert.equal(await evaluate(`window.__adjustmentUiTest.element('recolorReviewControls').classList.contains('is-hidden')`), true);
    await event('recolorPreview');
    await completedPreview();
    assert.deepEqual(await evaluate(`[...new Set(window.__adjustmentUiTest.renders.map(recipe=>recipe.method))].sort()`), ['A', 'B', 'C', 'D']);
    assert.match(await evaluate(`window.__adjustmentUiTest.element('recolorCurrentMethod').textContent`), /Automatic chose/);
    report.checks.push('First preview compares all four methods, shows the winner and requires explicit unresolved-QC draft acknowledgement');
    await event('recolorFeedbackOutcome','change','e.selectedIndex=1');
    await evaluate(`window.__adjustmentUiTest.element('recolorFeedbackNote').value='Highlights need more fabric detail';true`);
    await event('recolorFeedbackSave');
    await until(`window.__adjustmentUiTest.feedbackRecords.length===1`);
    assert.equal(await evaluate(`window.__adjustmentUiTest.feedbackRecords[0].outcome`),'NEEDS_CORRECTION');
    assert.equal(await evaluate(`window.__adjustmentUiTest.feedbackRecords[0].automaticallyTrained`),false);
    report.checks.push('Explicit feedback records the reviewed recipe and QC locally without changing calibration');
    await event('recolorTuneToggle');
    assert.equal(await evaluate(`window.__adjustmentUiTest.element('recolorFineTune').getAttribute('aria-hidden')`), 'false');
    await event('recolorTuneToggle');
    assert.equal(await evaluate(`window.__adjustmentUiTest.element('recolorFineTune').getAttribute('aria-hidden')`), 'true');
    report.checks.push('Native button opens and closes all manual controls');
    await event('recolorMethod', 'change', `e.selectedIndex=3`);
    assert.equal(await evaluate(`window.__adjustmentUiTest.element('recolorApply').disabled`), true);
    assert.match(await evaluate(`window.__adjustmentUiTest.element('recolorMethodReview').textContent`), /canvas still shows/);
    await event('recolorPreview');
    await completedPreview();
    assert.equal(await evaluate(`window.__adjustmentUiTest.element('recolorCurrentMethod').textContent`), 'Preview: Gradient and tone');
    assert.match(await evaluate(`window.__adjustmentUiTest.element('recolorMethodReview').textContent`), /ΔE00/);
    report.checks.push('Method change awaits Refresh, then shows its own measured review');
    await event('recolorTuneToggle');
    await evaluate(`(()=>{const t=window.__adjustmentUiTest;t.gate=true;t.sliderRenderStart=t.renders.length;const brightness=t.container.querySelector('[data-recolor-parameter="lightness"]');brightness.value=7.75;brightness.dispatchEvent(new Event('input',{bubbles:true}));const slider=t.container.querySelector('[data-recolor-parameter="intensity"]');slider.value=80;slider.dispatchEvent(new Event('input',{bubbles:true}));slider.value=81;slider.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
    assert.equal(await evaluate(`window.__adjustmentUiTest.element('recolorApply').disabled`), true);
    await until(`typeof window.__adjustmentUiTest.release==='function'`);
    await evaluate(`window.__adjustmentUiTest.release();true`);
    await completedPreview();
    assert.equal(await evaluate(`window.__adjustmentUiTest.renders.length-window.__adjustmentUiTest.sliderRenderStart`), 1);
    assert.match(await evaluate(`window.__adjustmentUiTest.element('recolorCurrentMethod').textContent`), /manually adjusted/);
    await event('recolorApply');
    await until(`!!window.__adjustmentUiTest.committed`);
    assert.equal(await evaluate(`window.__adjustmentUiTest.committed.method`), 'C');
    assert.equal(await evaluate(`window.__adjustmentUiTest.committed.parameters.intensity`), 81);
    assert.equal(await evaluate(`window.__adjustmentUiTest.committed.parameters.lightness`), 7.75);
    report.checks.push('Rapid slider changes block Apply until the final value is rendered and committed');
    await until(`!window.__adjustmentUiTest.element('recolorNew').disabled`);
    await event('recolorNew');
    await until(`!window.__adjustmentUiTest.element('recolorPreview').disabled`);
    assert.equal(await evaluate(`window.__adjustmentUiTest.element('recolorReviewControls').classList.contains('is-hidden')`), true);
    await event('recolorPreview');
    await completedPreview();
    await until(`window.__adjustmentUiTest.element('recolorMethod').value==='AUTO'`);
    assert.match(await evaluate(`window.__adjustmentUiTest.element('recolorCurrentMethod').textContent`), /Automatic chose/);
    report.checks.push('New variant resets method selection and starts with a fresh automatic preview');
    await event('recolorMethod', 'change', `e.selectedIndex=4`);
    await evaluate(`(()=>{window.__adjustmentUiTest.pilot.chooseReference({id:'other',displayName:'Other'}, {portalReferenceId:'other-ref',versionId:'v1',baseName:'other.jpg'}, 'test');return true;})()`);
    await until(`!window.__adjustmentUiTest.element('recolorSample').disabled`);
    await event('recolorSample');
    await until(`!window.__adjustmentUiTest.element('recolorPreview').disabled`);
    await event('recolorPreview');
    await completedPreview();
    await until(`window.__adjustmentUiTest.element('recolorMethod').value==='AUTO'`);
    report.checks.push('Changing the approved target clears the pending method and restores automatic first-preview behavior');
    report.passed = true;
  } finally {
    if (attached) await evaluate(`(()=>{const t=window.__adjustmentUiTest;if(t){if(t.release)t.release();if(t.pilot)t.pilot.destroy();t.container.remove();delete window.__adjustmentUiTest;}return true;})()`).catch(() => {});
    channel.close();
    report.finishedAt = new Date().toISOString();
    report.path = path.join(root, 'storage/recolor-dev/adjustments-ui-check-' + Date.now() + '.json');
    fs.writeFileSync(report.path, JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify(report, null, 2));
  return report;
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
