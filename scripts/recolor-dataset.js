const fs = require("node:fs/promises");
const path = require("node:path");

const VIEWS = { "01": "Front", "02": "Full body", "03": "Right", "04": "Left", "05": "Back",
  "06": "Detailed view 1", "07": "Detailed view 2", "08": "Detailed view 3" };
const key = value => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const viewOf = filename => (path.parse(filename).name.match(/_(0[1-8])$/) || [])[1] || null;

// CBI benchmark naming, authorized by the dataset owner's follow-up. These
// aliases change labels, never reference pixels or historical approval.
function canonicalLabel(original) {
  const names = { carribeanblue: "Caribbean Blue", caribbeanblue: "Caribbean Blue",
    ciel: "Ceil Blue", ceil: "Ceil Blue", cielblue: "Ceil Blue", ceilblue: "Ceil Blue",
    hunter: "Hunter Green", huntergreen: "Hunter Green", teal: "Teal Blue", tealblue: "Teal Blue" };
  const label = names[key(original)] || original;
  return { original, label, flaggedAlias: label.toLowerCase() !== original.trim().toLowerCase(),
    excluded: key(original) === "heatherash" };
}

async function entries(directory, type) {
  try { return (await fs.readdir(directory, { withFileTypes: true })).filter(e => type === "directory" ? e.isDirectory() : e.isFile()).map(e => e.name).sort(); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

async function inventoryDataset(root, options = {}) {
  root = path.resolve(root);
  const report = { schemaVersion: 1, root, inspectedAt: new Date().toISOString(), productionQualified: false,
    viewCodes: VIEWS, samples: [], references: [], cases: [], findings: [] };
  const issue = (code, detail) => { const value = { code, ...detail }; report.findings.push(value); return value; };
  for (const kind of ["CROP", "FULL"]) {
    const folder = path.join(root, "Approved Color", kind);
    for (const name of await entries(folder, "file")) {
      if (!/\.(jpe?g|psd|psb|png|tiff?)$/i.test(name)) continue;
      const originalLabel = path.parse(name).name.replace(/^CK605_CK002__CIEL_F_1178_/i, "").replace(/_FULL\s*$/i, "");
      const label = canonicalLabel(originalLabel);
      report.references.push({ kind: kind.toLowerCase(), path: path.relative(root, path.join(folder, name)),
        ...label, colorKey: key(label.label) });
    }
  }
  for (const sample of [1, 2]) {
    const folder = path.join(root, "Recolor Sample " + sample), input = path.join(folder, "Input"), output = path.join(folder, "Output");
    const sources = (await entries(input, "file")).filter(name => /\.ps[db]$/i.test(name));
    const targets = await entries(output, "directory");
    report.samples.push({ sample, sourceCount: sources.length, targets, outputPsdExpected: sample === 2 });
    if (sources.length !== 8) issue("SOURCE_COUNT", { sample, expected: 8, actual: sources.length });
    for (const target of targets) {
      const targetLabel = canonicalLabel(target);
      const targetFolder = path.join(output, target);
      const jpgFolder = sample === 1 ? targetFolder : path.join(targetFolder, "JPG");
      const psdFolder = path.join(targetFolder, "PSD");
      const jpgs = (await entries(jpgFolder, "file")).filter(name => /\.jpe?g$/i.test(name));
      const psds = sample === 2 ? (await entries(psdFolder, "file")).filter(name => /\.ps[db]$/i.test(name)) : [];
      if (jpgs.length !== 8) issue("OUTPUT_JPG_COUNT", { sample, target, expected: 8, actual: jpgs.length });
      if (sample === 2 && psds.length !== 8) issue("OUTPUT_PSD_COUNT", { sample, target, expected: 8, actual: psds.length });
      for (const [viewCode, view] of Object.entries(VIEWS)) {
        const blockingFindings = [];
        const add = (code, extra = {}) => blockingFindings.push(issue(code, { sample, target, viewCode, ...extra }));
        const candidates = sources.filter(name => viewOf(name) === viewCode);
        const jpgCandidates = jpgs.filter(name => viewOf(name) === viewCode);
        const psdCandidates = psds.filter(name => viewOf(name) === viewCode);
        if (candidates.length !== 1) add("SOURCE_VIEW_AMBIGUOUS", { files: candidates });
        if (jpgCandidates.length !== 1) add("GOLD_JPG_VIEW_AMBIGUOUS", { files: jpgCandidates });
        if (sample === 2 && psdCandidates.length !== 1) add(psdCandidates.length ? "GOLD_PSD_VIEW_AMBIGUOUS" : "MISSING_GOLD_PSD");
        const source = candidates.length === 1 ? candidates[0] : null;
        const product = source && path.parse(source).name.replace(/_0[1-8]$/, "");
        for (const name of jpgCandidates.concat(psdCandidates)) if (product && !name.toLowerCase().startsWith(product.toLowerCase() + "_")) add("PRODUCT_MISMATCH", { file: name, product });
        const reference = {};
        for (const kind of ["crop", "full"]) {
          const matches = report.references.filter(ref => ref.kind === kind && ref.colorKey === key(targetLabel.label));
          reference[kind] = matches.length === 1 ? matches[0].path : null;
          if (!targetLabel.excluded && kind === "full" && matches.length !== 1) add("REFERENCE_FULL_UNRESOLVED", { matches: matches.map(ref => ref.path) });
          if (matches.length > 1 && kind === "crop") issue("REFERENCE_CROP_AMBIGUOUS", { sample, target, matches: matches.map(ref => ref.path) });
        }
        if (jpgCandidates.length === 1 && psdCandidates.length === 1 && path.parse(jpgCandidates[0]).name.toLowerCase() !== path.parse(psdCandidates[0]).name.toLowerCase()) add("GOLD_REPRESENTATIONS_FILENAME_DIFFERS");
        report.cases.push({ id: "sample-" + sample + "/" + target + "/" + viewCode, sample, target, canonicalTarget: targetLabel.label,
          flaggedAlias: targetLabel.flaggedAlias, excluded: targetLabel.excluded, viewCode, view, product,
          source: source ? path.relative(root, path.join(input, source)) : null,
          goldJpg: jpgCandidates.length === 1 ? path.relative(root, path.join(jpgFolder, jpgCandidates[0])) : null,
          goldPsd: sample === 2 && psdCandidates.length === 1 ? path.relative(root, path.join(psdFolder, psdCandidates[0])) : null,
          reference, blockingFindings, comparisonStatus: targetLabel.excluded ? "EXCLUDED_BY_DATASET_OWNER" : "NOT_YET_EVALUATED" });
      }
    }
  }
  if (options.metadata !== false) {
    const { inspectAsset } = require("./recolor-metadata");
    const paths = new Set(report.references.map(ref => ref.path));
    for (const item of report.cases) for (const value of [item.source, item.goldJpg, item.goldPsd]) if (value) paths.add(value);
    report.assets = {};
    for (const relative of paths) {
      try { report.assets[relative] = await inspectAsset(path.join(root, relative)); }
      catch (error) { report.assets[relative] = { error: error.message }; issue("ASSET_METADATA_ERROR", { path: relative, error: error.message }); }
    }
    for (const item of report.cases) {
      const a = report.assets[item.source], b = report.assets[item.goldJpg], p = report.assets[item.goldPsd];
      for (const relative of [item.source, item.goldJpg, item.goldPsd, item.reference.full, item.reference.crop].filter(Boolean)) {
        if (report.assets[relative] && report.assets[relative].error) item.blockingFindings.push({ code: "ASSET_METADATA_ERROR", path: relative });
      }
      if (a && b && (a.width !== b.width || a.height !== b.height)) item.blockingFindings.push(issue("SOURCE_GOLD_GEOMETRY_DIFFERS", { caseId: item.id,
        source: { width: a.width, height: a.height }, gold: { width: b.width, height: b.height } }));
      if (p && b && (p.width !== b.width || p.height !== b.height)) item.blockingFindings.push(issue("GOLD_REPRESENTATIONS_GEOMETRY_DIFFERS", { caseId: item.id }));
    }
  }
  return report;
}

if (require.main === module) {
  const args = process.argv.slice(2), root = args[args.indexOf("--root") + 1], out = args[args.indexOf("--out") + 1];
  if (!args.includes("--root") || !args.includes("--out") || !root || !out) throw new Error("Use --root <read-only dataset> --out <workspace/storage report.json>");
  const allowed = path.resolve(__dirname, "..", "storage") + path.sep, destination = path.resolve(out);
  if (!destination.startsWith(allowed)) throw new Error("Audit output must stay within workspace storage");
  inventoryDataset(root).then(async report => {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ report: destination, pairs: report.cases.length, samples: report.samples, references: report.references.length, findings: report.findings.length }));
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { inventoryDataset, canonicalLabel };
