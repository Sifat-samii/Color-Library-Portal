const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const excluded = new Set(['tests', 'recolor-harness', 'CSXS', 'plugin-host.js', 'node-http.js', 'host-tests.js', 'harness-panel.js', 'document-audit.js', 'benchmark.js', 'fabric-benchmark.js', 'benchmark-input.js']);
function copyRuntime(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (excluded.has(entry.name) || /\.ccx$/i.test(entry.name)) continue;
    const source = path.join(from, entry.name), destination = path.join(to, entry.name);
    if (entry.isDirectory()) copyRuntime(source, destination);
    else fs.copyFileSync(source, destination);
  }
}
function stagePilot(pluginDirectory) {
  copyRuntime(path.join(root, 'UXP'), pluginDirectory);
  const manifestPath = path.join(pluginDirectory, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.version = '0.7.0';
  manifest.host.minVersion = '25.3.0';
  manifest.host.data = { ...manifest.host.data, apiVersion: 2 };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  const packagePath = path.join(pluginDirectory, 'package.json');
  const metadata = JSON.parse(fs.readFileSync(packagePath, 'utf8')); metadata.version = manifest.version;
  fs.writeFileSync(packagePath, JSON.stringify(metadata, null, 2) + '\n');
  const configPath = path.join(pluginDirectory, 'config.js');
  fs.writeFileSync(configPath, fs.readFileSync(configPath, 'utf8').replace('recolorPilot: false', 'recolorPilot: true'));
  return { manifestPath, pluginId: manifest.id, version: manifest.version };
}
function buildPilot() {
  fs.mkdirSync(path.join(root, 'storage/recolor-dev'), { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'storage/recolor-dev/pilot-'));
  const pluginDirectory = path.join(directory, 'plugin');
  const metadata = stagePilot(pluginDirectory);
  const ccxPath = path.join(directory, 'pixofix-color-library-recolor-pilot-' + metadata.version + '.ccx');
  const quote = value => "'" + value.replace(/'/g, "''") + "'";
  const zip = spawnSync('powershell', ['-NoProfile', '-Command',
    `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory(${quote(pluginDirectory)}, ${quote(ccxPath)})`], { encoding: 'utf8' });
  if (zip.status !== 0) throw new Error(zip.stderr || zip.stdout || (zip.error && zip.error.message) || 'Pilot packaging failed');
  const ccxSha256 = crypto.createHash('sha256').update(fs.readFileSync(ccxPath)).digest('hex');
  const developmentDirectory = path.join(root, 'storage/recolor-dev/pilot-current/plugin');
  const development = stagePilot(developmentDirectory);
  const result = { directory, artifactPluginDirectory: pluginDirectory, artifactManifestPath: metadata.manifestPath,
    pluginDirectory: developmentDirectory, ...development, ccxPath, ccxSha256, productionQualified: false };
  fs.writeFileSync(path.join(root, 'storage/recolor-dev/latest-pilot.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}
if (require.main === module) console.log(JSON.stringify(buildPilot()));
module.exports = { buildPilot, stagePilot };
