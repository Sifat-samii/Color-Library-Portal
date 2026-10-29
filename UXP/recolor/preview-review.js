const METHOD_NAMES = Object.freeze({
  AUTO: 'Automatic', A: 'Solid color and tone', B: 'Hue and selective color', C: 'Gradient and tone', D: 'Tint and levels'
});
const METHOD_HELP = Object.freeze({
  AUTO: 'Analyzes the fabric and compares rendered color, lighting, texture, highlights and clipping.',
  A: 'Sets target hue and chroma with Color blending, with separate editable tonal shaping.',
  B: 'Changes hue and saturation with selective color corrections, retaining source shading.',
  C: 'Maps the target color across the tonal range, with separate tone and lighting controls.',
  D: 'Neutralizes the source color and uses a tinted conversion, levels and color balance.'
});

// L* differences are search heuristics, not a quality guarantee. Every method
// still competes on measured Photoshop output, including for extreme changes.
function analyzeTransition(source, target) {
  const sourceLightness = source.diffuseLab[0], targetLightness = target.diffuseLab[0];
  const delta = targetLightness - sourceLightness, magnitude = Math.abs(delta);
  return { sourceLightness, targetLightness, deltaLightness: delta,
    direction: magnitude < 12 ? 'SIMILAR_LIGHTNESS' : delta > 0 ? 'DARK_TO_LIGHT' : 'LIGHT_TO_DARK',
    demanding: magnitude >= 20 };
}

function transitionText(transition) {
  if (!transition) return '';
  const label = transition.direction === 'SIMILAR_LIGHTNESS' ? 'Similar lightness'
    : transition.direction === 'DARK_TO_LIGHT' ? 'Darker to lighter' : 'Lighter to darker';
  return label + (transition.demanding ? ' · extended matching' : '');
}

function qualityReview(quality) {
  if (!quality || !quality.available) return 'Review unavailable for this preview.';
  if (quality.report && quality.report.schemaVersion === 2) {
    const report = quality.report, labels = { CHECKS_PASSED: 'Implemented checks passed', NEEDS_REVIEW: 'Needs review', INTEGRITY_FAILURE: 'Integrity failure' };
    const parts = [labels[report.verdict], 'Diffuse color difference ΔE00 ' + quality.anchorDeltaE00.toFixed(2)];
    if (Number.isFinite(report.metrics.foldDepth)) parts.push('Relative fold depth ' + report.metrics.foldDepth.toFixed(2) + '×');
    if (Number.isFinite(report.metrics.fine.correlation)) parts.push('Texture correlation ' + report.metrics.fine.correlation.toFixed(2));
    const failed = report.issues.filter(issue => issue.status === 'REVIEW').map(issue => issue.dimension);
    if (failed.length) parts.push('Check ' + failed.join(', '));
    if (report.issues.some(issue => issue.status === 'UNAVAILABLE')) parts.push('Some checks could not be measured');
    return parts.join('. ') + '. Inspect at 100% before applying.';
  }
  const parts = [];
  if (Number.isFinite(quality.anchorDeltaE00)) parts.push('Color difference ΔE00 ' + quality.anchorDeltaE00.toFixed(2));
  if (quality.tone && Number.isFinite(quality.tone.shadowDelta) && Number.isFinite(quality.tone.highlightDelta)) {
    const signed = value => (value > 0 ? '+' : '') + value.toFixed(1);
    parts.push('Shadow / highlight difference ' + signed(quality.tone.shadowDelta) + ' / ' + signed(quality.tone.highlightDelta) + ' L*');
  }
  const integrity = quality.integrity || {};
  if (Number.isFinite(integrity.addedClippingFraction)) parts.push('Added tonal clipping ' + (integrity.addedClippingFraction * 100).toFixed(1) + '%');
  if (Number.isFinite(integrity.normalizedDetailRatio)) parts.push('Relative detail ' + integrity.normalizedDetailRatio.toFixed(2) + '×');
  else parts.push('Texture needs visual inspection');
  if (quality.lighting) parts.push('Relative fold depth ' + quality.lighting.spreadRatio.toFixed(2) + '×');
  if (Number.isFinite(integrity.highlightDetailRetention)) parts.push('Highlight detail ' + integrity.highlightDetailRetention.toFixed(2) + '×');
  if (Number.isFinite(integrity.highlightDetailRetention) && integrity.highlightDetailRetention < 0.25
    || Number.isFinite(integrity.highlightLossFraction) && integrity.highlightLossFraction > 0.35) parts.push('Bright fabric detail needs review');
  if (quality.targetGamutClipped) parts.push('Target exceeds the working color gamut');
  return parts.join('. ') + '. Inspect folds, texture and edges at 100%.';
}

function previewPresentation(state, selectedMethod) {
  const review = state.previewReview, method = state.recipe && state.recipe.method;
  const requested = review ? review.requestedMethod : method;
  const pending = Boolean(state.rendered && selectedMethod !== requested);
  const name = METHOD_NAMES[method] || method || '';
  const title = state.rendered ? (requested === 'AUTO' ? 'Automatic chose ' : 'Preview: ') + name
    + (review && review.manuallyAdjusted ? ' · manually adjusted' : '') : '';
  const last = (state.methodReviews || []).find(item => item.requestedMethod === selectedMethod);
  const selection = state.quality && state.quality.matching && state.quality.matching.selection;
  const selectionNote = requested === 'AUTO' && selection ? selection.version === 'fabric-constrained-selection-1' ? selection.reason : selection.preferenceApplied ? selection.reason
    : selection.preservationIssues && selection.preservationIssues.length ? 'Compared methods still need fabric-preservation review. ' + selection.preservationIssues.join('. ')
      : 'Preferred Tint and levels did not pass the fabric-preservation checks; inspect this fallback. ' + (selection.preferredMethodIssues || []).join('. ') : '';
  return { pending, title, help: METHOD_HELP[selectedMethod] || '',
    review: pending ? 'Press Refresh preview to render ' + METHOD_NAMES[selectedMethod] + '. The canvas still shows ' + name + '.'
      + (last && last.quality && Number.isFinite(last.quality.anchorDeltaE00) ? ' Previous color difference: ΔE00 ' + last.quality.anchorDeltaE00.toFixed(2) + '.' : '')
      : qualityReview(state.quality) + (selectionNote ? ' ' + selectionNote : ''),
    applyHint: pending ? 'Refresh the selected method before applying.' : 'Applies this preview, including manual adjustments.',
    transition: transitionText(review && review.transition) };
}

module.exports = { METHOD_NAMES, METHOD_HELP, analyzeTransition, qualityReview, previewPresentation };
