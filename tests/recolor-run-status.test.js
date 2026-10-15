const assert = require("node:assert/strict");
const { test } = require("node:test");
const { finalizeBenchmarkReport } = require("../scripts/recolor-run-status");

test("a host-aborted benchmark preserves completed cases and marks the unfinished native phase for manual recovery", () => {
  const completed = { id: "one", status: "RENDERED_RETOUCHER_REVIEW_REQUIRED", master: { file: "saved.psd" } };
  const native = { cases: [completed, { id: "two", status: "RUNNING", phase: "WRITE_MATERIAL_MASK" }] };
  const result = finalizeBenchmarkReport(native, { returnedAt: "2026-10-15T13:00:00Z" });
  assert.equal(result.cases[0].master.file, "saved.psd");
  assert.equal(result.cases[1].status, "INTERRUPTED");
  assert.equal(result.cases[1].phase, "WRITE_MATERIAL_MASK");
  assert.equal(result.recovery.needsDocumentReview, true);
  assert.equal(result.productionQualified, false);
  assert.equal(result.executionStatus, "INTERRUPTED");
  assert.equal(native.cases[1].status, "RUNNING");
});

test("a completed feasibility run is recorded for review without authorizing production", () => {
  const native = { finishedAt: "2026-10-15T13:00:00Z", cases: [{ id: "one", status: "RENDERED_RETOUCHER_REVIEW_REQUIRED" }] };
  const result = finalizeBenchmarkReport(native, { returnedAt: "2026-10-15T13:00:01Z" });
  assert.equal(result.executionStatus, "COMPLETED_FOR_REVIEW");
  assert.equal(result.recovery.needsDocumentReview, false);
  assert.equal(result.productionQualified, false);
});

test("a finished journal cannot hide missing requested cases or a failed master", () => {
  const completed = { finishedAt: "2026-10-15T13:00:00Z", expectedCaseCount: 2,
    cases: [{ id: "one", status: "RENDERED_RETOUCHER_REVIEW_REQUIRED", master: { file: "retained.psd" } }] };
  assert.equal(finalizeBenchmarkReport(completed).executionStatus, "COMPLETED_WITH_ERRORS");
  const failed = finalizeBenchmarkReport({ ...completed, cases: [...completed.cases, { id: "two", status: "ERROR", phase: "SAVE_MASTER" }] });
  assert.equal(failed.executionStatus, "COMPLETED_WITH_ERRORS");
  assert.equal(failed.cases[0].master.file, "retained.psd");
  assert.equal(failed.productionQualified, false);
});
