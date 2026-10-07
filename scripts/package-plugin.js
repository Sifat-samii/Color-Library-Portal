const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "UXP");
const ccxName = "com.pixofix.color-library_PS.ccx";
const ccx = path.join(source, ccxName);
const skip = new Set([ccxName, "CSXS", "plugin-host.js", "node-http.js", "tests"]);
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "pixofix-ccx-"));

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const nextFrom = path.join(from, entry.name);
    const nextTo = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(nextFrom, nextTo);
    else fs.copyFileSync(nextFrom, nextTo);
  }
}

copyTree(source, stage);
if (fs.existsSync(ccx)) fs.unlinkSync(ccx);

const zip = spawnSync("powershell", [
  "-NoProfile", "-Command",
  `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${stage.replace(/'/g, "''")}', '${ccx.replace(/'/g, "''")}')`
], { encoding: "utf8" });

fs.rmSync(stage, { recursive: true, force: true });
if (zip.status !== 0) {
  console.error(zip.stderr || zip.stdout || "Failed to package the Photoshop panel");
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(source, "manifest.json"), "utf8"));
console.log(`Packaged ${ccxName} (${manifest.version})`);
