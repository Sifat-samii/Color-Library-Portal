// A separate development panel. The production Color Library is unchanged.
const photoshop = require("photoshop");
const uxp = require("uxp");
const { ADOBE_RGB } = require("./color");
const { createPhotoshopAdapter } = require("./photoshop-adapter");
const { measureMaterial, evaluateRender, compareFrames } = require("./quality");
const { createCandidates } = require("./recipes");
const { fit, latestQueue } = require("./fitting");
const { createSourcePreparation } = require("./source-preparation");

const adapter = createPhotoshopAdapter(photoshop);
const $ = id => document.getElementById(id);
const state = { snapshot: null, preview: null, mask: null, baseline: null, sourceStats: null,
  targets: [], selectedTarget: null, recipe: null, quality: null, fitSignal: null, manifest: null, busy: false, epoch: 0, sourceInspection: null,
  sourceIOSignal: null, sourceCheckpointPaths: [] };
let tail = Promise.resolve();
function serialize(work) {
  const run = tail.then(work, work);
  tail = run.catch(() => {});
  return run;
}
function status(message) { $("status").textContent = message; }
function syncControls() {
  $("sourceLabel").textContent = state.snapshot ? state.snapshot.original.name + " → Adobe RGB 16-bit working copy. "
    + (state.snapshot.sourcePreparation ? "Source roles reviewed for this session." : "Visible state only; source roles unreviewed.") : "Choose the product document, then inspect its source layers";
  $("capture").disabled = state.busy;
  $("inspectSource").disabled = state.busy || Boolean(state.snapshot);
  $("captureReviewed").disabled = state.busy || Boolean(state.snapshot) || !state.sourceInspection;
  $("saveSourceCheckpoint").disabled = state.busy || !state.snapshot || !state.snapshot.sourcePreparation;
  $("restoreSourceCheckpoint").disabled = state.busy || Boolean(state.snapshot);
  $("cancelSourceIO").disabled = !state.sourceIOSignal;
  for (const control of document.querySelectorAll("[data-source-role], #sourceInsertion, #sourceReviewer")) control.disabled = state.busy || Boolean(state.snapshot);
  for (const key of ["reference", "mask", "newPreview"]) $(key).disabled = state.busy || !state.snapshot;
  for (const key of ["preview", "fit"]) $(key).disabled = state.busy || !state.mask || !state.selectedTarget;
  $("apply").disabled = state.busy || !state.recipe || !state.preview || state.preview.committed;
  $("save").disabled = state.busy || !state.manifest;
  $("compare").disabled = state.busy || !state.recipe || state.preview.committed;
  $("cancelFit").disabled = !state.fitSignal;
  for (const input of document.querySelectorAll("[data-parameter]")) input.disabled = state.busy || !state.recipe || state.preview.committed;
  $("target").disabled = state.busy || !state.targets.length;
}
async function task(work) {
  if (state.busy) return;
  state.busy = true; syncControls();
  try { await serialize(work); }
  catch (error) { status(error.message); }
  finally { state.busy = false; syncControls(); }
}
async function refreshMaskSources() {
  const sources = await adapter.maskSources(state.preview.documentId);
  const select = $("maskSource");
  select.innerHTML = "";
  function option(value, label) {
    const el = document.createElement("option"); el.value = JSON.stringify(value); el.textContent = label; select.appendChild(el);
  }
  option({ kind: "selection" }, "Current selection in preview");
  for (const layer of sources.layers) option({ kind: "layerMask", layerId: layer.id }, "Layer mask: " + layer.name);
  for (const channel of sources.channels) option({ kind: "channel", channelIndex: channel.index, name: channel.name }, "Saved selection: " + channel.name);
  for (const path of sources.paths) option({ kind: "path", pathIndex: path.index, name: path.name }, "Vector path: " + path.name);
}
function selectTarget(id) {
  state.epoch += 1;
  state.selectedTarget = state.targets.find(v => v.id === id) || null;
  state.recipe = null; state.quality = null; syncControls();
}
function writeControls(recipe) {
  for (const input of document.querySelectorAll("[data-parameter]")) {
    input.value = recipe.parameters[input.getAttribute("data-parameter")];
    input.nextElementSibling.textContent = input.value;
  }
}
async function render(recipe) {
  const rendering = await adapter.render(state.preview, recipe, state.mask);
  const frame = await adapter.readPixels(state.preview.documentId, 640);
  state.recipe = recipe;
  state.quality = evaluateRender(state.baseline, frame, state.mask, recipe.target);
  state.quality.targetGamutClipped = rendering.targetGamutClipped;
  showingAfter = true; $("compare").textContent = "Show original";
  writeControls(recipe);
  status(state.quality.available ? "Diffuse anchor ΔE00 " + state.quality.anchorDeltaE00.toFixed(2)
    + ". " + (state.quality.integrity.critical ? "Protected pixels changed — reject this result." : "Inspect texture and edges at 100%. Designer review required.")
    : "Color measurement unavailable; inspect the selected material region.");
  $("quality").textContent = JSON.stringify(state.quality, null, 2);
  syncControls();
  return state.quality;
}

