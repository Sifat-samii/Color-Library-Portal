const assert = require("node:assert/strict");
const { test } = require("node:test");
const { summarize } = require("../scripts/recolor-review");

test("review summaries retain source qualification and every evaluated seed, including opt-in D", () => {
  const report = { candidateMethods: ["A", "B", "C", "D"], sourceQualification: "SAVED_VISIBLE_STATE_ONLY_SOURCE_PREPARATION_NOT_IMPLEMENTED", scoredBenchmarkEligible: false,
    cases: [{ id: "fixture", evaluations: ["A", "B", "C", "D"].map(method => ({ method, quality: { anchorDeltaE00: 1, score: 1, integrity: {} } })) }] };
  const summary = summarize(report);
  assert.equal(summary.sourceQualification, report.sourceQualification);
  assert.equal(summary.scoredBenchmarkEligible, false);
  assert.deepEqual(summary.candidateMethods, ["A", "B", "C", "D"]);
  assert.deepEqual(summary.cases[0].candidateSeeds.map(seed => seed.method), ["A", "B", "C", "D"]);
});

test("legacy review reports remain explicitly ineligible for source qualification", () => {
  const summary = summarize({ cases: [] });
  assert.equal(summary.scoredBenchmarkEligible, false);
  assert.equal(summary.sourceQualification, "UNVERIFIED_LEGACY_VISIBLE_STATE");
  assert.equal(summary.productionQualified, false);
});
