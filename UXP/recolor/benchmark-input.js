function eligibility(input) {
  if (/HEATHER[ _-]*ASH/i.test(String(input.target || input.canonicalTarget || ''))) return { eligible: false, reason: 'EXCLUDED_BY_DATASET_OWNER' };
  if (!input.sourceCheckpoint) return { eligible: false, reason: 'REVIEWED_ORIGINAL_SOURCE_CHECKPOINT_REQUIRED' };
  if (!input.mask || !['layerMask', 'channel', 'path'].includes(input.mask.kind)) return { eligible: false, reason: 'EXPLICIT_SOURCE_DERIVED_MASK_REQUIRED' };
  if (input.mask.reviewed !== true || input.referenceRegionReviewed !== true) return { eligible: false, reason: 'MASK_AND_REFERENCE_REGION_REVIEW_NOT_RECORDED' };
  return { eligible: true, reason: null };
}
module.exports = { eligibility };
