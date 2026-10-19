// One save picker controls the folder and basename of both deliverables.
async function chooseOutputFiles(storage, suggestedName) {
  const masterFile = await storage.getFileForSaving(suggestedName, { types: ['psd', 'psb'] });
  if (!masterFile) return null;
  return { masterFile, jpegFile: await jpegForMaster(storage, masterFile) };
}

async function jpegForMaster(storage, masterFile) {
  if (!/\.(psd|psb)$/i.test(masterFile.name)) throw new Error('Choose a PSD or PSB master filename.');
  const url = String(masterFile.url), slash = url.lastIndexOf('/');
  if (slash < 0) throw new Error('The selected output folder is unavailable.');
  const folder = await storage.getEntryWithUrl(url.slice(0, slash));
  const jpegFile = await folder.createFile(masterFile.name.replace(/\.(psd|psb)$/i, '.jpg'), { overwrite: false });
  return jpegFile;
}

module.exports = { chooseOutputFiles, jpegForMaster };
