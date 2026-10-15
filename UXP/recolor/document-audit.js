const { executeChecked, createPhotoshopAdapter } = require("./photoshop-adapter");

// Read-only native inspection. Only newly opened audit documents are closed.
async function auditDocuments(photoshop, uxp, folder, inputs) {
  const report = { schemaVersion: 1, host: uxp.host, startedAt: new Date().toISOString(),
    productionQualified: false, documents: [], cleanupErrors: [] };
  const initial = new Set(Array.from(photoshop.app.documents).map(doc => doc.id));
  const prior = photoshop.app.documents.length ? photoshop.app.activeDocument.id : null;
  const fs = uxp.storage.localFileSystem;
  const adapter = createPhotoshopAdapter(photoshop, { executionContext: uxp.script.executionContext });
  const write = () => require("fs").writeFileSync(folder.url + "/report.json", JSON.stringify(report, null, 2));
  const flatten = layers => Array.from(layers).flatMap(layer => [layer].concat(layer.layers ? flatten(layer.layers) : []));
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index], start = Date.now();
    let doc, openedId;
    try {
      report.current = { index, label: input.label, status: "OPENING", startedAt: new Date().toISOString() }; write();
      const file = await fs.getEntryWithUrl("file:/" + input.path.replace(/\\/g, "/"));
      doc = await adapter.openDocument(file);
      openedId = doc.id;
      const layers = flatten(doc.layers);
      const descriptors = await executeChecked(photoshop, layers.map(layer => ({ _obj: "get",
        _target: [{ _ref: "layer", _id: layer.id }, { _ref: "document", _id: doc.id }] })));
      const entry = { label: input.label, path: input.path, id: doc.id, name: doc.name,
        width: doc.width, height: doc.height, depth: doc.bitsPerChannel, mode: doc.mode, profile: doc.colorProfileName,
        channels: Array.from(doc.channels).map(channel => ({ name: channel.name, kind: channel.kind })),
        paths: Array.from(doc.pathItems).map(path => ({ name: path.name, kind: path.kind })),
        layers: layers.map((layer, n) => ({ id: layer.id, name: layer.name, kind: layer.kind,
          visible: layer.visible, opacity: layer.opacity, blendMode: layer.blendMode,
          bounds: layer.boundsNoEffects, hasUserMask: !!descriptors[n].hasUserMask,
          maskEnabled: descriptors[n].userMaskEnabled, density: layer.layerMaskDensity,
          feather: layer.layerMaskFeather, hasVectorMask: !!descriptors[n].hasVectorMask,
          adjustment: descriptors[n].adjustment || null })), status: "INSPECTED" };
      const pixels = await photoshop.imaging.getPixels({ documentID: doc.id, targetSize: { height: 600 },
        colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1", componentSize: 8, applyAlpha: true });
      try {
        const bytes = await photoshop.imaging.encodeImageData({ imageData: pixels.imageData });
        const thumbnail = await folder.createFile("document-" + index + ".jpg", { overwrite: false });
        await thumbnail.write(new Uint8Array(bytes), { format: uxp.storage.formats.binary });
        entry.thumbnail = thumbnail.name;
      } finally { pixels.imageData.dispose(); }
      entry.milliseconds = Date.now() - start;
      report.documents.push(entry);
    } catch (error) { report.documents.push({ label: input.label, path: input.path, status: "ERROR", error: error.message, stack: error.stack,
      openDocuments: Array.from(photoshop.app.documents).map(value => ({ id: value.id, name: value.name })) }); }
    finally {
      if (doc && !initial.has(openedId)) try { await doc.closeWithoutSaving(); }
      catch (error) { report.cleanupErrors.push({ id: openedId, error: error.message }); }
      write();
    }
  }
  if (prior && Array.from(photoshop.app.documents).some(doc => doc.id === prior)) {
    await executeChecked(photoshop, [{ _obj: "select", _target: [{ _ref: "document", _id: prior }] }]);
  }
  report.current = null; report.finishedAt = new Date().toISOString(); write();
  return report;
}

module.exports = { auditDocuments };
