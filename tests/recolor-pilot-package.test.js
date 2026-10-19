const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { stagePilot } = require('../scripts/build-recolor-pilot');

test('pilot stages the existing library with all recoloring dependencies and API v2; release inputs stay unchanged', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pixofix-pilot-test-'));
  const before = fs.readFileSync('UXP/manifest.json', 'utf8'), config = fs.readFileSync('UXP/config.js', 'utf8');
  try {
    const output = stagePilot(directory), manifest = JSON.parse(fs.readFileSync(output.manifestPath, 'utf8'));
    assert.equal(manifest.id, JSON.parse(before).id);
    assert.deepEqual(manifest.entrypoints, JSON.parse(before).entrypoints);
    assert.equal(manifest.host.data.apiVersion, 2); assert.equal(manifest.host.minVersion, '25.3.0');
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).version, manifest.version);
    const context = { module: { exports: {} } }; vm.runInNewContext(fs.readFileSync(path.join(directory, 'config.js'), 'utf8'), context);
    assert.equal(context.module.exports.recolorPilot, true);
    const visited = new Set();
    function visit(filename) {
      if (visited.has(filename)) return;
      visited.add(filename); const text = fs.readFileSync(filename, 'utf8');
      if (path.extname(filename) === '.json') { JSON.parse(text); return; }
      new vm.Script(text, { filename });
      for (const m of text.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
        let dependency = path.resolve(path.dirname(filename), m[1]);
        if (!path.extname(dependency)) dependency += '.js';
        visit(dependency);
      }
    }
    visit(path.join(directory, 'main.js'));
    assert.ok(visited.has(path.join(directory, 'recolor/pilot-session.js')));
    assert.ok(fs.existsSync(path.join(directory, 'recolor/vendor/js-sha256-LICENSE.txt')));
    assert.equal(fs.existsSync(path.join(directory, 'recolor/host-tests.js')), false);
    assert.equal(fs.existsSync(path.join(directory, 'recolor-harness')), false);
    assert.equal(fs.readFileSync('UXP/manifest.json', 'utf8'), before);
    assert.equal(fs.readFileSync('UXP/config.js', 'utf8'), config);
  } finally {
    if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('pixofix-pilot-test-')) throw new Error('Unexpected temporary package directory');
    fs.rmSync(directory, { recursive: true });
  }
});
