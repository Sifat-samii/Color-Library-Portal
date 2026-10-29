const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildAudit } = require('./build-recolor-harness');

async function sha256(filename) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filename);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

async function buildTrainingAudit(folderPath) {
  const folder = path.resolve(folderPath);
  const files = fs.readdirSync(folder, { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.tiff?$/i.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!files.length) throw new Error('No TIFF training files found in ' + folder);
  const inputs = [];
  for (const file of files) {
    const filename = path.join(folder, file.name), stat = fs.statSync(filename);
    inputs.push({
      label: path.basename(file.name, path.extname(file.name)),
      path: filename,
      bytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      sha256: await sha256(filename)
    });
  }
  const artifact = buildAudit(inputs);
  fs.writeFileSync(path.join(artifact.directory, 'training-files.json'), JSON.stringify({
    schemaVersion: 1,
    role: 'APPROVED_HUMAN_EDIT_TRAINING_CORPUS',
    sourceFolder: folder,
    capturedAt: new Date().toISOString(),
    files: inputs
  }, null, 2));
  return { ...artifact, files: inputs.length };
}

if (require.main === module) {
  buildTrainingAudit(process.argv[2] || '').then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
}

module.exports = { buildTrainingAudit };
