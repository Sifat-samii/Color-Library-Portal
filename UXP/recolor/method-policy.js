// Designer feedback changes method choice, not client-library approval or
// fixed color-name recipes. Thresholds are provisional review guardrails.
const POLICY_VERSION = 'designer-lightening-2026-10-27-v1';

function isNearWhite(target) {
  const lab = target && target.diffuseLab;
  return Boolean(lab && (lab[0] >= 90 || lab[0] >= 85 && Math.hypot(lab[1], lab[2]) <= 12));
}

function methodPolicy(source, target) {
  if (!source || !target || source.diffuseLab[0] > 50 || target.diffuseLab[0] < 60
    || target.diffuseLab[0] - source.diffuseLab[0] < 20) return null;
  const nearWhite = isNearWhite(target);
  return {
    id: POLICY_VERSION, transition: nearWhite ? 'DARK_TO_NEAR_WHITE' : 'DARK_TO_LIGHT',
    preferredMethods: nearWhite ? ['D', 'C'] : ['D'],
    maxAddedClipping: 0.02, minDetail: 0.5, minFoldDepth: nearWhite ? 0.5 : 0.35,
    minHighlightDetail: nearWhite ? 0.25 : null,
    maxHighlightLoss: nearWhite ? 0.35 : null,
    reason: nearWhite ? 'Designer feedback: prefer Tint and levels with highlight protection; use Gradient and tone only when fabric depth survives.'
      : 'Designer feedback: prefer Tint and levels for clear dark-to-light changes.'
  };
}

function preservationIssues(quality, policy) {
  if (!policy) return [];
  const integrity = quality.integrity || {}, issues = [];
  if (integrity.critical) issues.push('Protected material boundaries changed');
  if (Number.isFinite(integrity.addedClippingFraction) && integrity.addedClippingFraction > policy.maxAddedClipping) issues.push('Added tonal clipping');
  if (Number.isFinite(integrity.normalizedDetailRatio) && integrity.normalizedDetailRatio < policy.minDetail) issues.push('Fabric detail reduced');
  if (Number.isFinite(integrity.relativeLightingSpread) && integrity.relativeLightingSpread < policy.minFoldDepth) issues.push('Fabric lighting too flat');
  if (Number.isFinite(policy.minHighlightDetail) && Number.isFinite(integrity.highlightDetailRetention) && integrity.highlightDetailRetention < policy.minHighlightDetail
    || Number.isFinite(policy.maxHighlightLoss) && Number.isFinite(integrity.highlightLossFraction) && integrity.highlightLossFraction > policy.maxHighlightLoss) issues.push('Highlight fabric detail washed out');
  return issues;
}

function methodRank(recipe, quality, policy) {
  if (!policy) return 0;
  if (preservationIssues(quality, policy).length) return policy.preferredMethods.length + 1;
  const index = policy.preferredMethods.indexOf(recipe.method);
  return index < 0 ? policy.preferredMethods.length : index;
}

module.exports = { POLICY_VERSION, isNearWhite, methodPolicy, preservationIssues, methodRank };
