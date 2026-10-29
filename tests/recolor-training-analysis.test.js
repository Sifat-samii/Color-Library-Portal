const assert = require('node:assert/strict');
const { test } = require('node:test');
const { interpolate, toneBand, analyzeReport } = require('../scripts/recolor-training-analysis');

test('training analysis interpolates human curves and uses stable tonal bands', () => {
  assert.equal(interpolate([[0, 3], [128, 100], [255, 240]], 64), 51.5);
  assert.equal(interpolate([[0, 3], [128, 100], [255, 240]], 255), 240);
  assert.deepEqual([39.99, 40, 69.99, 70].map(toneBand), ['DARK', 'MID', 'MID', 'LIGHT']);
});

test('training analysis selects the effective visible CC target and deduplicates identical recipes', () => {
  const targetLayers = [
    { id: 1, name: 'CC', path: ['CC'], indices: [0], kind: 'group', visible: true },
    { id: 2, name: 'Support', path: ['CC', 'Swatch Adjustment'], indices: [0, 0], kind: 'group', visible: true },
    { id: 3, name: 'Approved', path: ['CC', 'Approved'], indices: [0, 1], kind: 'group', visible: true },
    { id: 4, name: 'Hidden', path: ['CC', 'Hidden'], indices: [0, 2], kind: 'group', visible: false },
    { id: 5, name: 'Tint', path: ['CC', 'Approved', 'Tint'], indices: [0, 1, 0], kind: 'blackAndWhite', visible: true,
      blendMode: 'normal', opacity: 100, adjustment: [{ _obj: 'blackAndWhite', useTint: true,
        tintColor: { red: 80, grain: 60, blue: 40 } }] },
    { id: 6, name: 'Curve', path: ['CC', 'Approved', 'Curve'], indices: [0, 1, 1], kind: 'curves', visible: true,
      blendMode: 'normal', opacity: 100, adjustment: [{ _obj: 'curves', adjustment: [{ channel: { _value: 'composite' },
        curve: [{ horizontal: 0, vertical: 0 }, { horizontal: 128, vertical: 80 }, { horizontal: 255, vertical: 190 }] }] }] }
  ];
  const document = label => ({ label, status: 'INSPECTED', profile: 'Adobe RGB (1998)', depth: 'bitDepth8',
    sourceFile: { sha256: 'abc' }, layers: targetLayers });
  const analysis = analyzeReport({ startedAt: 'a', finishedAt: 'b', documents: [document('Approved'), document('Approved')], cleanupErrors: [] });
  assert.equal(analysis.evidence.uniqueRecipes, 1);
  assert.equal(analysis.files[0].target, 'Approved');
  assert.equal(analysis.files[0].tone.curveSamples[2], 80);
  assert.equal(analysis.evidence.techniqueCounts.tintedBlackAndWhite, 1);
});
