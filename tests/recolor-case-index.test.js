const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildIndex } = require('../scripts/recolor-case-index');
const { eligibility } = require('../UXP/recolor/benchmark-input');
test('case index deduplicates priors, keeps gold separate and does not fabricate source qualification', () => {
  const index = buildIndex({ cases: [{ id: 'one', source: 'original.psd', goldJpg: 'human.jpg' }, { id: 'ash', excluded: true }] },
    { files: [{ signature: 'same', label: 'full' }, { signature: 'same', label: 'detail' }] }, [{ schemaVersion: 1, outcome: 'SELECTED_METHOD' }]);
  assert.equal(index.counts.uniqueRecipes, 1); assert.equal(index.techniquePriors[0].sourceFiles.length, 2);
  assert.equal(index.cases[0].gold.jpeg, 'human.jpg'); assert.equal(index.cases[0].eligibility.eligible, false);
  assert.equal(index.counts.explicitFeedback, 0); assert.equal(index.counts.excluded, 1);
});
test('scored benchmark requires a reviewed checkpoint, source-derived mask and reviewed reference region', () => {
  assert.equal(eligibility({ source: 'saved-visible.psd' }).eligible, false);
  const input = { sourceCheckpoint: 'verified-source.json', mask: { kind: 'layerMask', indices: [1], reviewed: true }, referenceRegionReviewed: true };
  assert.equal(eligibility(input).eligible, true);
  assert.equal(eligibility({ ...input, target: 'Heather Ash' }).eligible, false);
  assert.equal(eligibility({ ...input, mask: { kind: 'selection', reviewed: true } }).eligible, false);
});
