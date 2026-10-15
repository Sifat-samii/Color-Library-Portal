// Source-role review is independent of client reference approval and fitting.
// A live review authorizes only visibility changes in an owned duplicate.
const ROLES = ["KEEP_BASE", "DISABLE_RECOLOR", "DISABLE_GUIDE", "UNRESOLVED"];
const clone = value => JSON.parse(JSON.stringify(value));
const key = indices => JSON.stringify(indices);

function createSourcePreparation(inspection, options = {}) {
  if (!inspection || inspection.schemaVersion !== 1 || !inspection.binding || !Array.isArray(inspection.layers)
    || !inspection.layers.length) throw new Error("Inspect the bound source before reviewing its roles");
  const layers = new Map(inspection.layers.map(layer => [key(layer.indices), layer]));
  const roles = new Map();
  if (!Array.isArray(options.roles)) throw new Error("Explicit source-role decisions are required");
  for (const decision of options.roles) {
    if (!decision || !Array.isArray(decision.indices) || !layers.has(key(decision.indices)) || !ROLES.includes(decision.role)) {
      throw new Error("A source-role decision refers to an unknown layer or role");
    }
    if (roles.has(key(decision.indices))) throw new Error("Conflicting source-role decisions for one layer");
    roles.set(key(decision.indices), decision.role);
  }
  function effective(indices) {
    for (let depth = indices.length; depth > 0; depth -= 1) {
      const role = roles.get(key(indices.slice(0, depth)));
      if (role) return role;
    }
    return "UNRESOLVED";
  }
  const unresolved = [];
  const disableLayers = [];
  for (const layer of inspection.layers) {
    const role = effective(layer.indices);
    const hiddenByDecision = layer.indices.length > 1 && effective(layer.indices.slice(0, -1)).startsWith("DISABLE_");
    if (role === "KEEP_BASE" && hiddenByDecision) throw new Error("A retained base layer cannot be inside a branch disabled by this review");
    if (role === "UNRESOLVED") unresolved.push(clone(layer.indices));
    if (role.startsWith("DISABLE_") && !hiddenByDecision) disableLayers.push(clone(layer.indices));
  }
  const insertion = options.insertion;
  if (!insertion || (insertion.kind !== "TOP" && insertion.kind !== "BEFORE_LAYER")) throw new Error("Choose a reviewed material-processing location");
  if (insertion.kind === "BEFORE_LAYER" && (!Array.isArray(insertion.indices) || insertion.indices.length !== 1
    || !layers.has(key(insertion.indices)))) throw new Error("Choose an existing root layer as the insertion anchor; nested masked insertion is unsupported");
  const review = options.review || { status: "PENDING" };
  if (!["PENDING", "ACCEPTED"].includes(review.status)) throw new Error("Invalid source review status");
  if (review.status === "ACCEPTED") {
    if (unresolved.length) throw new Error("Unresolved source roles require retoucher review before capture");
    if (typeof review.reviewer !== "string" || !review.reviewer.trim() || !Number.isFinite(Date.parse(review.reviewedAt))) {
      throw new Error("Record the source reviewer and review time");
    }
  }
  return { schemaVersion: 1, type: "SOURCE_PREPARATION", revision: 1,
    source: clone(inspection), roles: clone(options.roles), insertion: clone(insertion), review: clone(review),
    unresolved, disableLayers, authority: "LIVE_SESSION_ONLY_REOPEN_REQUIRES_NEW_REVIEW",
    clientApprovalChanged: false };
}

function resolveSourcePreparation(preparation, inspection) {
  if (!preparation || preparation.schemaVersion !== 1 || preparation.type !== "SOURCE_PREPARATION" || preparation.revision !== 1) {
    throw new Error("Unsupported source-preparation manifest");
  }
  if (JSON.stringify(preparation.source) !== JSON.stringify(inspection)) {
    throw new Error("Source review is stale or belongs to another document; inspect and review it again");
  }
  // Rebuild derived decisions; modified cached fields never grant authority.
  const resolved = createSourcePreparation(inspection, preparation);
  if (resolved.review.status !== "ACCEPTED") throw new Error("Source roles remain pending retoucher review");
  return resolved;
}

module.exports = { createSourcePreparation, resolveSourcePreparation };
