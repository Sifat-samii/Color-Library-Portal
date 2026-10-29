const fs = require('node:fs');
const path = require('node:path');
const { connection } = require('./test-recolor-panel-live');
const { bundle } = require('./build-recolor-harness');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = path.resolve(__dirname, '..');

async function run() {
  const session = JSON.parse(fs.readFileSync(path.join(root, 'storage/recolor-dev/current-ui-session.json')));
  const channel = connection('ws://127.0.0.1:14001/socket/cdt/' + session.pluginSessionId);
  let contextId;
  async function evaluate(expression) {
    const reply = await channel.request({ method: 'Runtime.evaluate', params: { expression, contextId, returnByValue: true } });
    if (reply.error || reply.result.exceptionDetails) throw new Error(reply.error?.message || reply.result.exceptionDetails.exception?.description);
    return reply.result.result.value;
  }
  try {
    await channel.ready; await channel.request({ method: 'Runtime.enable', params: {} });
    contextId = channel.events.find(event => event.method === 'Runtime.executionContextCreated')?.params.context.id;
    const state = await evaluate(`({busy:document.querySelector('.recolor-panel').getAttribute('aria-busy'),source:document.querySelector('.recolor-panel').getAttribute('data-source-document-id')})`);
    if (state.busy === 'true' || state.source) throw new Error('Preserve the active recoloring session before running an owned-image probe');
    const delayMs = process.argv.includes('--settled') ? 180 : 0;
    await evaluate(`(()=>{const entry=new Function('require',${JSON.stringify(bundle('host-tests.js') + '\nreturn __entry;')})(require);window.__sliderStability={state:'running'};setTimeout(async()=>{try{const result=await entry.runSliderStress(require('photoshop'),require('uxp'),{methods:['C','B','D'],delayMs:${delayMs},onProgress:progress=>{window.__sliderStability.progress=progress;}});window.__sliderStability={state:'complete',result};}catch(error){window.__sliderStability={state:'failed',error:error.message,stack:error.stack};}},0);return true;})()`);
    for (let attempt = 0; attempt < 360; attempt++) {
      const result = await evaluate('window.__sliderStability');
      if (result.state === 'failed') throw new Error(result.error);
      if (result.state === 'complete') { console.log(JSON.stringify(result.result, null, 2)); return result.result; }
      if (attempt % 10 === 0) console.log(JSON.stringify(result.progress || { stage: 'preparing' }));
      await pause(500);
    }
    throw new Error('Slider probe did not finish within three minutes; inspect Photoshop before further actions');
  } finally { channel.close(); }
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
