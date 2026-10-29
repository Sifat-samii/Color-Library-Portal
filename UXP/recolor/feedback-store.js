const { signature } = require('./fabric-analysis');

function feedbackRecord({ outcome, note = '', defects = [], recipe, report, analysis }) {
  if (!['ACCEPTED', 'NEEDS_CORRECTION'].includes(outcome)) throw new Error('Choose an explicit review outcome');
  if (!recipe || recipe.schemaVersion !== 2 || !report || report.schemaVersion !== 2) throw new Error('Complete a fabric preview before recording feedback');
  if (outcome === 'NEEDS_CORRECTION' && !String(note).trim() && !defects.length) throw new Error('Describe the correction needed');
  if (!Array.isArray(defects) || defects.length > 32 || defects.some(defect => !defect || typeof defect.dimension !== 'string'
    || defect.bounds && (!['left', 'top', 'right', 'bottom'].every(key => Number.isFinite(defect.bounds[key]))
      || defect.bounds.right <= defect.bounds.left || defect.bounds.bottom <= defect.bounds.top))) throw new Error('Invalid review defect regions');
  return { schemaVersion: 1, reviewedAt: new Date().toISOString(), outcome, note: String(note).trim().slice(0, 4000), defects,
    signatures: recipe.signatures, recipe, recipeSha256: signature(recipe), report, analysis,
    authority: 'DESIGNER_FEEDBACK_NOT_CLIENT_COLOR_APPROVAL', automaticallyTrained: false, productionQualified: false };
}
function createFeedbackStore(localFileSystem) {
  let sequence = 0;
  return { async record(input) {
    const record = feedbackRecord(input), root = await localFileSystem.getDataFolder();
    let folder;
    try { folder = await root.getEntry('recolor-feedback'); }
    catch (_) { folder = await root.createFolder('recolor-feedback'); }
    const file = await folder.createFile(Date.now() + '-' + (++sequence) + '.json', { overwrite: false });
    await file.write(JSON.stringify(record, null, 2));
    return { outcome: record.outcome, path: file.nativePath, recipeSha256: record.recipeSha256 };
  } };
}
module.exports = { feedbackRecord, createFeedbackStore };
