// Bounded workstation-only crash breadcrumbs: no pixels or file paths.
function createActionJournal(localFileSystem) {
  const records = [];
  let tail = Promise.resolve(), file;
  const safeRecipe = value => {
    try { return JSON.parse(JSON.stringify(value, (key, data) => /path$|url$/i.test(key) ? undefined : data)); }
    catch (_) { return null; }
  };
  return {
    record(action, phase, state, parameters) {
      const entry = {at:new Date().toISOString(),action,phase,method:state.recipe && state.recipe.method,
        parameters:parameters || state.recipe && state.recipe.parameters || null,
        recipe: phase === 'completed' ? safeRecipe(state.recipe || null) : undefined,
        qualityVerdict: state.quality && state.quality.report && state.quality.report.verdict,
        width:state.source && state.source.width,height:state.source && state.source.height};
      tail = tail.catch(()=>{}).then(async()=>{
        if(!file){
          const folder=await localFileSystem.getDataFolder();
          try { file=await folder.getEntry('recolor-pilot-actions.json'); const previous=JSON.parse(await file.read()); records.push(...(previous.records||[]).slice(-23)); }
          catch(_){ file=await folder.createFile('recolor-pilot-actions.json',{overwrite:true}); }
        }
        records.push(entry); if(records.length>24)records.shift();
        await file.write(JSON.stringify({schemaVersion:1,records},null,2));
      }).catch(()=>{ /* Diagnostic storage failure must not block Photoshop. */ });
      return tail;
    }
  };
}
module.exports = { createActionJournal };
