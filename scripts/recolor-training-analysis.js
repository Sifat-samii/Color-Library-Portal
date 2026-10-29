const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { rgbToLab, ADOBE_RGB } = require('../UXP/recolor/color');

const X_SAMPLES = [0, 64, 128, 192, 255];
const SUPPORT_GROUPS = /^(swatch adjustment(?: - n\/a)?|last comment)$/i;

function quantile(values, fraction) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position), high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

function rounded(value, places = 4) {
  return Number(value.toFixed(places));
}

function normalizeName(value) {
  return String(value).replace(/_Details$/i, '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function pathStartsWith(candidate, prefix) {
  return prefix.every((value, index) => candidate[index] === value);
}

function effectiveVisible(layers, layer) {
  for (let depth = 1; depth <= layer.path.length; depth += 1) {
    const ancestor = layers.find(value => value.path.length === depth && pathStartsWith(layer.path, value.path));
    if (!ancestor || !ancestor.visible) return false;
  }
  return true;
}

function adjustmentObject(layer) {
  return Array.isArray(layer.adjustment) ? layer.adjustment[0] : null;
}

function targetRgb(document, target, descendants) {
  for (const layer of descendants) {
    const adjustment = adjustmentObject(layer);
    const color = adjustment && (adjustment.tintColor || adjustment.color);
    if (color && [color.red, color.grain, color.blue].every(Number.isFinite)) return [color.red, color.grain, color.blue];
  }
  const reference = document.layers.find(layer => layer.path[0] === 'REF' && layer.path.some(name => normalizeName(name) === normalizeName(target.name))
    && adjustmentObject(layer) && adjustmentObject(layer).color);
  if (!reference) return null;
  const color = adjustmentObject(reference).color;
  return [color.red, color.grain, color.blue];
}

function interpolate(points, x) {
  const sorted = points.slice().sort((a, b) => a[0] - b[0]);
  if (x <= sorted[0][0]) return sorted[0][1];
  if (x >= sorted.at(-1)[0]) return sorted.at(-1)[1];
  for (let index = 1; index < sorted.length; index += 1) {
    if (x <= sorted[index][0]) {
      const [x0, y0] = sorted[index - 1], [x1, y1] = sorted[index];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  return sorted.at(-1)[1];
}

function curvePoints(layer) {
  const adjustment = adjustmentObject(layer);
  const composite = adjustment && Array.isArray(adjustment.adjustment)
    ? adjustment.adjustment.find(value => value.channel && value.channel._value === 'composite' && Array.isArray(value.curve)) : null;
  return composite ? composite.curve.map(point => [point.horizontal, point.vertical]) : null;
}

function toneBand(lightness) {
  return lightness < 40 ? 'DARK' : lightness < 70 ? 'MID' : 'LIGHT';
}

function inspectDocument(document) {
  if (document.status !== 'INSPECTED') throw new Error('Training document was not inspected: ' + document.label);
  const candidates = document.layers.filter(layer => layer.kind === 'group' && layer.path.length === 2 && layer.path[0] === 'CC'
    && !SUPPORT_GROUPS.test(layer.name) && effectiveVisible(document.layers, layer));
  const matching = candidates.filter(layer => normalizeName(layer.name) === normalizeName(document.label));
  const target = matching.length === 1 ? matching[0] : candidates.length === 1 ? candidates[0] : null;
  if (!target) throw new Error('Expected one visible target group in ' + document.label + '; found ' + candidates.map(value => value.name).join(', '));
  const descendants = document.layers.filter(layer => layer.path.length > target.path.length && pathStartsWith(layer.path, target.path)
    && effectiveVisible(document.layers, layer));
  const rgb = targetRgb(document, target, descendants);
  if (!rgb) throw new Error('No native target tint or reference fill found in ' + document.label);
  const lab = rgbToLab(rgb, ADOBE_RGB), processingOrder = descendants.slice().reverse();
  const curves = processingOrder.map(layer => ({ layer, points: curvePoints(layer) })).filter(value => value.points);
  const brightness = processingOrder.filter(layer => layer.kind === 'brightnessContrast').map(layer => adjustmentObject(layer));
  const levels = processingOrder.filter(layer => layer.kind === 'levels').map(layer => adjustmentObject(layer));
  const colorBalance = processingOrder.filter(layer => layer.kind === 'colorBalance').map(layer => adjustmentObject(layer));
  const hueSaturation = processingOrder.filter(layer => layer.kind === 'hueSaturation').map(layer => adjustmentObject(layer));
  const pixelLayers = descendants.filter(layer => layer.kind === 'pixel');
  const supportLayers = document.layers.filter(layer => layer.path.length > 2 && layer.path[0] === 'CC'
    && SUPPORT_GROUPS.test(layer.path[1]) && effectiveVisible(document.layers, layer));
  const normalized = {
    targetRgb: rgb.map(value => rounded(value)),
    targetLayers: processingOrder.map(layer => ({ kind: layer.kind, blendMode: layer.blendMode,
      opacity: rounded(layer.opacity), adjustment: layer.adjustment || null }))
  };
  const signature = crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  return {
    label: document.label, sourceFile: document.sourceFile || null, target: target.name.trim(), targetRgb: rgb.map(value => rounded(value)),
    targetLab: lab.map(value => rounded(value)), toneBand: toneBand(lab[0]), signature,
    targetGroup: { path: target.path, blendMode: target.blendMode, opacity: Number.isFinite(target.opacity) ? rounded(target.opacity) : null,
      hasUserMask: target.hasUserMask, maskEnabled: target.maskEnabled, density: target.density, feather: target.feather },
    targetLayers: processingOrder.map(layer => ({ name: layer.name, path: layer.path, kind: layer.kind,
      blendMode: layer.blendMode, opacity: rounded(layer.opacity), fillOpacity: layer.fillOpacity,
      clippedToPrevious: layer.clippedToPrevious, hasUserMask: layer.hasUserMask, maskEnabled: layer.maskEnabled,
      density: layer.density, feather: layer.feather, adjustment: layer.adjustment || null })),
    processingOrder: processingOrder.map(layer => layer.kind),
    techniques: {
      tintedBlackAndWhite: processingOrder.some(layer => layer.kind === 'blackAndWhite' && adjustmentObject(layer)?.useTint === true),
      fullDesaturation: hueSaturation.some(value => value.adjustment?.some(range => range.saturation === -100)),
      rangeHueSaturation: hueSaturation.some(value => value.adjustment?.some(range => Number.isFinite(range.localRange))),
      curves: curves.length > 0, brightnessContrast: brightness.length > 0, levels: levels.length > 0,
      colorBalance: colorBalance.length > 0, solidColor: processingOrder.some(layer => layer.kind === 'solidColor'),
      texturePixels: pixelLayers.length > 0, supportCorrections: supportLayers.length > 0
    },
    tone: {
      curvePoints: curves[0] ? curves[0].points : null,
      curveSamples: curves[0] ? X_SAMPLES.map(x => rounded(interpolate(curves[0].points, x))) : null,
      brightness: brightness.map(value => value.brightness), contrast: brightness.map(value => value.center),
      levels: levels.map(value => value.adjustment || null)
    },
    colorBalance: colorBalance.map(value => ({ shadows: value.shadowLevels, midtones: value.midtoneLevels,
      highlights: value.highlightLevels, preserveLuminosity: value.preserveLuminosity })),
    texture: pixelLayers.map(layer => ({ name: layer.name, blendMode: layer.blendMode, opacity: rounded(layer.opacity) })),
    supportCorrections: supportLayers.map(layer => ({ path: layer.path, kind: layer.kind, adjustment: layer.adjustment || null }))
  };
}

function summarizeBand(entries) {
  if (!entries.length) return { cases: 0, targetLightness: null, curveCases: 0, curveOutputP25: null,
    curveOutputP50: null, curveOutputP75: null, brightnessContrastCases: 0, brightness: null, contrast: null, textureCases: 0 };
  const withCurves = entries.filter(entry => entry.tone.curveSamples);
  const brightness = entries.flatMap(entry => entry.tone.brightness);
  const contrast = entries.flatMap(entry => entry.tone.contrast);
  const sample = fraction => X_SAMPLES.map((x, index) => [x, rounded(quantile(withCurves.map(entry => entry.tone.curveSamples[index]), fraction))]);
  return {
    cases: entries.length,
    targetLightness: { min: rounded(Math.min(...entries.map(entry => entry.targetLab[0]))),
      median: rounded(quantile(entries.map(entry => entry.targetLab[0]), 0.5)), max: rounded(Math.max(...entries.map(entry => entry.targetLab[0]))) },
    curveCases: withCurves.length,
    curveOutputP25: withCurves.length ? sample(0.25) : null,
    curveOutputP50: withCurves.length ? sample(0.5) : null,
    curveOutputP75: withCurves.length ? sample(0.75) : null,
    brightnessContrastCases: entries.filter(entry => entry.techniques.brightnessContrast).length,
    brightness: brightness.length ? { min: Math.min(...brightness), median: rounded(quantile(brightness, 0.5)), max: Math.max(...brightness) } : null,
    contrast: contrast.length ? { min: Math.min(...contrast), median: rounded(quantile(contrast, 0.5)), max: Math.max(...contrast) } : null,
    textureCases: entries.filter(entry => entry.techniques.texturePixels).length
  };
}

function analyzeReport(report) {
  if (!report || !Array.isArray(report.documents) || !report.documents.length) throw new Error('A native Photoshop training audit is required');
  const files = report.documents.map(inspectDocument);
  const seen = new Set(), unique = files.filter(entry => !seen.has(entry.signature) && seen.add(entry.signature));
  const techniqueCounts = {};
  for (const key of Object.keys(unique[0].techniques)) techniqueCounts[key] = unique.filter(entry => entry.techniques[key]).length;
  const digest = crypto.createHash('sha256').update(report.documents.slice().sort((a, b) => a.label.localeCompare(b.label))
    .map(document => document.label + ':' + (document.sourceFile?.sha256 || '')).join('\n')).digest('hex');
  return {
    schemaVersion: 1,
    role: 'APPROVED_HUMAN_EDIT_TRAINING_STANDARDS',
    sourceAudit: { startedAt: report.startedAt, finishedAt: report.finishedAt, build: report.build || null,
      files: report.documents.length, layers: report.documents.reduce((sum, document) => sum + document.layers.length, 0),
      corpusSha256: digest, profiles: [...new Set(report.documents.map(document => document.profile))],
      depths: [...new Set(report.documents.map(document => document.depth))], cleanupErrors: report.cleanupErrors?.length || 0 },
    evidence: { files: files.length, uniqueRecipes: unique.length, duplicateFiles: files.length - unique.length,
      techniqueCounts, techniqueRates: Object.fromEntries(Object.entries(techniqueCounts).map(([key, value]) => [key, rounded(value / unique.length)])) },
    toneBands: Object.fromEntries(['DARK', 'MID', 'LIGHT'].map(band => [band, summarizeBand(unique.filter(entry => entry.toneBand === band))])),
    files
  };
}

if (require.main === module) {
  const reportPath = process.argv[2], outputPath = process.argv[3];
  if (!reportPath) throw new Error('Usage: node scripts/recolor-training-analysis.js <audit-report.json> [output.json]');
  const analysis = analyzeReport(JSON.parse(fs.readFileSync(path.resolve(reportPath), 'utf8')));
  const json = JSON.stringify(analysis, null, 2) + '\n';
  if (outputPath) fs.writeFileSync(path.resolve(outputPath), json);
  else process.stdout.write(json);
}

module.exports = { X_SAMPLES, quantile, interpolate, toneBand, inspectDocument, analyzeReport };
