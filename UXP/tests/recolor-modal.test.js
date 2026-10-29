const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createPhotoshopAdapter } = require('../recolor/photoshop-adapter');

// Photoshop 25.3.1 live plugin rejects Imaging reads outside a modal scope.
// Standalone .psjs execution already has a scope and masked this regression.
function host() {
  let depth = 0, scopes = 0, disposed = 0;
  const checked = () => { if (!depth) throw new Error('Imaging read requires a modal scope'); };
  const image = components => ({ sourceBounds: { left: 0, top: 0, right: 4, bottom: 4 },
    imageData: { componentSize: 16, width: 4, height: 4, components,
      async getData() { checked(); return new Uint16Array(16 * components).fill(65535); }, dispose() { checked(); disposed++; } } });
  const doc = { id: 1, width: 4, height: 4, bitsPerChannel: 'SIXTEEN', layers: [], selection: { bounds: { left: 0, top: 0, right: 4, bottom: 4 } } };
  const photoshop = { app: { documents: [doc], activeDocument: doc }, constants: { BitsPerChannelType: { EIGHT: 'EIGHT' } },
    core: { async executeAsModal(work) { assert.equal(depth, 0, 'Native reads must not nest modal scopes'); scopes++; depth++; try { return await work({}); } finally { depth--; } } },
    imaging: { async getPixels() { checked(); return image(3); }, async getSelection() { checked(); return image(1); } } };
  return { adapter: createPhotoshopAdapter(photoshop), photoshop, get scopes() { return scopes; }, get disposed() { return disposed; }, get depth() { return depth; } };
}

test('modeless panel pixel reads enter and release a Photoshop modal scope, including buffer disposal', async () => {
  const h = host(); const frame = await h.adapter.readPixels(1, 640);
  assert.equal(frame.width, 4); assert.equal(frame.maximum, 65535);
  assert.equal(h.scopes, 1); assert.equal(h.disposed, 1); assert.equal(h.depth, 0);
});

test('modeless material-selection reads use a short modal scope without holding it for later UI work', async () => {
  const h = host(); const mask = await h.adapter.acquireMask(1, { kind: 'selection' });
  assert.equal(mask.data.length, 16); assert.equal(mask.maximum, 65535);
  assert.equal(h.scopes, 1); assert.equal(h.disposed, 1); assert.equal(h.depth, 0);
});

test('trimmed transparent pixel reads are padded to the complete requested native tile', async () => {
  const h = host(); let disposed = false;
  h.photoshop.imaging.getPixels = async () => ({ sourceBounds: { left: 1, top: 1, right: 3, bottom: 3 },
    imageData: { componentSize: 16, width: 2, height: 2, components: 4,
      async getData(){ assert.equal(h.depth, 1); return Uint16Array.from([101,202,303,65535,101,202,303,65535,101,202,303,65535,101,202,303,65535]); }, dispose(){disposed=true;} } });
  const tile = await h.adapter.readRegion(1, { left: 0, top: 0, right: 4, bottom: 4 });
  assert.equal(tile.width, 4); assert.equal(tile.height, 4); assert.equal(tile.components, 4);
  assert.equal(tile.data[0], 0); assert.equal(tile.data[3], 0);
  assert.equal(tile.data[(1 * 4 + 1) * 4], 101); assert.equal(tile.data[(1 * 4 + 1) * 4 + 3], 65535);
  assert.equal(disposed, true); assert.equal(h.depth, 0);
});

test('hidden RGB is canonicalized without changing alpha or visible RGB', async () => {
  const h = host();
  h.photoshop.imaging.getPixels = async () => ({ sourceBounds: { left: 0, top: 0, right: 4, bottom: 4 }, imageData: {
    componentSize: 16, width: 4, height: 4, components: 4, async getData(){const data=new Uint16Array(64).fill(20000);data[3]=0;return data;},dispose(){} } });
  const frame = await h.adapter.readPixels(1);
  assert.deepEqual(Array.from(frame.data.slice(0,4)), [0,0,0,0]);
  assert.deepEqual(Array.from(frame.data.slice(4,8)), [20000,20000,20000,20000]);
});
