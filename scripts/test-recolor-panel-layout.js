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
  let evaluate, originallyOpen, originallyExpanded, originalScroll;
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
    originallyExpanded = await evaluate(`(()=>{const open=document.querySelector('[data-recolor-toggle][aria-expanded="true"]');return open&&open.getAttribute('data-recolor-toggle');})()`);
    originalScroll = await evaluate(`document.querySelector('.recolor-content').scrollTop`);
    const click = id => evaluate(`setTimeout(()=>document.getElementById(${JSON.stringify(id)}).dispatchEvent(new Event('click',{bubbles:true})),0);true`);
    const snapshot = () => evaluate(`(()=>{const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};const p=document.querySelector('.recolor-panel');return{version:require('./package.json').version,paneOpen:!p.classList.contains('is-hidden'),browse:rect(document.getElementById('recolorClose')),pane:rect(p),content:rect(p.querySelector('.recolor-content')),footer:rect(p.querySelector('.recolor-footer')),widgets:['clientSelect','searchInput','swatchSearch','sortSelect'].map(id=>({id,visibility:getComputedStyle(document.getElementById(id)).visibility,rect:rect(document.getElementById(id))})),nativeRecolorWidgets:Array.from(p.querySelectorAll('select,input')).map(e=>({id:e.id||e.getAttribute('data-recolor-parameter'),visibility:getComputedStyle(e).visibility})),status:document.getElementById('recolorStatus').textContent};})()`);
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
    report.stepRows = await evaluate(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};return Array.from(document.querySelectorAll('[data-recolor-toggle]')).map(e=>({number:e.getAttribute('data-recolor-toggle'),header:rect(e),numberBox:rect(e.querySelector('.recolor-step-number')),title:rect(e.querySelector('.recolor-step-copy strong')),summary:rect(e.querySelector('.recolor-step-copy > span')),badge:rect(e.querySelector('.recolor-step-badge')),chevron:rect(e.querySelector('.recolor-step-chevron'))}));})()`);
    for (const row of report.stepRows) {
      assert.ok(row.title.width > 0 && row.summary.height > 0, 'Step ' + row.number + ' flattens its title and summary into native button text');
      assert.ok(row.summary.y >= row.title.y + row.title.height - 1, 'Step ' + row.number + ' summary must sit below its title');
      assert.ok(row.title.x >= row.numberBox.x + row.numberBox.width + 6, 'Step ' + row.number + ' title crowds its number');
      assert.ok(row.summary.x + row.summary.width <= row.chevron.x - 4, 'Step ' + row.number + ' summary crowds its disclosure control');
      if (row.badge.width > 0) assert.ok(row.title.x + row.title.width <= row.badge.x - 4, 'Step ' + row.number + ' status overlaps its title');
    }
    report.checks.push('All four step rows separate number, stacked title/summary, status and disclosure');
    assert.ok(report.recolor.browse.width > 0 && report.recolor.browse.height > 0, 'Browse library must occupy a visible hit area');
    assert.ok(report.recolor.footer.height > 0 && report.recolor.footer.y + report.recolor.footer.height <= report.recolor.pane.y + report.recolor.pane.height + 2, 'Output actions must remain inside the panel');
    assert.ok(report.recolor.content.y + report.recolor.content.height <= report.recolor.footer.y + 2, 'Scrollable content overlaps output actions');
    report.checks.push('Output actions stay below the scrolling workflow and inside the panel');
    // UXP retains cached bounds for nodes with display:none. Visibility is
    // checked on the native widget itself, not inferred from a cached rect.
    assert.ok(report.recolor.widgets.every(widget => widget.visibility === 'hidden'), 'Native library controls remain visible in Recolor and can intercept pointer input');
    report.checks.push('Library native widgets are hidden when Recolor opens');
    const expand = number => evaluate(`setTimeout(()=>{const e=document.querySelector('[data-recolor-toggle="${number}"]');if(e&&e.getAttribute('aria-expanded')!=='true')e.dispatchEvent(new Event('click',{bubbles:true}));},0);true`);
    const selections = () => evaluate(`['recolorMaskSource','recolorTarget','recolorMethod'].map(id=>{const e=document.getElementById(id);return{id,index:e.selectedIndex,value:e.value};})`);
    report.selectionsBefore = await selections();
    await expand(2); await pause(100);
    report.materialOpen = await snapshot();
    assert.equal(report.materialOpen.nativeRecolorWidgets.find(e=>e.id==='recolorTarget').visibility, 'hidden', 'Collapsed target selector can overlap the material section');
    await expand(3); await pause(100);
    report.targetOpen = await snapshot();
    assert.equal(report.targetOpen.nativeRecolorWidgets.find(e=>e.id==='recolorMaskSource').visibility, 'hidden', 'Collapsed mask selector can overlap the target section');
    report.checks.push('Collapsed steps hide native selectors, including after disclosure changes');
    for (const key of ['Enter', ' ']) {
      const before = await evaluate(`document.querySelector('[data-recolor-toggle="3"]').getAttribute('aria-expanded')`);
      await evaluate(`setTimeout(()=>{const event=new Event('keydown',{bubbles:true,cancelable:true});Object.defineProperty(event,'key',{value:${JSON.stringify(key)}});document.querySelector('[data-recolor-toggle="3"]').dispatchEvent(event);},0);true`);
      await pause(100);
      assert.notEqual(await evaluate(`document.querySelector('[data-recolor-toggle="3"]').getAttribute('aria-expanded')`), before, 'Disclosure must respond to ' + JSON.stringify(key));
    }
    report.checks.push('Enter and Space toggle the disclosure rows in UXP');
    report.selectionsAfter = await selections();
    assert.deepEqual(report.selectionsAfter, report.selectionsBefore, 'Disclosure changes lost native dropdown choices');
    report.checks.push('Native dropdown choices survive disclosure and keyboard changes');
    await click('recolorClose');
    report.libraryAfter = await waitFor(false);
    assert.ok(report.libraryAfter.nativeRecolorWidgets.every(e=>e.visibility==='hidden'), 'Hidden Recolor inputs overlap the library');
    for (const before of report.libraryBefore.widgets) {
      const after = report.libraryAfter.widgets.find(widget => widget.id === before.id);
      assert.equal(after.visibility, before.visibility, 'Browse library changed visibility of ' + before.id);
    }
    report.checks.push('Browse library restores the previous library view');
    report.passed = true;
  } catch (error) { report.error = error.message; }
  finally {
    if (evaluate && originallyOpen !== undefined) {
      try {
        await evaluate(`setTimeout(()=>{const e=document.querySelector('[data-recolor-toggle][aria-expanded="true"]');const wanted=${JSON.stringify(originallyExpanded)};if(e&&e.getAttribute('data-recolor-toggle')!==wanted)e.dispatchEvent(new Event('click',{bubbles:true}));if(wanted){const target=document.querySelector('[data-recolor-toggle="'+wanted+'"]');if(target.getAttribute('aria-expanded')!=='true')target.dispatchEvent(new Event('click',{bubbles:true}));}},0);true`);
        await evaluate(`setTimeout(()=>document.getElementById(${JSON.stringify(originallyOpen ? 'recolorShow' : 'recolorClose')}).dispatchEvent(new Event('click',{bubbles:true})),0);true`); await pause(100);
        await evaluate(`document.querySelector('.recolor-content').scrollTop=${JSON.stringify(originalScroll)};true`);
      }
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
