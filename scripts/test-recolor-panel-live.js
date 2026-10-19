// Runs the built panel in Photoshop through the local Adobe UXP Developer Tool.
// Uses real panel events and real modal scopes, unlike standalone .psjs tests.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function connection(url) {
  const socket = new WebSocket(url), events = [], pending = new Map(); let sequence = 0;
  const ready = new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error('Adobe UDT connection failed')); });
  socket.onmessage = event => {
    const message = JSON.parse(event.data); events.push(message);
    const id = message.requestId || message.id, callback = pending.get(id);
    if (callback) { clearTimeout(callback.timer); pending.delete(id); callback.resolve(message); }
  };
  return { events, ready,
    async request(message, idField = 'id') {
      await ready; const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Adobe UDT request timed out: ' + (message.method || message.message?.action || message.command))); }, 15000);
        pending.set(id, { resolve, timer }); socket.send(JSON.stringify({ ...message, [idField]: id }));
      });
    },
    close() { for (const value of pending.values()) clearTimeout(value.timer); pending.clear(); socket.close(); }
  };
}

async function run() {
  const build = JSON.parse(fs.readFileSync(path.join(root, 'storage/recolor-dev/latest-pilot.json'), 'utf8'));
  const pluginPath = path.resolve(build.pluginDirectory);
  assert.ok(pluginPath.startsWith(path.join(root, 'storage/recolor-dev') + path.sep), 'Only a generated workspace pilot may be loaded');
  assert.equal(JSON.parse(fs.readFileSync(path.join(pluginPath, 'manifest.json'), 'utf8')).id, 'com.pixofix.color-library');
  const report = { startedAt: new Date().toISOString(), build, checks: [], productionQualified: false, cleanup: [] };
  let cli, cdp, contextId, serial = 0, fixture, prior, initialIds, evaluate, runOnPanel;
  const owned = new Map();
  async function until(check, description, timeout = 20000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { const result = await check(); if (result) return result; await pause(100); }
    throw new Error('Timed out: ' + description);
  }
  try {
    report.registration = require('./check-recolor-pilot').check();
    assert.ok(report.registration.runtimeMatchesLatestBuild, 'UDT points to an outdated build: ' + report.registration.registeredManifestPath);
    cli = connection('ws://127.0.0.1:14001/socket/cli'); await cli.ready;
    const host = await until(() => cli.events.find(event => event.command === 'didAddRuntimeClient' && event.app.appId === 'PS'), 'connected Photoshop', 5000);
    const currentSession = path.join(root, 'storage/recolor-dev/current-ui-session.json');
    let loaded;
    if (process.argv.includes('--attached')) {
      loaded = JSON.parse(fs.readFileSync(currentSession, 'utf8'));
    } else {
    if (fs.existsSync(currentSession)) {
      report.stage = 'unload previous development runtime';
      const old = JSON.parse(fs.readFileSync(currentSession, 'utf8'));
      await cli.request({ command: 'proxy', clientId: host.id, message: { command: 'Plugin', action: 'unload', pluginSessionId: old.pluginSessionId } }, 'requestId');
    }
    report.stage = 'validate pilot manifest';
    const validated = await cli.request({ command: 'proxy', clientId: host.id, message: { command: 'Plugin', action: 'validate',
      params: { provider: { type: 'disk', path: pluginPath } }, manifest: JSON.parse(fs.readFileSync(path.join(pluginPath, 'manifest.json'), 'utf8')) } }, 'requestId');
    if (validated.error || validated.success === false) throw new Error(validated.error || 'Manifest validation failed');
    report.stage = 'load pilot runtime';
    loaded = await cli.request({ command: 'proxy', clientId: host.id,
      message: { command: 'Plugin', action: 'load', params: { provider: { type: 'disk', path: pluginPath } }, breakOnStart: false } }, 'requestId');
    if (loaded.error) throw new Error(loaded.error);
    }
    report.pluginSessionId = loaded.pluginSessionId;
    fs.writeFileSync(path.join(root, 'storage/recolor-dev/current-ui-session.json'), JSON.stringify(loaded));
    cdp = connection('ws://127.0.0.1:14001/socket/cdt/' + loaded.pluginSessionId); await cdp.ready;
    report.stage = 'attach plugin debugger';
    await cdp.request({ method: 'Runtime.enable', params: {} });
    await cdp.request({ method: 'Debugger.enable', params: {} });
    contextId = (await until(() => cdp.events.find(event => event.method === 'Runtime.executionContextCreated'), 'plugin execution context', 5000)).params.context.id;
    evaluate = async expression => {
      const response = await cdp.request({ method: 'Runtime.evaluate', params: { expression, contextId, returnByValue: true } });
      if (response.error) throw new Error(response.error.message);
      if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description || response.result.exceptionDetails.text);
      return response.result.result.value;
    };
    // Photoshop 25.3's debugger does not await Runtime.evaluate promises reliably.
    // Schedule SDK work onto the plugin's own event loop and poll its completion.
    const inPanel = async expression => {
      const key = 'recolor-live-' + Date.now() + '-' + (++serial);
      await evaluate(`window.__recolorLiveChecks=window.__recolorLiveChecks||{};window.__recolorLiveChecks[${JSON.stringify(key)}]={state:'pending'};setTimeout(()=>{(async()=>{try{const value=await(${expression});window.__recolorLiveChecks[${JSON.stringify(key)}]={state:'complete',value};}catch(error){window.__recolorLiveChecks[${JSON.stringify(key)}]={state:'failed',error:error.message||String(error),stack:error.stack};}})();},0);true`);
      const result = await until(async () => { const value = await evaluate(`window.__recolorLiveChecks[${JSON.stringify(key)}]`); return value && value.state !== 'pending' && value; }, 'plugin operation');
      if (result.state === 'failed') throw new Error(result.error);
      return result.value;
    };
    runOnPanel = inPanel;
    const click = id => inPanel(`(()=>{const button=document.getElementById(${JSON.stringify(id)});if(!button||button.disabled)throw new Error('Control unavailable: '+${JSON.stringify(id)});button.dispatchEvent(new Event('click',{bubbles:true}));return true;})()`);
    const state = () => evaluate(`(()=>{const pane=document.querySelector('.recolor-panel');return{status:document.getElementById('recolorStatus').textContent,sourceId:Number(pane.getAttribute('data-source-document-id')),workingId:Number(pane.getAttribute('data-working-document-id')),previewId:Number(pane.getAttribute('data-preview-document-id')),beginDisabled:document.getElementById('recolorBegin').disabled,maskDisabled:document.getElementById('recolorMask').disabled,maskStatus:document.getElementById('recolorMaskStatus').textContent};})()`);
    const track = async () => {
      const view = await state();
      for (const id of [view.workingId, view.previewId]) if (id && !initialIds.includes(id)) {
        const history = await evaluate(`(()=>{const d=Array.from(require('photoshop').app.documents).find(d=>d.id===${id});return d?d.activeHistoryState.id:null;})()`);
        owned.set(id, history);
      }
      return view;
    };
    await until(async () => {
      const contexts = cdp.events.filter(event => event.method === 'Runtime.executionContextCreated').map(event => event.params.context.id).reverse();
      for (const id of contexts) {
        contextId = id;
        try { if (await evaluate(`typeof document!=='undefined'&&!!document.getElementById('recolorShow')`)) return true; } catch (_) { /* Context may be replaced while its panel starts. */ }
      }
      return false;
    }, 'panel startup');
    await click('recolorShow');
    assert.equal(await evaluate(`document.querySelector('.recolor-panel').classList.contains('is-hidden')`), false);
    await click('recolorClose');
    assert.equal(await evaluate(`document.querySelector('.recolor-panel').classList.contains('is-hidden')`), true);
    await click('recolorShow'); report.checks.push('Recolor and Browse library respond');
    initialIds = await evaluate(`Array.from(require('photoshop').app.documents).map(d=>d.id)`);
    prior = await evaluate(`require('photoshop').app.documents.length?require('photoshop').app.activeDocument.id:null`);
    fixture = await inPanel(`(async()=>{const ps=require('photoshop'),before=Array.from(ps.app.documents).map(d=>d.id);let result;await ps.core.executeAsModal(async()=>{const name='Recolor live test '+Date.now();await ps.app.documents.add({name,width:96,height:64,resolution:72,mode:ps.constants.NewDocumentMode.RGB,fill:ps.constants.DocumentFill.WHITE,depth:16,profile:'Adobe RGB (1998)'});const created=Array.from(ps.app.documents).filter(d=>!before.includes(d.id));if(created.length!==1)throw new Error('Ambiguous test source identity');const d=created[0];await ps.action.batchPlay([{_obj:'select',_target:[{_ref:'document',_id:d.id}]}],{});result={id:d.id,name,historyId:d.activeHistoryState.id};},{commandName:'Create isolated recolor UI fixture'});return result;})()`);
    owned.set(fixture.id, fixture.historyId);
    report.fixture = fixture;
    await click('recolorBegin');
    await until(async () => { const view = await state(); if (view.status.includes('modal scope')) throw new Error(view.status); return view.sourceId === fixture.id && !view.maskDisabled; }, 'Use active product');
    let view = await track(); report.checks.push('Use active product captures the bound source through actual plugin modal scopes');
    assert.equal(await evaluate(`document.getElementById('recolorMaskSource').selectedIndex`), 0, 'Current selection must be the initial mask choice');
    assert.equal(await evaluate(`document.getElementById('recolorMethod').value`), 'AUTO', 'Automatic comparison must be the initial method');
    await inPanel(`(async()=>{const ps=require('photoshop');await ps.core.executeAsModal(async()=>{const d=Array.from(ps.app.documents).find(d=>d.id===${view.previewId});if(!d)throw new Error('Bound test preview closed');await ps.action.batchPlay([{_obj:'select',_target:[{_ref:'document',_id:d.id}]}],{});await d.selection.selectRectangle({left:16,top:12,right:80,bottom:52});},{commandName:'Select isolated test material'});})()`);
    await track();
    await click('recolorMask');
    await until(async () => { const result = await state(); if (/modal scope|Unexpected token|not currently available/.test(result.status)) throw new Error(result.status); return result.maskStatus.includes('ready') && !result.maskDisabled; }, 'material selection read');
    await track(); report.checks.push('Material selection is read and retained in the live panel');
    if (process.argv.includes('--reference')) {
      report.stage = 'approved library reference';
      await click('recolorClose');
      await inPanel(`(()=>{const cards=Array.from(document.querySelectorAll('#colorGrid .color-card'));const card=cards.find(c=>/^WINE$/i.test(c.querySelector('.color-name').textContent))||cards[0];if(!card)throw new Error('Select a client with approved colors before this test');card.dispatchEvent(new Event('click',{bubbles:true}));return true;})()`);
      await inPanel(`(()=>{const button=document.querySelector('#referenceList .reference-recolor');if(!button)throw new Error('No approved reference Apply Color action');button.dispatchEvent(new Event('click',{bubbles:true}));return true;})()`);
      await until(async () => evaluate(`!document.getElementById('recolorSample').disabled&&/select fabric|sample required/.test(document.getElementById('recolorReference').textContent)`), 'approved reference opening', 60000);
      await track();
      const reference = await evaluate(`(()=>{const d=require('photoshop').app.activeDocument;return{id:d.id,path:String(d.path),width:d.width,height:d.height};})()`);
      assert.ok(!initialIds.includes(reference.id) && /recolor-reference-/.test(reference.path), 'Only a fresh temporary reference may be selected');
      owned.set(reference.id, await evaluate(`require('photoshop').app.activeDocument.activeHistoryState.id`));
      await inPanel(`(async()=>{const ps=require('photoshop');await ps.core.executeAsModal(async()=>{const d=Array.from(ps.app.documents).find(d=>d.id===${reference.id});if(!d)throw new Error('Owned reference closed');await ps.action.batchPlay([{_obj:'select',_target:[{_ref:'document',_id:d.id}]}],{});await d.selection.selectRectangle({left:Math.floor(d.width*.3),top:Math.floor(d.height*.3),right:Math.ceil(d.width*.7),bottom:Math.ceil(d.height*.7)});},{commandName:'Sample a temporary approved reference for UI validation'});})()`);
      owned.set(reference.id, await evaluate(`Array.from(require('photoshop').app.documents).find(d=>d.id===${reference.id}).activeHistoryState.id`));
      await click('recolorSample');
      await until(() => evaluate(`!document.getElementById('recolorPreview').disabled`), 'approved reference sampling');
      assert.equal(await evaluate(`document.getElementById('recolorTarget').selectedIndex`), 0, 'Sampled target must remain selected');
      if (await evaluate(`!!document.getElementById('recolorStepBody3')`)) {
        await inPanel(`(()=>{const button=document.querySelector('[data-recolor-toggle="3"]');if(button.getAttribute('aria-expanded')!=='true')button.dispatchEvent(new Event('click',{bubbles:true}));return true;})()`);
        await pause(100);
        assert.equal(await evaluate(`document.getElementById('recolorTarget').selectedIndex`), 0, 'Opening the target section lost its native selection');
        await inPanel(`(()=>{const button=document.querySelector('[data-recolor-toggle="4"]');if(button.getAttribute('aria-expanded')!=='true')button.dispatchEvent(new Event('click',{bubbles:true}));return true;})()`);
        report.checks.push('Target selection survives collapsible sections in the actual UXP panel');
      }
      report.checks.push('Approved-library Apply Color opens and samples a verified temporary reference');
      report.stage = 'rendered preview and apply';
      await click('recolorPreview');
      await until(() => evaluate(`!document.getElementById('recolorApply').disabled`), 'native preview fitting', 60000);
      await track(); report.checks.push('Preview color fits actual Photoshop adjustments from panel events');
      await inPanel(`(()=>{const tuning=document.getElementById('recolorFineTune');if(tuning)tuning.setAttribute('open','');return true;})()`);
      await inPanel(`(()=>{const slider=document.querySelector('[data-recolor-parameter="intensity"]');if(slider.disabled)throw new Error('Intensity control disabled');slider.value=85;slider.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
      await until(() => evaluate(`!document.getElementById('recolorApply').disabled&&Number(document.querySelector('[data-recolor-parameter="intensity"]').value)===85`), 'native intensity update');
      await track(); report.checks.push('Fine-tune intensity updates native adjustments through the serialized UI queue');
      await click('recolorBefore'); await click('recolorBefore');
      await track();
      await click('recolorApply');
      await until(async () => { const value = await evaluate(`({ready:!document.getElementById('recolorSave').disabled,status:document.getElementById('recolorStatus').textContent})`); if (/Cannot compare|modal scope/.test(value.status)) throw new Error(value.status); return value.ready; }, 'editable Apply Color');
      await track(); report.checks.push('Before/after and editable Apply Color respond in the loaded panel');
      const committedId = (await state()).previewId;
      await click('recolorNew');
      await until(async () => { const value = await state(); if (value.previewId !== committedId) await track(); return value.previewId !== committedId && !value.maskDisabled; }, 'new independent variant');
      await track();
      assert.equal(await evaluate(`Array.from(require('photoshop').app.documents).some(d=>d.id===${committedId})`), true, 'A new variant must retain the committed result');
      report.checks.push('New variant starts separately and retains the committed document');
      report.referenceSampling = 'Provisional center region for technical UI validation; not color accuracy qualification';
    }
    const sourceHistory = await evaluate(`Array.from(require('photoshop').app.documents).find(d=>d.id===${fixture.id}).activeHistoryState.id`);
    assert.equal(sourceHistory, fixture.historyId, 'Panel changed the original fixture');
    report.checks.push('Original source history preserved');
    await click('recolorEnd');
    await until(async () => !(await state()).sourceId, 'end source session');
    report.checks.push('End source session releases only its frozen working source');
    report.passed = true;
  } catch (error) {
    report.passed = false; report.error = error.message;
    if (evaluate) { try { report.lastPanelStatus = await evaluate(`document.getElementById('recolorStatus')&&document.getElementById('recolorStatus').textContent`); } catch (_) {} }
    if (fixture && runOnPanel) {
      try {
        report.frameMetadata = await runOnPanel(`(async()=>{const pane=document.querySelector('.recolor-panel'),ps=require('photoshop'),items=[];await ps.core.executeAsModal(async()=>{for(const field of ['data-working-document-id','data-preview-document-id']){const id=Number(pane.getAttribute(field));if(!id||!Array.from(ps.app.documents).some(d=>d.id===id))continue;const image=await ps.imaging.getPixels({documentID:id,colorSpace:'RGB',colorProfile:'Adobe RGB (1998)',componentSize:16,applyAlpha:false});try{items.push({field,id,width:image.imageData.width,height:image.imageData.height,components:image.imageData.components,componentSize:image.imageData.componentSize,bounds:image.sourceBounds,level:image.level});}finally{image.imageData.dispose();}}},{commandName:'Inspect owned UI fixture frame metadata'});return items;})()`);
      } catch (_) {}
    }
  }
  finally {
    if (evaluate && owned.size) {
      // A native edit after the last known test state retains that document.
      const entries = [...owned];
      try {
        if (fixture) {
          const bound = await evaluate(`Number(document.querySelector('.recolor-panel').getAttribute('data-source-document-id'))`);
          if (bound === fixture.id) {
            await evaluate(`setTimeout(()=>document.getElementById('recolorEnd').dispatchEvent(new Event('click')),0);true`);
            await until(() => evaluate(`!Number(document.querySelector('.recolor-panel').getAttribute('data-source-document-id'))`), 'release test session');
          }
        }
        const key = 'cleanup-' + Date.now();
        await evaluate(`window.__recolorLiveCleanup={state:'pending'};setTimeout(()=>{(async()=>{const ps=require('photoshop'),results=[];try{await ps.core.executeAsModal(async()=>{for(const [id,history] of ${JSON.stringify(entries)}){const d=Array.from(ps.app.documents).find(d=>d.id===id);if(!d)continue;if(d.activeHistoryState.id!==history){results.push({id,retained:'changed after test'});continue;}await d.closeWithoutSaving();results.push({id,closed:true});}if(${JSON.stringify(prior)}&&Array.from(ps.app.documents).some(d=>d.id===${JSON.stringify(prior)}))await ps.action.batchPlay([{_obj:'select',_target:[{_ref:'document',_id:${JSON.stringify(prior)}}]}],{});},{commandName:'Close unchanged owned UI fixtures'});window.__recolorLiveCleanup={state:'complete',results};}catch(error){window.__recolorLiveCleanup={state:'failed',error:error.message||String(error),results};}})();},0);true`);
        report.cleanup = await until(async () => { const value = await evaluate('window.__recolorLiveCleanup'); return value && value.state !== 'pending' && value; }, key);
        if (report.cleanup.state !== 'complete' || report.cleanup.results.some(result => result.retained)) report.passed = false;
      } catch (error) { report.cleanup = { error: error.message }; report.passed = false; }
    }
    report.finishedAt = new Date().toISOString();
    report.runtimeContexts = cdp ? cdp.events.filter(event => event.method === 'Runtime.executionContextCreated').map(event => event.params.context) : [];
    const filename = path.join(root, 'storage/recolor-dev/panel-live-check-' + Date.now() + '.json');
    fs.writeFileSync(filename, JSON.stringify(report, null, 2));
    if (cdp) cdp.close(); if (cli) cli.close();
    console.log(JSON.stringify({ passed: report.passed, checks: report.checks, stage: report.stage, error: report.error, cleanup: report.cleanup, report: filename }, null, 2));
  }
  if (!report.passed) process.exitCode = 1;
}
if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { connection };
