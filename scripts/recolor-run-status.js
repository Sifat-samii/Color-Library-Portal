const fs = require("node:fs");
const path = require("node:path");

// A host cancellation can stop UXP before its catch/finally blocks execute.
// Finalize only after the native call returns; never infer a timeout or close
// documents based on an incomplete journal.
function finalizeBenchmarkReport(nativeReport, { returnedAt = new Date().toISOString(), launcherError } = {}) {
  const report = JSON.parse(JSON.stringify(nativeReport));
  const interrupted = !report.finishedAt || (report.cases || []).some(entry => entry.status === "RUNNING");
  report.cases = (report.cases || []).map(entry => entry.status === "RUNNING"
    ? { ...entry, status: "INTERRUPTED" } : entry);
  report.productionQualified = false;
  report.launcherReturnedAt = returnedAt;
  if (launcherError) report.launcherError = launcherError;
  report.executionStatus = interrupted ? "INTERRUPTED"
    : report.cancelled || report.cases.some(entry => entry.status === "CANCELLED") ? "CANCELLED"
      : report.cases.some(entry => entry.status === "ERROR")
        || (report.expectedCaseCount != null && report.cases.length !== report.expectedCaseCount)
        ? "COMPLETED_WITH_ERRORS" : "COMPLETED_FOR_REVIEW";
  report.recovery = { needsDocumentReview: interrupted || !!(report.cleanupErrors || []).length,
    instruction: interrupted ? "Inspect the recorded Photoshop documents before continuing; retain manual work. No automatic document closure was attempted." : null };
  return report;
}

if (require.main === module) {
  const filename = path.resolve(process.argv[2] || "");
  const artifactRoot = path.resolve(__dirname, "../storage/recolor-dev") + path.sep;
  if (!filename.startsWith(artifactRoot)) throw new Error("Report must be under storage/recolor-dev");
  const native = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, "utf8")) : { cases: [] };
  const result = finalizeBenchmarkReport(native, { launcherError: process.argv[3] || undefined });
  fs.writeFileSync(filename, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ executionStatus: result.executionStatus, reportPath: filename,
    recovery: result.recovery, productionQualified: false }));
  if (result.executionStatus !== "COMPLETED_FOR_REVIEW") process.exitCode = 1;
}

module.exports = { finalizeBenchmarkReport };
