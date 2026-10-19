const { ADOBE_RGB, SRGB } = require("./color");
const { validateMask, coverage } = require("./quality");
const { layerDescriptors } = require("./native-descriptors");
const { resolveSourcePreparation } = require("./source-preparation");
const { fingerprintFile } = require("./file-identity");
const { sealCheckpoint, verifyCheckpoint } = require("./source-checkpoint");

async function executeChecked(photoshop, commands) {
  const results = await photoshop.action.batchPlay(commands, {});
  if (!Array.isArray(results)) throw new Error("Photoshop returned an invalid action result");
  for (const result of results) {
    if (result && (String(result._obj).toLowerCase() === "error" || Number(result.result) < 0)) {
      const error = new Error(result.message || "Photoshop action failed");
      error.code = Number(result.result) === -128 ? "CANCELLED" : "PHOTOSHOP_ACTION_FAILED";
      throw error;
    }
  }
  if (results.length !== commands.length) throw new Error("Photoshop returned an incomplete action result");
  return results;
}

function createPhotoshopAdapter(photoshop, options = {}) {
  const { app, imaging, constants } = photoshop;
  const sessions = new Set();
  const openedReferences = new Set();
  const operation = name => { if (options.onOperation) options.onOperation(name); };
  let sequence = 0;
  const id = () => Date.now().toString(36) + "-" + (++sequence).toString(36);
  const play = commands => executeChecked(photoshop, commands);
  const modal = (name, work) => options.executionContext
    ? work(options.executionContext)
    : photoshop.core.executeAsModal(work, { commandName: name });
  const docById = documentId => {
    const doc = Array.from(app.documents).find(v => v.id === documentId);
    if (!doc) throw Object.assign(new Error("The bound Photoshop document is no longer open"), { code: 'DOCUMENT_CLOSED' });
    return doc;
  };
  const selectDoc = documentId => play([{ _obj: "select", _target: [{ _ref: "document", _id: documentId }] }]);
  const selectLayer = (documentId, layerId) => play([{ _obj: "select", _target: [{ _ref: "layer", _id: layerId }, { _ref: "document", _id: documentId }], makeVisible: false }]);
  const documentIds = () => new Set(Array.from(app.documents).map(doc => doc.id));
  function createdDocument(before, expectedName) {
    const created = Array.from(app.documents).filter(doc => !before.has(doc.id));
    if (created.length !== 1 || created[0].name !== expectedName) throw new Error("New document identity is ambiguous; existing documents were preserved");
    return created[0];
  }
  async function duplicateDocument(documentId, name) {
    const before = documentIds();
    await docById(documentId).duplicate(name, false);
    const result = createdDocument(before, name);
    await selectDoc(result.id);
    return result;
  }
  async function openDocument(file) {
    const normalized = value => String(value || "").replace(/\\/g, "/").toLowerCase();
    if (Array.from(app.documents).some(doc => normalized(inspect(doc.id).path) === normalized(file.nativePath))) throw new Error("The artifact is already open; preserve existing work and use a closed artifact");
    const before = documentIds();
    let result;
    await modal("Open verified working artifact", async () => {
      result = await openInModal(file, before);
    });
    return result;
  }

  async function openInModal(file, before = documentIds()) {
    const storage = require("uxp").storage.localFileSystem;
    await play([{ _obj: "open", null: { _path: storage.createSessionToken(file), _kind: "local" }, _options: { dialogOptions: "silent" } }]);
    const result = createdDocument(before, file.name);
    await selectDoc(result.id);
    return result;
  }

  function inspect(documentId) {
    const doc = documentId == null ? app.activeDocument : docById(documentId);
    if (!doc) throw new Error("Open a source image in Photoshop first");
    let nativePath = "";
    try { nativePath = String(doc.path || ""); } catch (_error) { /* Unsaved documents have no file path. */ }
    return { id: doc.id, name: doc.name, path: nativePath, width: doc.width, height: doc.height,
      mode: doc.mode, depth: doc.bitsPerChannel, profile: doc.colorProfileName,
      historyId: doc.activeHistoryState && doc.activeHistoryState.id,
      layerIds: Array.from(doc.layers).map(layer => layer.id) };
  }
  const token = documentId => JSON.stringify(inspect(documentId));

  function inspectSource(documentId) {
    const binding = inspect(documentId), doc = docById(binding.id), layers = [];
    function visit(collection, indices, names) {
      Array.from(collection).forEach((layer, index) => {
        const location = indices.concat(index), path = names.concat(layer.name);
        layers.push({ id: layer.id, indices: location, path, kind: layer.kind, visible: layer.visible,
          opacity: layer.opacity, blendMode: layer.blendMode });
        if (layer.layers && layer.layers.length) visit(layer.layers, location, path);
      });
    }
    visit(doc.layers, [], []);
    if (token(binding.id) !== JSON.stringify(binding)) throw new Error("Source changed during layer inspection; inspect it again");
    return { schemaVersion: 1, binding, layers };
  }

  function locateLayer(doc, indices) {
    let collection = doc.layers, layer;
    for (const index of indices) {
      layer = collection && collection[index];
      if (!layer) throw new Error("Reviewed layer location no longer exists");
      collection = layer.layers;
    }
    return layer;
  }

  function frozenDescription(documentId) {
    const source = inspectSource(documentId), binding = source.binding;
    return { width: binding.width, height: binding.height, mode: binding.mode, depth: binding.depth, profile: binding.profile,
      layers: source.layers.map(({ id: _runtimeId, ...layer }) => layer) };
  }

  async function saveSourceCheckpoint(snapshot, folder, settings = {}) {
    if (settings.signal && settings.signal.aborted) throw Object.assign(new Error("Source checkpoint cancelled"), { code: "CANCELLED" });
    if (!snapshot.sourcePreparation || snapshot.sourcePreparation.review.status !== "ACCEPTED") throw new Error("Review source roles before creating a recoverable checkpoint");
    if (token(snapshot.documentId) !== snapshot.snapshotToken) throw new Error("Frozen source changed; review and capture it again");
    const checkpointId = id(), prefix = "source-" + checkpointId;
    const file = await folder.createFile(prefix + ".psb", { overwrite: false });
    const journal = await folder.createFile(prefix + ".pending.json", { overwrite: false });
    const record = { schemaVersion: 1, checkpointId, artifact: file.name, status: "SAVING", productionQualified: false };
    const write = () => journal.write(JSON.stringify(record, null, 2));
    await write();
    try {
      await modal("Save reviewed source checkpoint", async () => {
        if (token(snapshot.documentId) !== snapshot.snapshotToken) throw new Error("Frozen source changed while waiting for Photoshop");
        const prior = app.activeDocument.id;
        await selectDoc(snapshot.documentId);
        await docById(snapshot.documentId).saveAs.psb(file, { layers: true, embedColorProfile: true, maximizeCompatibility: true }, true);
        snapshot.snapshotToken = token(snapshot.documentId);
        if (Array.from(app.documents).some(doc => doc.id === prior)) await selectDoc(prior);
      });
      const frozen = frozenDescription(snapshot.documentId);
      record.status = "VERIFYING"; await write();
      const identity = await fingerprintFile(file.url, require("fs"), settings);
      if (token(snapshot.documentId) !== snapshot.snapshotToken) throw new Error("Frozen source was edited during verification; its work was preserved");
      const checkpoint = sealCheckpoint({ id: checkpointId, revision: 1, createdAt: new Date().toISOString(),
        artifact: { name: file.name, ...identity }, frozen, sourcePreparation: snapshot.sourcePreparation,
        originalSource: snapshot.original, normalization: snapshot.normalization });
      const manifestFile = await folder.createFile(prefix + ".json", { overwrite: false });
      await manifestFile.write(JSON.stringify(checkpoint, null, 2));
      record.status = "COMPLETE"; record.manifest = manifestFile.name; await write();
      return { checkpoint, manifestFile, artifactFile: file };
    } catch (error) {
      record.status = error.code === "CANCELLED" ? "CANCELLED" : "ERROR"; record.error = error.message;
      try { await write(); } catch (_journalError) { /* A partial manifest never grants recovery authority. */ }
      throw error;
    }
  }

  async function restoreSourceCheckpoint(manifestFile, settings = {}) {
    const io = require("fs"), metadata = await io.lstat(manifestFile.url);
    if (metadata.size > 4 * 1024 * 1024) throw new Error("Source checkpoint manifest is too large");
    const payload = verifyCheckpoint(JSON.parse(await manifestFile.read()));
    const storage = require("uxp").storage.localFileSystem;
    const manifestUrl = String(manifestFile.url);
    const file = await storage.getEntryWithUrl(manifestUrl.slice(0, manifestUrl.lastIndexOf("/") + 1) + payload.artifact.name);
    const verifyFile = async () => {
      const identity = await fingerprintFile(file.url, io, settings);
      if (identity.sha256 !== payload.artifact.sha256 || identity.bytes !== payload.artifact.bytes) throw new Error("Checkpoint source bytes changed; recovery was refused");
    };
    await verifyFile();
    let opened, openedToken, restored, restoredToken;
    try {
      opened = await openDocument(file);
      openedToken = token(opened.id);
      if (JSON.stringify(frozenDescription(opened.id)) !== JSON.stringify(payload.frozen)
        || opened.bitsPerChannel !== constants.BitsPerChannelType.SIXTEEN) throw new Error("Recovered source structure, profile or depth differs from its checkpoint");
      await modal("Recover independent source copy", async () => {
        if (token(opened.id) !== openedToken) throw new Error("Opened checkpoint contains new manual work; it was retained");
        restored = await duplicateDocument(opened.id, "Recolor recovered source " + id());
        restoredToken = token(restored.id);
        await opened.closeWithoutSaving(); opened = null;
      });
      await verifyFile();
      if (token(restored.id) !== restoredToken) throw Object.assign(new Error("Recovered copy contains new manual edits; it was retained"), { code: "MANUAL_EDITS" });
      return { original: payload.originalSource, documentId: restored.id, snapshotToken: restoredToken,
        sourcePreparation: payload.sourcePreparation, sourceQualification: "RECOVERED_FROZEN_SOURCE_SHA256_VERIFIED", normalization: payload.normalization,
        recovery: { checkpointId: payload.id, revision: payload.revision, sha256: payload.artifact.sha256, bytes: payload.artifact.bytes,
          artifactPath: String(file.nativePath), manifestPath: String(manifestFile.nativePath) } };
    } catch (error) {
      await modal("Close incomplete recovery copies", async () => {
        if (opened && token(opened.id) === openedToken) await opened.closeWithoutSaving();
        if (restored && token(restored.id) === restoredToken) await restored.closeWithoutSaving();
      });
      throw error;
    }
  }

  async function atomic(documentId, name, work) {
    return modal(name, async context => {
      docById(documentId);
      operation("SUSPEND_HISTORY");
      const suspension = await context.hostControl.suspendHistory({ documentID: documentId, name });
      try {
        const value = await work(context);
        if (context.isCancelled) throw Object.assign(new Error("Recoloring cancelled"), { code: "CANCELLED" });
        operation("COMMIT_HISTORY");
        await context.hostControl.resumeHistory(suspension, true);
        return value;
      } catch (error) {
        await context.hostControl.resumeHistory(suspension, false);
        throw error;
      }
    });
  }

  async function captureSource(documentId, settings = {}) {
    const original = inspect(documentId);
    let preparation = settings.sourcePreparation ? resolveSourcePreparation(settings.sourcePreparation, inspectSource(original.id)) : null;
    if (openedReferences.has(original.id)) throw new Error("An opened reference cannot silently become the source; select your product document");
    if (original.mode !== constants.DocumentMode.RGB || ![constants.BitsPerChannelType.EIGHT, constants.BitsPerChannelType.SIXTEEN].includes(original.depth)) {
      throw new Error("The experimental harness supports RGB 8-bit and 16-bit documents");
    }
    if ((!original.profile || original.profile === "None") && !settings.untaggedProfile) throw new Error("Record an explicit interpretation for the untagged source");
    if (token(original.id) !== JSON.stringify(original)) throw new Error("Source changed during capture");
    let frozen;
    try {
      await modal("Capture recoloring source", async () => {
        if (token(original.id) !== JSON.stringify(original)) throw new Error("Source changed while waiting for Photoshop; capture it again");
        if (preparation) preparation = resolveSourcePreparation(preparation, inspectSource(original.id));
        frozen = await duplicateDocument(original.id, "Recolor source " + id());
        if (preparation) {
          const topology = inspection => inspection.layers.map(layer => ({ indices: layer.indices, path: layer.path, kind: layer.kind }));
          if (JSON.stringify(topology(inspectSource(frozen.id))) !== JSON.stringify(topology(preparation.source))) {
            throw new Error("Duplicated source hierarchy differs from the reviewed structure");
          }
          for (const indices of preparation.disableLayers) locateLayer(frozen, indices).visible = false;
        }
        if (!original.profile || original.profile === "None") frozen.colorProfileName = settings.untaggedProfile;
        if (frozen.colorProfileName !== ADOBE_RGB) {
          await frozen.convertProfile(ADOBE_RGB, constants.Intent.RELATIVECOLORIMETRIC, true, false);
        }
        frozen.bitsPerChannel = constants.BitsPerChannelType.SIXTEEN;
      });
      return { original, documentId: frozen.id, snapshotToken: token(frozen.id), sourcePreparation: preparation,
        sourceQualification: preparation ? "REVIEWED_ORIGINAL_SOURCE_SESSION" : "UNREVIEWED_VISIBLE_STATE",
        normalization: {
        interpretedInputProfile: original.profile && original.profile !== "None" ? original.profile : settings.untaggedProfile,
        explicitlyAssignedUntaggedProfile: !original.profile || original.profile === "None" ? settings.untaggedProfile : null,
        workingProfile: ADOBE_RGB, workingDepth: 16, intent: "RELATIVE_COLORIMETRIC", blackPointCompensation: true
      } };
    } catch (error) {
      if (frozen) await modal("Close incomplete source copy", () => frozen.closeWithoutSaving());
      throw error;
    }
  }

  async function readPixels(documentId, maxEdge) {
    return modal('Read recoloring pixels', async () => {
      const doc = docById(documentId);
      const width = doc.width, height = doc.height;
      const reduced = Boolean(maxEdge && Math.max(width, height) > maxEdge);
      // Photoshop 25.3.1 cannot arbitrarily resample some 8-bit composites
      // while also promoting them to 16-bit. Exact cache levels can conceal
      // the failure. Keep reduced reads at native precision; full-resolution
      // reads and normalized 16-bit working sources retain 16-bit output.
      const componentSize = reduced && doc.bitsPerChannel === constants.BitsPerChannelType.EIGHT ? 8 : 16;
      const request = { documentID: documentId, colorSpace: "RGB", colorProfile: ADOBE_RGB,
        componentSize, applyAlpha: false };
      if (reduced) {
        request.targetSize = width >= height ? { width: maxEdge } : { height: maxEdge };
      }
      const image = await imaging.getPixels(request);
      try {
        const actualSize = image.imageData.componentSize;
        if (![8, 16].includes(actualSize)) throw new Error("Unsupported Photoshop pixel component size: " + actualSize);
        const raw = await image.imageData.getData({ fullRange: true });
        const data = actualSize === 8 ? new Uint8Array(raw) : new Uint16Array(raw);
        const scale = 2 ** (image.level || 0), b = image.sourceBounds;
        return { width: image.imageData.width, height: image.imageData.height, components: image.imageData.components,
          componentSize: actualSize, maximum: actualSize === 8 ? 255 : 65535, profile: ADOBE_RGB, data,
          bounds: { left: b.left * scale, top: b.top * scale, right: b.right * scale, bottom: b.bottom * scale } };
      } finally { image.imageData.dispose(); }
    });
  }

  function flattenLayers(layers) {
    return Array.from(layers).flatMap(layer => [layer].concat(layer.layers ? flattenLayers(layer.layers) : []));
  }

  async function maskSources(documentId) {
    return modal('Inspect material mask sources', async () => {
      const doc = docById(documentId);
      const layers = flattenLayers(doc.layers);
      const properties = await play(layers.map(layer => ({ _obj: "get", _target: [{ _ref: "layer", _id: layer.id }, { _ref: "document", _id: documentId }] })));
      return {
        layers: layers.filter((_layer, index) => properties[index].hasUserMask).map(layer => ({ id: layer.id, name: layer.name, kind: layer.kind })),
        channels: Array.from(doc.channels).map((channel, index) => ({ id: channel.id, index, name: channel.name, kind: channel.kind }))
          .filter(channel => channel.kind === constants.ChannelType.MASKEDAREA || channel.kind === constants.ChannelType.SELECTEDAREA),
        paths: Array.from(doc.pathItems).map((path, index) => ({ id: path.id, index, name: path.name }))
      };
    });
  }

  async function acquireMask(documentId, source) {
    const doc = docById(documentId);
    const readMask = getImage => modal('Read recoloring material mask', async () => {
      const image = await getImage();
      try {
        const componentSize = image.imageData.componentSize;
        const data = await image.imageData.getData({ fullRange: true });
        const mask = { width: image.imageData.width, height: image.imageData.height,
          left: image.sourceBounds.left, top: image.sourceBounds.top,
          maximum: componentSize === 16 ? 65535 : 255,
          data: componentSize === 16 ? new Uint16Array(data) : new Uint8Array(data) };
        validateMask(mask);
        if (!mask.data.some(v => v > 0)) throw new Error('Material mask is empty');
        return mask;
      } finally { image.imageData.dispose(); }
    });
    if (source.kind === "layerMask") {
      return readMask(async () => {
        const layer = flattenLayers(doc.layers).find(v => v.id === source.layerId);
        if (!layer) throw new Error("Selected mask layer no longer exists");
        const [properties] = await play([{ _obj: "get", _target: [{ _ref: "layer", _id: layer.id }, { _ref: "document", _id: documentId }] }]);
        if (!properties.hasUserMask) throw new Error("Selected layer has no pixel mask; layer transparency is not a layer mask");
        // These are documented DOM percentages/pixels. A broad get(layer)
        // descriptor does not reliably include mask density/feather on 25.3.
        const density = layer.layerMaskDensity;
        const feather = layer.layerMaskFeather;
        if (properties.userMaskEnabled === false || properties.hasVectorMask || density !== 100 || feather !== 0) {
          throw new Error("Complex mask modifiers require an explicit Photoshop selection in this experimental harness");
        }
        return imaging.getLayerMask({ documentID: documentId, layerID: layer.id, kind: "user" });
      });
    } else {
      if (source.kind !== "selection") {
        await atomic(documentId, "Load recoloring mask", async () => {
          await selectDoc(documentId);
          if (source.kind === "channel") {
            const channel = source.channelId != null ? Array.from(doc.channels).find(v => v.id === source.channelId)
              : Number.isInteger(source.channelIndex) && doc.channels[source.channelIndex] && doc.channels[source.channelIndex].name === source.name ? doc.channels[source.channelIndex] : null;
            if (!channel || ![constants.ChannelType.MASKEDAREA, constants.ChannelType.SELECTEDAREA].includes(channel.kind)) throw new Error("Choose a saved alpha selection");
            await doc.selection.load(channel, constants.SelectionType.REPLACE, false);
          } else if (source.kind === "path") {
            const path = source.pathId != null ? Array.from(doc.pathItems).find(v => v.id === source.pathId)
              : Number.isInteger(source.pathIndex) && doc.pathItems[source.pathIndex] && doc.pathItems[source.pathIndex].name === source.name ? doc.pathItems[source.pathIndex] : null;
            if (!path) throw new Error("Saved path no longer exists");
            await path.makeSelection(0, true, constants.SelectionType.REPLACE);
          } else throw new Error("Choose an explicit selection, layer mask, alpha channel, or path");
        });
      }
      return readMask(() => {
        if (!doc.selection.bounds) throw new Error('Create or load a material selection first');
        return imaging.getSelection({ documentID: documentId });
      });
    }
  }

  async function putMask(documentId, layerId, mask, existing = false) {
    validateMask(mask);
    const doc = docById(documentId), highPrecision = mask.maximum > 255;
    // DOM getters cross the Photoshop host boundary. Read geometry once;
    // millions of per-pixel native reads can block a production document.
    const width = doc.width, height = doc.height;
    const data = highPrecision ? new Uint16Array(width * height) : new Uint8Array(width * height);
    const maximum = highPrecision ? 65535 : 255;
    for (let y = 0; y < mask.height; y += 1) {
      for (let x = 0; x < mask.width; x += 1) {
        const dx = x + mask.left, dy = y + mask.top;
        if (dx >= 0 && dy >= 0 && dx < width && dy < height) data[dy * width + dx] = Math.round(mask.data[y * mask.width + x] / mask.maximum * maximum);
      }
    }
    await selectLayer(documentId, layerId);
    if (!existing) await play([{ _obj: "make", new: { _class: "channel" }, at: { _ref: "channel", _enum: "channel", _value: "mask" }, using: { _enum: "userMaskEnabled", _value: "hideAll" } }]);
    const imageData = await imaging.createImageDataFromBuffer(data, { width, height,
      components: 1, colorSpace: "Grayscale", colorProfile: "Gray Gamma 2.2", fullRange: highPrecision });
    try { await imaging.putLayerMask({ documentID: documentId, layerID: layerId, imageData, replace: true, targetBounds: { left: 0, top: 0 } }); }
    finally { imageData.dispose(); }
  }

  async function createPreview(snapshot) {
    const changed = () => Object.assign(new Error('Frozen source changed; capture a new source'), { code: 'FROZEN_SOURCE_CHANGED' });
    if (token(snapshot.documentId) !== snapshot.snapshotToken) throw changed();
    let preview;
    await modal("Create recoloring preview", async () => {
      if (token(snapshot.documentId) !== snapshot.snapshotToken) throw changed();
      preview = await duplicateDocument(snapshot.documentId, "Recolor preview " + id());
    });
    const insertion = snapshot.sourcePreparation && snapshot.sourcePreparation.insertion;
    const anchor = insertion && insertion.kind === "BEFORE_LAYER" ? locateLayer(preview, insertion.indices) : preview.layers[0];
    const session = { id: id(), documentId: preview.id, snapshot, groupId: null, committed: false, insertionAnchorId: anchor.id,
      expectedToken: token(preview.id), recipe: null, roles: {}, mask: null, cancelled: false };
    sessions.add(session);
    return session;
  }

  async function recoverSource(snapshot) {
    if (token(snapshot.original.id) !== JSON.stringify(snapshot.original)) {
      throw Object.assign(new Error('The original source also changed. All copies were preserved; start a new source session explicitly.'), { code: 'ORIGINAL_SOURCE_CHANGED' });
    }
    return captureSource(snapshot.original.id, { sourcePreparation: snapshot.sourcePreparation,
      untaggedProfile: snapshot.normalization && snapshot.normalization.explicitlyAssignedUntaggedProfile });
  }

  function assertPreview(session) {
    if (!sessions.has(session) || session.cancelled || session.committed) throw new Error("Preview is closed or already committed; create a new revision");
    if (token(session.documentId) !== session.expectedToken) throw Object.assign(new Error("Photoshop was edited outside the preview controls; existing edits were preserved. Create a new revision."), { code: "MANUAL_EDITS" });
  }

  async function showMaterialSelection(session, mask) {
    assertPreview(session); validateMask(mask);
    const doc = docById(session.documentId), width = doc.width, height = doc.height;
    const left = Math.max(0, Math.floor(mask.left)), top = Math.max(0, Math.floor(mask.top));
    const right = Math.min(width, Math.ceil(mask.left + mask.width)), bottom = Math.min(height, Math.ceil(mask.top + mask.height));
    if (right <= left || bottom <= top) throw new Error('The material mask is outside the preview canvas');
    const highPrecision = mask.maximum !== 255;
    const data = highPrecision ? new Uint16Array((right - left) * (bottom - top)) : new Uint8Array((right - left) * (bottom - top));
    const maximum = highPrecision ? 65535 : 255;
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      data[(y - top) * (right - left) + x - left] = Math.round(coverage(mask, x + 0.5, y + 0.5) * maximum);
    }
    await atomic(doc.id, 'Show captured material selection', async () => {
      assertPreview(session);
      await selectDoc(doc.id);
      const imageData = await imaging.createImageDataFromBuffer(data, { width: right - left, height: bottom - top,
        components: 1, colorSpace: 'Grayscale', colorProfile: 'Gray Gamma 2.2', fullRange: highPrecision });
      try { await imaging.putSelection({ documentID: doc.id, imageData, replace: true, targetBounds: { left, top } }); }
      finally { imageData.dispose(); }
    });
    session.expectedToken = token(doc.id);
  }

  async function render(session, recipe, mask) {
    assertPreview(session);
    const doc = docById(session.documentId), native = layerDescriptors(recipe);
    let groupId;
    let roles = {};
    await atomic(doc.id, "Preview recoloring " + recipe.method, async () => {
      assertPreview(session);
      await selectDoc(doc.id);
      if (session.groupId && session.recipe.method === recipe.method) {
        const commands = native.layers.flatMap(entry => {
          const layerId = session.roles[entry.role];
          if (!layerId) throw new Error("Preview role ownership is ambiguous");
          // The adjustment event accepts the active adjustment class rather
          // than a class-by-ID reference on 25.3. Select the precise layer ID
          // in this same modal batch, then set its native adjustment payload.
          return [
            { _obj: "select", _target: [{ _ref: "layer", _id: layerId }, { _ref: "document", _id: doc.id }], makeVisible: false },
            { _obj: "set", _target: [{ _ref: entry.command.using._obj, _enum: "ordinal", _value: "targetEnum" }], to: entry.command.using.type }
          ];
        });
        await play(commands);
        const group = flattenLayers(doc.layers).find(layer => layer.id === session.groupId);
        if (!group) throw new Error("Preview group is missing");
        group.opacity = recipe.parameters.intensity;
        group.visible = true;
        if (session.mask !== mask) await putMask(doc.id, group.id, mask, true);
        groupId = group.id;
        roles = session.roles;
        return;
      }
      if (session.groupId) {
        const group = flattenLayers(doc.layers).find(layer => layer.id === session.groupId);
        if (!group) throw new Error("Preview ownership is ambiguous");
        // On 25.3, deleting a group through the DOM can ungroup its children.
        // Delete only the verified disposable children before the container.
        for (const child of Array.from(group.layers)) await child.delete();
        await group.delete();
      }
      operation("DESELECT");
      await doc.selection.deselect();
      const anchor = Array.from(doc.layers).find(layer => layer.id === session.insertionAnchorId);
      if (!anchor) throw new Error("Reviewed insertion anchor is missing; preserve this revision and review the source again");
      await selectLayer(doc.id, anchor.id);
      operation("CREATE_RECOLOR_GROUP");
      const group = await doc.createLayerGroup({ name: "AI Recolor — " + (recipe.target.name || recipe.target.id || "Target") + " — " + recipe.engineVersion + " [" + session.id + "]" });
      operation("POSITION_RECOLOR_GROUP");
      await group.move(anchor, constants.ElementPlacement.PLACEBEFORE);
      group.blendMode = constants.BlendMode.PASSTHROUGH;
      for (const entry of native.layers) {
        operation("CREATE_NATIVE_" + entry.role.toUpperCase());
        await selectLayer(doc.id, group.id);
        await play([entry.command]);
        const layer = doc.activeLayers[0];
        if (!layer || layer.id === group.id) throw new Error("Photoshop did not create a native adjustment");
        await layer.move(group, constants.ElementPlacement.PLACEINSIDE);
        roles[entry.role] = layer.id;
        const [properties] = await play([{ _obj: "get", _target: [{ _ref: "layer", _id: layer.id }, { _ref: "document", _id: doc.id }] }]);
        if (properties.hasUserMask) {
          // Photoshop's Add Mask by Default preference can create a white
          // child mask even without a selection. Keep material coverage once.
          await selectLayer(doc.id, layer.id);
          await play([{ _obj: "delete", _target: [{ _ref: "channel", _enum: "channel", _value: "mask" }], apply: false }]);
        }
      }
      operation("WRITE_MATERIAL_MASK");
      await putMask(doc.id, group.id, mask);
      group.opacity = recipe.parameters.intensity;
      groupId = group.id;
    });
    session.groupId = groupId;
    session.roles = roles;
    session.recipe = JSON.parse(JSON.stringify(recipe));
    session.mask = mask;
    session.expectedToken = token(doc.id);
    return { groupId, targetGamutClipped: native.targetGamutClipped };
  }

  async function toggle(session, visible) {
    assertPreview(session);
    await atomic(session.documentId, "Compare recoloring", async () => {
      assertPreview(session);
      const group = flattenLayers(docById(session.documentId).layers).find(v => v.id === session.groupId);
      if (!group) throw new Error("Preview group is missing");
      group.visible = visible;
    });
    session.expectedToken = token(session.documentId);
  }

  async function commit(session) {
    assertPreview(session);
    if (!session.recipe) throw new Error("Render a recoloring preview before applying");
    await atomic(session.documentId, "Apply editable recoloring", async () => {
      assertPreview(session);
      const doc = docById(session.documentId);
      const group = flattenLayers(doc.layers).find(v => v.id === session.groupId);
      if (!group) throw new Error("Preview group is missing");
      group.visible = true;
      const edges = await doc.createPixelLayer({ name: "Edge Corrections" });
      await edges.move(group, constants.ElementPlacement.PLACEINSIDE);
      const touchups = await doc.createLayerGroup({ name: "Designer Final Touch-ups" });
      await touchups.move(group, constants.ElementPlacement.PLACEBEFORE);
    });
    session.committed = true;
    return { schemaVersion: 1, sessionId: session.id, documentId: session.documentId, groupId: session.groupId,
      originalSource: session.snapshot.original, normalization: session.snapshot.normalization,
      sourcePreparation: session.snapshot.sourcePreparation || null, sourceQualification: session.snapshot.sourceQualification,
      recovery: session.snapshot.recovery || null,
      recipe: session.recipe, status: "EXPERIMENTAL_DESIGNER_REVIEW_REQUIRED" };
  }

  async function cancel(session) {
    if (session.committed) throw new Error("Committed variants remain open for normal Photoshop editing");
    if (session.cancelled) return;
    // Never discard native manual edits made to the disposable preview.
    if (token(session.documentId) !== session.expectedToken) throw Object.assign(new Error("Preview contains manual edits; it was left open for you to save"), { code: "MANUAL_EDITS" });
    await modal("Close recoloring preview", () => {
      assertPreview(session);
      return docById(session.documentId).closeWithoutSaving();
    });
    session.cancelled = true;
    sessions.delete(session);
  }

  async function checkOutput(file, extensions, protectedPaths) {
    const normalize = value => String(value || '').replace(/\\/g, '/').toLowerCase();
    if (!file || !extensions.includes(String(file.name).split('.').pop().toLowerCase())) throw new Error('Choose a ' + extensions.join(' or ').toUpperCase() + ' output file.');
    if (protectedPaths.some(path => path && normalize(path) === normalize(file.nativePath))) throw new Error('Choose a new filename; source and approved reference files are protected.');
    if (Array.from(app.documents).some(doc => normalize(inspect(doc.id).path) === normalize(file.nativePath))) throw new Error('This output is open in Photoshop. Choose a new filename.');
    let metadata;
    try { metadata = await file.getMetadata(); }
    catch (error) {
      // UXP save-picker/createFile entries may not exist on disk until saved.
      if (error.code !== 'ENOENT' && !/^no such file or directory$/i.test(error.message)) throw error;
    }
    if (metadata && metadata.size > 0) throw new Error('This output already exists: ' + file.name + '. Choose a new filename to preserve existing files.');
  }

  function requireMaster(documentId) {
    const doc = docById(documentId);
    if (doc.colorProfileName !== ADOBE_RGB || doc.mode !== constants.DocumentMode.RGB) throw new Error('The master must remain RGB with the Adobe RGB (1998) profile.');
    return doc;
  }

  async function saveMaster(documentId, file, protectedPaths = []) {
    await checkOutput(file, ['psd', 'psb'], protectedPaths);
    const extension = /\.psb$/i.test(file.name) ? 'psb' : 'psd';
    await modal('Save editable recolor master', async () => {
      const doc = requireMaster(documentId);
      await checkOutput(file, ['psd', 'psb'], protectedPaths);
      await selectDoc(documentId);
      await doc.saveAs[extension](file, { layers: true, embedColorProfile: true, maximizeCompatibility: true }, true);
    });
    return { path: String(file.nativePath), format: extension, profile: ADOBE_RGB };
  }

  async function saveOutputs(documentId, masterFile, jpegFile, protectedPaths = []) {
    // Check both destinations before writing either one. Recheck under the host
    // modal lock; never replace a previous master, reference, or JPEG.
    const check = async () => {
      await checkOutput(masterFile, ['psd', 'psb'], protectedPaths);
      await checkOutput(jpegFile, ['jpg', 'jpeg'], protectedPaths);
    };
    await check();
    let master, jpeg;
    try {
      await modal('Save editable master and JPEG', async () => {
        await check();
        const doc = requireMaster(documentId), prior = app.activeDocument.id;
        const extension = /\.psb$/i.test(masterFile.name) ? 'psb' : 'psd';
        const width = doc.width, height = doc.height, resolution = doc.resolution;
        let copy, reopened;
        try {
          await selectDoc(documentId);
          await doc.saveAs[extension](masterFile, { layers: true, embedColorProfile: true, maximizeCompatibility: true }, true);
          master = { path: String(masterFile.nativePath), format: extension, profile: ADOBE_RGB };
          copy = await duplicateDocument(documentId, 'Recolor JPEG export ' + id());
          // Flatten in the original space before conversion so native blending
          // matches the master. Only this disposable duplicate is flattened.
          await copy.flatten();
          await copy.convertProfile(SRGB, constants.Intent.RELATIVECOLORIMETRIC, true, false);
          copy.bitsPerChannel = constants.BitsPerChannelType.EIGHT;
          await copy.saveAs.jpg(jpegFile, { quality: 12, embedColorProfile: true,
            formatOptions: constants.JPEGFormatOptions.STANDARDBASELINE, matteColor: constants.MatteColor.WHITE }, true);
          reopened = await openInModal(jpegFile);
          if (reopened.width !== width || reopened.height !== height || reopened.mode !== constants.DocumentMode.RGB
            || reopened.bitsPerChannel !== constants.BitsPerChannelType.EIGHT || reopened.colorProfileName !== SRGB
            || Math.abs(reopened.resolution - resolution) > 0.01 || reopened.layers.length !== 1) {
            throw new Error('Reopened JPEG differs from the requested dimensions, resolution, profile, depth, or flattened structure.');
          }
          jpeg = { path: String(jpegFile.nativePath), format: 'jpg', profile: SRGB, depth: 8,
            width, height, resolution, quality: 12, matte: 'WHITE', verified: true };
        } finally {
          if (reopened && documentIds().has(reopened.id)) await reopened.closeWithoutSaving();
          if (copy && documentIds().has(copy.id)) await copy.closeWithoutSaving();
          if (documentIds().has(prior)) await selectDoc(prior);
        }
      });
    } catch (error) {
      if (master) {
        error.savedMaster = master;
        error.message = 'Master saved at ' + master.path + ', but JPEG export failed: ' + error.message + ' Existing files and the editable document were retained.';
      }
      throw error;
    }
    return { master, jpeg };
  }

  return { inspect, inspectSource, atomic, captureSource, recoverSource, openDocument, saveSourceCheckpoint, restoreSourceCheckpoint, readPixels, maskSources, acquireMask, createPreview, showMaterialSelection, render, toggle, commit, cancel, saveMaster, saveOutputs,
    activateDocument: documentId => modal('Activate bound recoloring document', () => selectDoc(documentId)),
    markReference: documentId => openedReferences.add(documentId),
    releaseSource: snapshot => {
      if (token(snapshot.documentId) !== snapshot.snapshotToken) throw new Error("Frozen source has manual edits and was left open");
      return modal("Close frozen source", () => {
        if (token(snapshot.documentId) !== snapshot.snapshotToken) throw new Error("Frozen source has manual edits and was left open");
        return docById(snapshot.documentId).closeWithoutSaving();
      });
    },
    nativeLayers: documentId => flattenLayers(docById(documentId).layers).map(layer => ({ id: layer.id, name: layer.name, kind: layer.kind })) };
}

module.exports = { createPhotoshopAdapter, executeChecked };