async function captureSource(documentId, settings) {
  if (state.snapshot) throw new Error("This session already has a frozen source. Reload the development panel to begin a different source; existing documents stay open.");
  state.snapshot = await adapter.captureSource(documentId, settings);
  await initializeSourcePreview();
}
async function initializeSourcePreview() {
  state.preview = await adapter.createPreview(state.snapshot);
  state.baseline = await adapter.readPixels(state.snapshot.documentId, 640);
  await refreshMaskSources();
  status((state.snapshot.sourcePreparation ? "Reviewed source captured with historical content preserved. " : "Unreviewed visible-state experiment captured. ") + "Inspect the preview document, choose your mask source, then use the mask.");
}
$("capture").addEventListener("click", () => task(() => captureSource()));

function sourceIOOptions() {
  state.sourceIOSignal = { aborted: false }; syncControls();
  return { signal: state.sourceIOSignal, onProgress: progress => status("Verifying source file: " + Math.round(progress.bytes / progress.total * 100) + "%. Cancellation is available.") };
}
$("cancelSourceIO").addEventListener("click", () => { if (state.sourceIOSignal) state.sourceIOSignal.aborted = true; });
$("saveSourceCheckpoint").addEventListener("click", () => task(async () => {
  const folder = await uxp.storage.localFileSystem.getFolder(); if (!folder) return;
  try {
    const saved = await adapter.saveSourceCheckpoint(state.snapshot, folder, sourceIOOptions());
    state.sourceCheckpointPaths.push(saved.artifactFile.nativePath, saved.manifestFile.nativePath);
    status("Reviewed source recovery saved: " + saved.manifestFile.nativePath + ". Keep its PSB and JSON together.");
  } finally { state.sourceIOSignal = null; }
}));
$("restoreSourceCheckpoint").addEventListener("click", () => task(async () => {
  if (state.snapshot) throw new Error("Begin recovery in a fresh panel session; current work stays open");
  const file = await uxp.storage.localFileSystem.getFileForOpening({ types: ["json"] }); if (!file) return;
  try {
    state.snapshot = await adapter.restoreSourceCheckpoint(file, sourceIOOptions());
    state.sourceCheckpointPaths.push(state.snapshot.recovery.artifactPath, file.nativePath);
    await initializeSourcePreview();
    status("Reviewed source recovered and file checksums verified. Choose a material mask and reference for this new session. Existing variants stay intact.");
  } finally { state.sourceIOSignal = null; }
}));

