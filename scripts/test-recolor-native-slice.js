// Fast native regression slices preserve host fixtures' real call order.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { bundle } = require('./build-recolor-harness');
const root = path.resolve(__dirname, '..');
const slices = {
  alpha: ['Rendering targets RGB when an alpha channel is selected in an owned preview'],
  transparency: ['Transparent canvas margins receive complete native tile and master verification'],
  rollback: ['8-bit sRGB source normalizes to a layered 16-bit Adobe RGB duplicate', 'Method A creates native adjustments and preserves protected pixels', 'Method B creates native adjustments and preserves protected pixels', 'Method C creates native adjustments and preserves protected pixels',
    'Opt-in tinted Black & White and Levels remain masked, live-editable and native after PSD/PSB reopening',
    'Live native parameter changes update an existing provisional group', 'A shared soft group mask is applied once, and masks differ from layer transparency',
    'A failed native transaction rolls back only its own edits', 'Nondefault mask density is not silently interpreted as full coverage'],
  saves: ['A', 'B', 'C', 'D'].map(method => 'Fabric v2 ' + method + ' uses editable color/tone and local masks with verified master round trip')
};
function run(slice = process.argv[2]) {
  if (!slices[slice]) throw new Error('Choose alpha, rollback or saves');
  const directory = fs.mkdtempSync(path.join(root, 'storage/recolor-dev/native-' + slice + '-'));
  const code = bundle('host-tests.js'), scriptPath = path.join(directory, 'native-slice.psjs'), reportPath = path.join(directory, 'report.json');
  const url = 'file:/' + directory.replace(/\\/g, '/');
  const identity = { testedBundleSha256: crypto.createHash('sha256').update(code).digest('hex'), slice };
  fs.writeFileSync(scriptPath, code + '\nconst f=await require("uxp").storage.localFileSystem.getEntryWithUrl(' + JSON.stringify(url) + ');\n'
    + 'const r=await __entry.runHostTests(require("photoshop"),require("uxp"),f,{caseNames:' + JSON.stringify(slices[slice]) + '});r.build=' + JSON.stringify(identity) + ';\n'
    + 'require("fs").writeFileSync(' + JSON.stringify(url + '/report.json') + ',JSON.stringify(r,null,2));');
  const quoted = "'" + scriptPath.replace(/'/g, "''") + "'";
  const launched = spawnSync('powershell', ['-NoProfile', '-Command', "$ErrorActionPreference='Stop';$ps=[Runtime.InteropServices.Marshal]::GetActiveObject('Photoshop.Application');$null=$ps.DoJavaScriptFile(" + quoted + ')'], { encoding: 'utf8' });
  if (launched.status !== 0) throw new Error(launched.stderr || launched.stdout);
  const report = JSON.parse(fs.readFileSync(reportPath));
  console.log(JSON.stringify({ slice, reportPath, passed: report.passed, failed: report.failed, cases: report.cases.map(({ name, status, error }) => ({ name, status, error })) }, null, 2));
  if (!report.technicalGatePassed) process.exitCode = 1;
  return report;
}
if (require.main === module) run();
module.exports = { run };
