// Real UXP layout regression: native library widgets must leave the layout
// while Recolor is visible. Synthetic click handlers alone cannot catch this.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { connection } = require('./test-recolor-panel-live');
const root = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  const loaded = JSON.parse(fs.readFileSync(path.join(root, 'storage/recolor-dev/current-ui-session.json')));
  const channel = connection('ws://127.0.0.1:14001/socket/cdt/' + loaded.pluginSessionId);
  const report = { startedAt: new Date().toISOString(), passed: false, sourceOperationsRun: false, checks: [] };
  let evaluate, originallyOpen;
  try {
    await channel.ready;
    report.registration = require('./check-recolor-pilot').check();
    assert.ok(report.registration.runtimeMatchesLatestBuild, 'UDT points to an outdated build: ' + report.registration.registeredManifestPath);
    await channel.request({ method: 'Runtime.enable', params: {} });
    let contextId;
    evaluate = async expression => {
      const response = await channel.request({ method: 'Runtime.evaluate', params: { expression, contextId, returnByValue: true } });
      if (response.error || response.result.exceptionDetails) throw new Error(response.error?.message || response.result.exceptionDetails.exception?.description || response.result.exceptionDetails.text);
      return response.result.result.value;
    };
    for (let attempt = 0; attempt < 100; attempt++) {
      const contexts = channel.events.filter(event => event.method === 'Runtime.executionContextCreated').map(event => event.params.context.id).reverse();
      let ready = false;
      for (const id of contexts) {
        contextId = id;
        try { if (await evaluate(`typeof document!=='undefined'&&!!document.getElementById('recolorShow')`)) { ready = true; break; } } catch (_) { /* Panel context is still starting. */ }
      }
      if (ready) break;
      if (attempt === 99) throw new Error('Open the Color Library panel before running the layout check');
      await pause(100);
    }
    originallyOpen = await evaluate(`!document.querySelector('.recolor-panel').classList.contains('is-hidden')`);
    const click = id => evaluate(`setTimeout(()=>document.getElementById(${JSON.stringify(id)}).dispatchEvent(new Event('click',{bubbles:true})),0);true`);
    const snapshot = () => evaluate(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};return{version:require('./package.json').version,paneOpen:!document.querySelector('.recolor-panel').classList.contains('is-hidden'),begin:rect(document.getElementById('recolorBegin')),widgets:['clientSelect','searchInput','swatchSearch','sortSelect'].map(id=>({id,visibility:getComputedStyle(document.getElementById(id)).visibility,rect:rect(document.getElementById(id))})),status:document.getElementById('recolorStatus').textContent};})()`);
    const waitFor = async open => {
      for (let i = 0; i < 50; i++) {
        const state = await snapshot();
        if (state.paneOpen === open) { await pause(100); return snapshot(); }
        await pause(50);
      }
      throw new Error('Panel navigation did not settle');
    };
    await click('recolorClose');
    report.libraryBefore = await waitFor(false);
    await click('recolorShow');
    report.recolor = await waitFor(true);
    assert.ok(report.recolor.begin.width > 0 && report.recolor.begin.height > 0, 'Use active product must occupy a visible hit area');
    // UXP retains cached bounds for nodes with display:none. Visibility is
    // checked on the native widget itself, not inferred from a cached rect.
    assert.ok(report.recolor.widgets.every(widget => widget.visibility === 'hidden'), 'Native library controls remain visible in Recolor and can intercept pointer input');
    report.checks.push('Library native widgets are hidden when Recolor opens');
    await click('recolorClose');
    report.libraryAfter = await waitFor(false);
    for (const before of report.libraryBefore.widgets) {
      const after = report.libraryAfter.widgets.find(widget => widget.id === before.id);
      assert.equal(after.visibility, before.visibility, 'Browse library changed visibility of ' + before.id);
    }
    report.checks.push('Browse library restores the previous library view');
    report.passed = true;
  } catch (error) { report.error = error.message; }
  finally {
    if (evaluate && originallyOpen !== undefined) {
      try { await evaluate(`setTimeout(()=>document.getElementById(${JSON.stringify(originallyOpen ? 'recolorShow' : 'recolorClose')}).dispatchEvent(new Event('click',{bubbles:true})),0);true`); await pause(100); }
      catch (error) { report.restoreError = error.message; report.passed = false; }
    }
    channel.close();
    report.finishedAt = new Date().toISOString();
    const filename = path.join(root, 'storage/recolor-dev/panel-layout-check-' + Date.now() + '.json');
    fs.writeFileSync(filename, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, report: filename }, null, 2));
  }
  if (!report.passed) process.exitCode = 1;
}
if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