$("inspectSource").addEventListener("click", () => task(async () => {
  const inspection = adapter.inspectSource();
  state.sourceInspection = inspection;
  $("reviewSourceLabel").textContent = "Review bound to: " + inspection.binding.name;
  $("sourceLayers").innerHTML = "";
  const containers = new Map([["[]", $("sourceLayers")]]);
  for (const layer of inspection.layers) {
    const parent = containers.get(JSON.stringify(layer.indices.slice(0, -1)));
    const row = document.createElement("label");
    const title = document.createElement("span"); title.textContent = layer.path[layer.path.length - 1] + " · " + layer.kind + (layer.visible ? " · visible" : " · hidden");
    row.appendChild(title);
    const select = document.createElement("select"); select.setAttribute("data-source-role", JSON.stringify(layer.indices));
    const choices = layer.indices.length > 1 ? [["", "Inherit parent role"]] : [];
    choices.push(["UNRESOLVED", "Unresolved — retoucher review"], ["KEEP_BASE", "Keep base / cleanup / lighting"], ["DISABLE_RECOLOR", "Disable existing recoloring"], ["DISABLE_GUIDE", "Disable reference guide"]);
    for (const [value, text] of choices) { const option = document.createElement("option"); option.value = value; option.textContent = text; select.appendChild(option); }
    row.appendChild(select); parent.appendChild(row);
    if (inspection.layers.some(child => child.indices.length === layer.indices.length + 1 && child.indices.slice(0, -1).join("/") === layer.indices.join("/"))) {
      const details = document.createElement("details"), summary = document.createElement("summary"), content = document.createElement("div");
      summary.textContent = "Review children of " + layer.path[layer.path.length - 1]; details.appendChild(summary); details.appendChild(content); parent.appendChild(details);
      containers.set(JSON.stringify(layer.indices), content);
    }
  }
  const insertion = $("sourceInsertion"); insertion.innerHTML = "";
  const choices = [["", "Choose the reviewed processing location"], [JSON.stringify({ kind: "TOP" }), "Above all original source layers"]];
  for (const layer of inspection.layers.filter(value => value.indices.length === 1)) choices.push([JSON.stringify({ kind: "BEFORE_LAYER", indices: layer.indices }), "Before root layer " + (layer.indices[0] + 1) + ": " + layer.path[0]]);
  for (const [value, text] of choices) { const option = document.createElement("option"); option.value = value; option.textContent = text; insertion.appendChild(option); }
  $("sourceReview").hidden = false;
  status("Classify the source roles and choose the processing location. Unresolved work remains flagged. Native edits require a fresh inspection.");
}));
$("captureReviewed").addEventListener("click", () => task(async () => {
  if (!$("sourceInsertion").value) throw new Error("Choose the reviewed recoloring location first");
  const roles = Array.from(document.querySelectorAll("[data-source-role]")).filter(control => control.value).map(control => ({ indices: JSON.parse(control.getAttribute("data-source-role")), role: control.value }));
  const preparation = createSourcePreparation(state.sourceInspection, { roles, insertion: JSON.parse($("sourceInsertion").value),
    review: { status: "ACCEPTED", reviewer: $("sourceReviewer").value.trim(), reviewedAt: new Date().toISOString() } });
  await captureSource(state.sourceInspection.binding.id, { sourcePreparation: preparation });
}));

$("mask").addEventListener("click", () => task(async () => {
  if (state.recipe) throw new Error("Use New preview revision before replacing a material mask; existing manual corrections stay open.");
  const previous = state.preview;
  state.mask = await adapter.acquireMask(previous.documentId, JSON.parse($("maskSource").value));
  state.sourceStats = measureMaterial(state.baseline, state.mask);
  if (!state.sourceStats.available) throw new Error(state.sourceStats.reason);
  // Loading saved selections changes Photoshop history. Begin from the frozen
  // source again instead of acknowledging arbitrary native edits as our own.
  state.preview = await adapter.createPreview(state.snapshot);
  try { await adapter.cancel(previous); } catch (error) { if (error.code !== "MANUAL_EDITS") throw error; }
  await refreshMaskSources();
  status("Material mask captured. Switch to the reference document, select representative fabric, then sample the reference.");
}));

$("reference").addEventListener("click", () => task(async () => {
  const reference = adapter.inspect();
  if (!reference.profile || reference.profile === "None") throw new Error("The reference needs an explicit embedded profile before color-critical sampling");
  if ([state.snapshot.documentId, state.snapshot.original.id, state.preview.documentId].includes(reference.id)) {
    throw new Error("Activate the approved reference document and select its representative fabric first");
  }
  const mask = await adapter.acquireMask(reference.id, { kind: "selection" });
  const measured = measureMaterial(await adapter.readPixels(reference.id, 640), mask);
  if (!measured.available) throw new Error(measured.reason);
  adapter.markReference(reference.id);
  const target = { id: "reference-" + reference.id + "-" + Date.now(), name: reference.name, revision: 1, material: "MATTE",
    measurementSpace: measured.measurementSpace, diffuseLab: measured.diffuseLab, lightness: measured.lightness,
    referenceDocument: reference, approvalOrigin: "EXTERNAL_MANUAL_NOT_VERIFIED_BY_HARNESS", preparationStatus: "SESSION_EXPERIMENT_ONLY" };
  state.targets.push(target);
  const option = document.createElement("option"); option.value = target.id; option.textContent = target.name;
  $("target").appendChild(option); $("target").value = target.id;
  selectTarget(target.id);
  status("Reference sampled without HEX. Select a method and preview on the source.");
}));

