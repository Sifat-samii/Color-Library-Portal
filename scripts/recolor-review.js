const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function summarize(report) {
  const candidateMethods = (report.candidateMethods || ["A", "B", "C"]).filter(method => ["A", "B", "C", "D"].includes(method));
  return { schemaVersion: 1, host: report.host, startedAt: report.startedAt, finishedAt: report.finishedAt,
    build: report.build, executionStatus: report.executionStatus, expectedCaseCount: report.expectedCaseCount, productionQualified: false,
    referencePreparation: report.referencePreparation, registrationStatus: report.registrationStatus,
    sourceQualification: report.sourceQualification || "UNVERIFIED_LEGACY_VISIBLE_STATE", scoredBenchmarkEligible: report.scoredBenchmarkEligible === true,
    candidateMethods,
    reviewStatus: "SENIOR_RETOUCHER_AND_TIMING_REVIEW_PENDING", cleanupErrors: report.cleanupErrors,
    cases: report.cases.map(entry => ({ id: entry.id, target: entry.target, status: entry.status, error: entry.error,
      milliseconds: entry.milliseconds, artifactDirectory: entry.artifactDirectory,
      inputProvenance: entry.inputProvenance, referenceRegion: entry.reference && entry.reference.region,
      referenceDiffuseLab: entry.reference && entry.reference.measurement.diffuseLab,
      winner: entry.winner && { method: entry.winner.method, evaluations: entry.winner.evaluations,
        anchorDeltaE00: entry.winner.quality.anchorDeltaE00,
        evaluationVersion: entry.winner.quality.evaluationVersion || "diffuse-channel-clipping-1", recipe: entry.winner.recipe },
      fullResolutionIntegrity: entry.fullResolutionIntegrity, goldComparison: entry.goldComparison,
      humanDiffuse: entry.humanDiffuse, master: entry.master,
      candidateSeeds: entry.evaluations.slice(0, candidateMethods.length).map(value => ({ method: value.method,
        anchorDeltaE00: value.quality.anchorDeltaE00, score: value.quality.score,
        detailRatio: value.quality.integrity.normalizedDetailRatio, clipping: value.quality.integrity.addedClippingFraction })) })) };
}

