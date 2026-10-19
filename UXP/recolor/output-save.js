// Shared by the panel session and state-preserving development updates. The
// caller owns session serialization; this module records only completed I/O.
async function saveOutput({ adapter, output, protectedPaths, file, manifestFolder, jpegFile, format = 'master' }) {
  if (!output) throw new Error('Apply Color before saving the result.');
  if (!['master', 'jpeg'].includes(format)) throw new Error('Unsupported output format.');
  let saved, jpeg;
  try {
    if (format === 'jpeg') jpeg = await adapter.saveJpeg(output.documentId, file, protectedPaths);
    else if (jpegFile) {
      const pair = await adapter.saveOutputs(output.documentId, file, jpegFile, protectedPaths);
      saved = pair.master; jpeg = pair.jpeg;
    } else saved = await adapter.saveMaster(output.documentId, file, protectedPaths);
  } catch (error) {
    if (error.savedMaster) output.savedPath = error.savedMaster.path;
    throw error;
  }
  if (saved) output.savedPath = saved.path;
  if (jpeg) output.jpegPath = jpeg.path;
  const record = { ...output, output: saved ? saved.path : jpeg.path, master: saved, jpeg, savedAt: new Date().toISOString(), productionQualified: false };
  try {
    const manifestFile = await manifestFolder.createFile(output.sessionId + '-' + Date.now() + '.json', { overwrite: false });
    await manifestFile.write(JSON.stringify(record, null, 2)); output.manifestPath = manifestFile.nativePath;
  } catch (error) {
    throw new Error((saved ? 'Master saved at ' + saved.path : '') + (jpeg ? (saved ? ' and ' : '') + 'JPEG saved at ' + jpeg.path : '') + ', but its session record could not be saved: ' + error.message);
  }
  return record;
}

module.exports = { saveOutput };
