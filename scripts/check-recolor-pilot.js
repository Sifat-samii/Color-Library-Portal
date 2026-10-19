// A service-only load does not update Adobe UDT's saved manifest path.
// Read the real registration and compare its files with the latest built pilot.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function check() {
  if (!process.env.APPDATA) throw new Error('This workstation check requires Windows APPDATA');
  const build = JSON.parse(fs.readFileSync(path.join(root, 'storage/recolor-dev/latest-pilot.json')));
  const expectedManifestPath = path.resolve(build.manifestPath);
  const expectedDirectory = path.join(root, 'storage/recolor-dev/pilot-current/plugin');
  if (expectedManifestPath !== path.join(expectedDirectory, 'manifest.json')) throw new Error('Build does not point to the stable development manifest');
  const manifest = JSON.parse(fs.readFileSync(expectedManifestPath));
  const workspacePath = path.join(process.env.APPDATA, 'Adobe', 'Adobe UXP Developer Tool', 'plugins_workspace.json');
  const workspace = JSON.parse(fs.readFileSync(workspacePath));
  if (workspace.version !== 1 || !Array.isArray(workspace.plugins)) throw new Error('Unsupported Adobe UDT workspace format');
  const matching = workspace.plugins.filter(entry => {
    if (!entry || typeof entry.manifestPath !== 'string' || (entry.hostParam && entry.hostParam !== 'PS')) return false;
    try { return JSON.parse(fs.readFileSync(entry.manifestPath)).id === manifest.id; } catch (_) { return false; }
  });
  if (matching.length !== 1) throw new Error('Expected exactly one existing Color Library entry; found ' + matching.length);
  const entry = matching[0];
  const registeredManifestPath = entry.pluginOptions?.buildFolder
    ? path.resolve(path.dirname(entry.manifestPath), entry.pluginOptions.buildFolder, 'manifest.json') : path.resolve(entry.manifestPath);
  const registeredDirectory = path.dirname(registeredManifestPath);
  const registered = JSON.parse(fs.readFileSync(registeredManifestPath));
  const differentFiles = [];
  let comparedFiles = 0;
  function compare(relative = '') {
    for (const item of fs.readdirSync(path.join(expectedDirectory, relative), { withFileTypes: true })) {
      const filename = path.join(relative, item.name);
      if (item.isDirectory()) compare(filename);
      else {
        comparedFiles++;
        try { if (!fs.readFileSync(path.join(expectedDirectory, filename)).equals(fs.readFileSync(path.join(registeredDirectory, filename)))) differentFiles.push(filename); }
        catch (_) { differentFiles.push(filename); }
      }
    }
  }
  compare();
  return { checkedAt: new Date().toISOString(), workspacePath, registeredManifestPath,
    registeredVersion: registered.version, expectedManifestPath, expectedVersion: manifest.version,
    usingStablePath: registeredManifestPath.toLowerCase() === expectedManifestPath.toLowerCase(),
    runtimeMatchesLatestBuild: differentFiles.length === 0, comparedFiles, differentFiles,
    note: 'Read-only on-disk registration check. Confirm the visible panel version after UDT Load/Reload; an already loaded runtime can retain older code.' };
}
if (require.main === module) {
  try {
    const result = check(); console.log(JSON.stringify(result, null, 2));
    if (!result.runtimeMatchesLatestBuild) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { check };
