const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const sourceRoot = path.join(root, "UXP", "recolor");

function bundle(entry) {
  const modules = new Map();
  function add(filename) {
    const absolute = path.resolve(sourceRoot, filename);
    if (!absolute.startsWith(sourceRoot + path.sep)) throw new Error("Bundle import escapes recolor modules");
    const id = path.relative(sourceRoot, absolute).replace(/\\/g, "/");
    if (modules.has(id)) return id;
    const code = fs.readFileSync(absolute, "utf8"), dependencies = {};
    modules.set(id, null);
    for (const match of code.matchAll(/require\(["']([^"']+)["']\)/g)) {
      if (match[1].startsWith(".")) dependencies[match[1]] = add(path.relative(sourceRoot, path.resolve(path.dirname(absolute), match[1] + (path.extname(match[1]) ? "" : ".js"))));
    }
    modules.set(id, { code, dependencies });
    return id;
  }
  const entryId = add(entry);
  const definitions = [...modules].map(([id, value]) => JSON.stringify(id) + ": [function(module, exports, require) {\n" + value.code + "\n}, " + JSON.stringify(value.dependencies) + "]").join(",\n");
  return "const __hostRequire = require;\nconst __definitions = {" + definitions + "};\nconst __cache = {};\n"
    + "function __load(id) { if (__cache[id]) return __cache[id].exports; const m = {exports:{}}; __cache[id] = m; const d = __definitions[id]; d[0](m,m.exports,function(s){return d[1][s] ? __load(d[1][s]) : __hostRequire(s);}); return m.exports; }\n"
    + "const __entry = __load(" + JSON.stringify(entryId) + ");\n";
}

function build() {
  const directory = path.join(root, "storage", "recolor-dev", new Date().toISOString().replace(/[:.]/g, "-") + "-" + crypto.randomUUID().slice(0, 8));
  fs.mkdirSync(directory, { recursive: true });
  const url = "file:/" + directory.replace(/\\/g, "/");
  const scriptPath = path.join(directory, "run-host-tests.psjs");
  const code = bundle("host-tests.js");
  const buildIdentity = { testedBundleSha256: crypto.createHash("sha256").update(code).digest("hex"),
    generatedAt: new Date().toISOString(), entry: "UXP/recolor/host-tests.js" };
  const script = code
    + "const __folder = await require('uxp').storage.localFileSystem.getEntryWithUrl(" + JSON.stringify(url) + ");\n"
    + "let __report; try { __report = await __entry.runHostTests(require('photoshop'), require('uxp'), __folder); } catch(error) { __report = {technicalGatePassed:false,productionQualified:false,fatal:error.message,stack:error.stack}; }\n"
    + "__report.build = " + JSON.stringify(buildIdentity) + ";\n"
    + "require('fs').writeFileSync(" + JSON.stringify(url + "/report.json") + ", JSON.stringify(__report,null,2));\n";
  fs.writeFileSync(scriptPath, script, "utf8");
  return { scriptPath, reportPath: path.join(directory, "report.json"), directory };
}

function buildPanel() {
  const directory = path.join(root, "storage", "recolor-dev", "panel");
  fs.mkdirSync(directory, { recursive: true });
  for (const filename of ["index.html", "styles.css"]) {
    fs.copyFileSync(path.join(root, "UXP", "recolor-harness", filename), path.join(directory, filename));
  }
  fs.writeFileSync(path.join(directory, "main.js"), bundle("harness-panel.js"), "utf8");
  fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify({
    manifestVersion: 5, id: "com.pixofix.recolor-lab", name: "Pixofix Recolor Lab", version: "0.1.0", main: "index.html",
    host: { app: "PS", minVersion: "25.3.0", data: { apiVersion: 2 } },
    requiredPermissions: { localFileSystem: "fullAccess" },
    entrypoints: [{ type: "panel", id: "recolorLab", label: { default: "Recolor Lab (Development)" },
      minimumSize: { width: 320, height: 450 }, preferredDockedSize: { width: 360, height: 760 } }]
  }, null, 2) + "\n");
  return { directory, manifestPath: path.join(directory, "manifest.json"), productionQualified: false };
}

function buildAudit(inputs) {
  if (!Array.isArray(inputs) || !inputs.length || inputs.some(input => !input.path || !input.label)) throw new Error("Audit inputs need explicit paths and labels");
  const directory = path.join(root, "storage", "recolor-dev", "audit-" + Date.now() + "-" + crypto.randomUUID().slice(0, 8));
  fs.mkdirSync(directory, { recursive: true });
  const code = bundle("document-audit.js"), url = "file:/" + directory.replace(/\\/g, "/");
  const identity = { testedBundleSha256: crypto.createHash("sha256").update(code).digest("hex"), entry: "UXP/recolor/document-audit.js" };
  const scriptPath = path.join(directory, "audit.psjs");
  fs.writeFileSync(scriptPath, code + "\nconst __folder = await require('uxp').storage.localFileSystem.getEntryWithUrl(" + JSON.stringify(url) + ");\n"
    + "const __report = await __entry.auditDocuments(require('photoshop'),require('uxp'),__folder," + JSON.stringify(inputs) + ");\n"
    + "__report.build = " + JSON.stringify(identity) + ";\nrequire('fs').writeFileSync(" + JSON.stringify(url + "/report.json") + ",JSON.stringify(__report,null,2));\n");
  return { directory, scriptPath, reportPath: path.join(directory, "report.json") };
}

function buildBenchmark(job) {
  if (!job || !Array.isArray(job.cases) || !job.cases.length) throw new Error("Explicit benchmark cases required");
  const directory = path.join(root, "storage", "recolor-dev", "benchmark-" + Date.now() + "-" + crypto.randomUUID().slice(0, 8));
  fs.mkdirSync(directory, { recursive: true });
  const code = bundle("benchmark.js"), url = "file:/" + directory.replace(/\\/g, "/");
  const identity = { testedBundleSha256: crypto.createHash("sha256").update(code).digest("hex"), entry: "UXP/recolor/benchmark.js",
    jobSha256: crypto.createHash("sha256").update(JSON.stringify(job)).digest("hex") };
  const scriptPath = path.join(directory, "benchmark.psjs");
  fs.writeFileSync(path.join(directory, "job.json"), JSON.stringify(job, null, 2));
  fs.writeFileSync(scriptPath, code + "\nconst __folder = await require('uxp').storage.localFileSystem.getEntryWithUrl(" + JSON.stringify(url) + ");\n"
    + "const __report = await __entry.runBenchmark(require('photoshop'),require('uxp'),__folder," + JSON.stringify(job) + ");\n"
    + "__report.build = " + JSON.stringify(identity) + ";\nrequire('fs').writeFileSync(" + JSON.stringify(url + "/report.json") + ",JSON.stringify(__report,null,2));\n");
  return { directory, scriptPath, reportPath: path.join(directory, "report.json") };
}

if (require.main === module) {
  const auditIndex = process.argv.indexOf("--audit");
  const benchmarkIndex = process.argv.indexOf("--benchmark");
  console.log(JSON.stringify(benchmarkIndex >= 0 ? buildBenchmark(JSON.parse(fs.readFileSync(process.argv[benchmarkIndex + 1], "utf8")))
    : auditIndex >= 0 ? buildAudit(JSON.parse(fs.readFileSync(process.argv[auditIndex + 1], "utf8")))
    : process.argv.includes("--panel") ? buildPanel() : build()));
}
module.exports = { bundle, build, buildPanel, buildAudit, buildBenchmark };