$("target").addEventListener("change", () => selectTarget($("target").value));
$("preview").addEventListener("click", () => task(async () => {
  if (state.preview.committed) throw new Error("Use New preview revision for another target; committed edits are preserved");
  const candidate = createCandidates(state.sourceStats, state.selectedTarget).find(v => v.method === $("method").value);
  await render(candidate);
}));
$("fit").addEventListener("click", () => task(async () => {
  state.fitSignal = { aborted: false }; syncControls();
  try {
    const result = await fit(state.sourceStats, state.selectedTarget, recipe => render(recipe), {
      maxEvaluations: 18, signal: state.fitSignal,
      onProgress: p => status("Photoshop fitting: " + p.evaluations + "/" + p.budget + ", method " + p.method + ". Cancel is available.")
    });
    state.recipe = result.recipe; state.quality = result.quality;
    status("Method " + result.recipe.method + ", diffuse anchor ΔE00 " + result.quality.anchorDeltaE00.toFixed(2) + ". Experimental result; designer review required.");
  } finally { state.fitSignal = null; }
}));
$("cancelFit").addEventListener("click", () => { if (state.fitSignal) state.fitSignal.aborted = true; });

const queuedRender = latestQueue(entry => serialize(async () => {
  if (entry.epoch !== state.epoch) return { superseded: true };
  return render(entry.recipe);
}));
for (const input of document.querySelectorAll("[data-parameter]")) input.addEventListener("input", () => {
  if (!state.recipe || state.busy) return;
  const recipe = JSON.parse(JSON.stringify(state.recipe));
  for (const control of document.querySelectorAll("[data-parameter]")) {
    recipe.parameters[control.getAttribute("data-parameter")] = Number(control.value);
    control.nextElementSibling.textContent = control.value;
  }
  queuedRender({ recipe, epoch: state.epoch }).catch(error => status(error.message));
});

let showingAfter = true;
$("compare").addEventListener("click", () => task(async () => {
  showingAfter = !showingAfter; await adapter.toggle(state.preview, showingAfter);
  $("compare").textContent = showingAfter ? "Show original" : "Show recolored";
}));
$("newPreview").addEventListener("click", () => task(async () => {
  state.epoch += 1;
  // Leave previous documents intact; they may contain designer work.
  state.preview = await adapter.createPreview(state.snapshot);
  state.recipe = null; state.manifest = null; state.quality = null;
  await refreshMaskSources();
  status("New preview revision created. Previous documents and manual edits were preserved.");
}));
$("apply").addEventListener("click", () => task(async () => {
  state.epoch += 1;
  if (state.quality && state.quality.integrity.critical) throw new Error("Protected pixels changed; this candidate cannot be applied by the harness");
  const integrity = compareFrames(await adapter.readPixels(state.snapshot.documentId), await adapter.readPixels(state.preview.documentId), state.mask);
  if (integrity.critical) throw new Error("Full-resolution protected pixels changed; preserve this preview for manual inspection");
  state.manifest = await adapter.commit(state.preview);
  state.manifest.quality = state.quality;
  state.manifest.fullResolutionIntegrity = integrity;
  status("Native adjustments applied to this variant. Normal Photoshop editing is available. This result has not passed production feasibility testing.");
}));
$("save").addEventListener("click", () => task(async () => {
  const file = await uxp.storage.localFileSystem.getFileForSaving("recolor-experimental.psd", { types: ["psd", "psb"] });
  if (!file) return;
  const doc = Array.from(photoshop.app.documents).find(v => v.id === state.manifest.documentId);
  if (!doc || doc.colorProfileName !== ADOBE_RGB) throw new Error("An open Adobe RGB variant is required");
  const normalized = value => String(value || "").replace(/\\/g, "/").toLowerCase();
  const protectedPaths = [state.snapshot.original.path].concat(state.sourceCheckpointPaths, state.targets.map(v => v.referenceDocument.path)).filter(Boolean);
  if (protectedPaths.some(value => normalized(value) === normalized(file.nativePath))) {
    throw new Error("Choose a different output path; the original source must not be overwritten");
  }
  const extension = file.name.toLowerCase().endsWith(".psb") ? "psb" : "psd";
  await adapter.atomic(doc.id, "Save experimental recolor master", () => doc.saveAs[extension](file, { layers: true, embedColorProfile: true, maximizeCompatibility: true }, true));
  const folder = await uxp.storage.localFileSystem.getDataFolder();
  const manifestFile = await folder.createFile(state.manifest.sessionId + "-" + Date.now() + ".json", { overwrite: false });
  await manifestFile.write(JSON.stringify({ ...state.manifest, output: file.nativePath, savedAt: new Date().toISOString(), productionQualified: false }, null, 2));
  status("Experimental layered master saved with Adobe RGB. Session manifest saved in plugin data. Production qualification is still pending.");
}));
syncControls();
