const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { eligibility } = require('../UXP/recolor/benchmark-input');

function buildIndex(inventory, standards, feedback = []) {
  const recipes = new Map();
  for (const file of standards.files || []) {
    if (!recipes.has(file.signature)) recipes.set(file.signature, { id: 'tiff/' + file.signature, role: 'DEVELOPMENT_TECHNIQUE_PRIOR',
      recipeSignature: file.signature, sourceFiles: [], targetLab: file.targetLab, toneBand: file.toneBand,
      techniques: file.techniques, textureTreatment: file.texture, sourceQualification: 'APPROVED_OUTPUT_NOT_ORIGINAL_SOURCE', scoredBenchmarkEligible: false });
    recipes.get(file.signature).sourceFiles.push({ label: file.label, identity: file.sourceFile });
  }
  const cases = (inventory.cases || []).map(item => ({ id: item.id, role: 'DEVELOPMENT_PAIRED_CASE', productFamily: item.product || 'sample-' + item.sample,
    source: item.source, reference: item.reference, gold: { jpeg: item.goldJpg, psd: item.goldPsd }, view: item.viewCode,
    target: item.canonicalTarget || item.target, material: 'UNCONFIRMED', masks: null, measurementRegions: null,
    alignmentValidated: false, excluded: item.excluded === true, blockingFindings: item.blockingFindings,
    eligibility: item.excluded ? { eligible: false, reason: 'EXCLUDED_BY_DATASET_OWNER' } : eligibility(item),
    outcome: 'NOT_QUALIFIED', allowedUse: 'Development only; gold is evaluated after fitting' }));
  const observations = [
    { id: 'designer/navy-arctic-aqua', role: 'DESIGNER_OBSERVATION', outcome: 'TINT_AND_LEVELS_PREFERRED', evidence: 'NATIVE_PREVIEW_INSPECTED_READ_ONLY',
      note: 'Positive method example, not blanket dark-to-light approval', scoredBenchmarkEligible: false },
    { id: 'designer/navy-white-gardenia', role: 'DESIGNER_OBSERVATION', outcome: 'CORRECTION_REQUIRED', evidence: 'USER_REPORTED',
      defects: ['Tint highlights washed out', 'Gradient lighting flat', 'Hue/selective color poor'], scoredBenchmarkEligible: false }
  ];
  const acceptedFeedback = feedback.filter(record => record.schemaVersion === 1 && ['ACCEPTED', 'NEEDS_CORRECTION'].includes(record.outcome));
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), role: 'LOCAL_DEVELOPMENT_CASE_INDEX', productionQualified: false,
    corpusSha256: standards.sourceAudit && standards.sourceAudit.corpusSha256,
    counts: { pairedCases: cases.length, excluded: cases.filter(item => item.excluded).length, uniqueRecipes: recipes.size,
      observations: observations.length, explicitFeedback: acceptedFeedback.length },
    splitPolicy: 'Existing data already used for development; no held-out generalization claim. Group related views/products before future qualification.',
    cases, techniquePriors: [...recipes.values()], observations, feedback: acceptedFeedback,
    calibration: { version: 'fabric-development-1', humanThresholdCalibration: 'DEFERRED', automaticTraining: false } };
}
function main(args = process.argv.slice(2)) {
  const root = path.resolve(__dirname, '..'), argument = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const inventoryPath = argument('--inventory', path.join(root, 'storage/recolor-dev/cbi-dataset-inventory.json'));
  const standardsPath = argument('--standards', path.join(root, 'docs/recoloring/verification/tiff-human-training-standards.json'));
  const destination = path.resolve(argument('--out', path.join(root, 'storage/recolor-dev/fabric-case-index.json')));
  if (!destination.startsWith(path.join(root, 'storage') + path.sep)) throw new Error('Case index output must remain under workspace storage');
  const index = buildIndex(JSON.parse(fs.readFileSync(inventoryPath)), JSON.parse(fs.readFileSync(standardsPath)));
  index.inputIdentities = [inventoryPath, standardsPath].map(filename => ({ name: path.basename(filename), sha256: crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex') }));
  fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, JSON.stringify(index, null, 2));
  return { path: destination, counts: index.counts, productionQualified: false };
}
if (require.main === module) console.log(JSON.stringify(main()));
module.exports = { buildIndex, main };