const escape = value => String(value == null ? "Unavailable" : value).replace(/[&<>"']/g,
  char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const number = value => Number.isFinite(value) ? value.toFixed(2) : "Unavailable";

function buildReview(reportPath) {
  const filename = path.resolve(reportPath), root = path.resolve(__dirname, "../storage/recolor-dev") + path.sep;
  if (!filename.startsWith(root)) throw new Error("Review input must be a workspace recoloring report");
  const directory = path.dirname(filename), report = JSON.parse(fs.readFileSync(filename, "utf8"));
  const summary = summarize(report), reportSha256 = crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
  const image = (entry, name, label) => {
    if (!/^case-\d+$/.test(entry.artifactDirectory || "")) return "";
    const relative = entry.artifactDirectory + "/" + name;
    return fs.existsSync(path.join(directory, relative))
      ? `<figure><a href="${relative}" target="_blank"><img loading="lazy" src="${relative}" alt="${escape(label)}"></a><figcaption>${escape(label)}</figcaption></figure>` : "";
  };
  const cases = summary.cases.map((entry, index) => `<article data-case="${escape(entry.id)}">
    <h2>${index + 1}. ${escape(entry.id)}</h2><p>${escape(entry.status)}${entry.error ? ": " + escape(entry.error) : ""}</p>
    <p>Selected method: ${escape(entry.winner && entry.winner.method)} · Reference-anchor ΔE00: ${number(entry.winner && entry.winner.anchorDeltaE00)} · Processing: ${number(entry.milliseconds / 1000)} s</p>
    <p>Protected pixels changed: ${escape(entry.fullResolutionIntegrity && entry.fullResolutionIntegrity.protectedPixelsChanged)} · Human comparison: ${escape(entry.goldComparison && entry.goldComparison.reason)}</p>
    <div class="comparison">${image(entry, "source.jpg", "Frozen source")}${image(entry, "reference.jpg", "Approved reference")}${image(entry, "fitted.jpg", "Fitted native result")}${image(entry, "human.jpg", "Supplied human result")}</div>
    <details><summary>Compare ${summary.candidateMethods.join("/")} seed candidates</summary><div class="comparison">${summary.candidateMethods.map(method => image(entry, "method-" + method + ".jpg", "Method " + method)).join("")}</div></details>
    <fieldset><legend>Senior-retoucher review</legend>
    <label>Outcome <select data-field="outcome"><option value="PENDING">Pending</option><option>Minor adjustments</option><option>Major correction</option><option>Unsupported</option></select></label>
    <label>Color / undertones <input data-field="color" placeholder="Review comparable fabric regions"></label>
    <label>Texture / folds / clipping <input data-field="texture"></label>
    <label>Edges / labels / protected areas <input data-field="edges"></label>
    <label>Alignment validated <input data-field="alignmentValidated" type="checkbox"></label>
    <label>Comparable measurement regions <input data-field="regions" placeholder="Record regions and exclusions"></label>
    <label>Manual baseline minutes <input data-field="manualMinutes" type="number" min="0" step="0.1"></label>
    <label>Total assisted minutes <input data-field="assistedMinutes" type="number" min="0" step="0.1"></label>
    <label>Notes <textarea data-field="notes"></textarea></label></fieldset></article>`).join("\n");
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>CBI experimental recoloring review</title><style>
    body{font:16px/1.5 system-ui,sans-serif;background:#f4f4f4;color:#222;margin:24px auto;max-width:1600px;padding:0 20px}header,article{background:white;padding:24px;margin-bottom:24px;border-radius:8px}h1,h2{line-height:1.2}.comparison{display:flex;gap:12px;overflow-x:auto}figure{flex:1;min-width:200px;margin:0}img{width:100%;max-height:650px;object-fit:contain;background:#ddd}figcaption{text-align:center}fieldset{margin-top:20px;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}label{display:flex;flex-direction:column}input,select,textarea,button{font:inherit;padding:8px}button{cursor:pointer}details{margin-top:16px}
    </style><header><h1>CBI experimental recoloring review</h1><p>Production qualification: <strong>pending</strong>. These sRGB navigation images are reduced to 900 pixels high. Inspect the Adobe RGB master in Photoshop at 100% for color, texture and edges.</p>
    <p>Source state: ${escape(summary.sourceQualification)}. Eligible for scored source benchmark: ${summary.scoredBenchmarkEligible ? "yes" : "no"}.</p>
    <p>Reference anchors use provisional internal sampling. Human comparison statistics do not satisfy release thresholds before alignment and comparable regions are validated. Automated processing time excludes designer preparation, correction and export.</p>
    <p>Master filenames and native checks are recorded in <a href="summary.json">summary.json</a>. Open masters from their case folders. Keep source files unchanged.</p>
    <label>Reviewer <input id="reviewer"></label><button id="download">Download review notes</button><p id="save-note">Download notes before closing this page; fields are not automatically saved.</p></header>${cases}
    <script>document.getElementById('download').onclick=()=>{const cases=Array.from(document.querySelectorAll('article')).map(a=>({id:a.dataset.case,...Object.fromEntries(Array.from(a.querySelectorAll('[data-field]')).map(i=>[i.dataset.field,i.type==='checkbox'?i.checked:i.value]))}));const data={schemaVersion:1,reportSha256:${JSON.stringify(reportSha256)},reviewer:document.getElementById('reviewer').value,reviewedAt:new Date().toISOString(),productionQualified:false,cases};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='cbi-retoucher-review.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};</script></html>`;
  fs.writeFileSync(path.join(directory, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  fs.writeFileSync(path.join(directory, "review.html"), html);
  return { reviewPath: path.join(directory, "review.html"), summaryPath: path.join(directory, "summary.json"), productionQualified: false };
}

if (require.main === module) console.log(JSON.stringify(buildReview(process.argv[2])));
module.exports = { summarize, buildReview };
