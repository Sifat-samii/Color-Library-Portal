var REPRESENTATIVE_ROW_LIMIT = 20;

function normalizeRepresentativeDrafts(drafts, limit) {
  const max = Number.isInteger(limit) && limit > 0 ? limit : REPRESENTATIVE_ROW_LIMIT;
  const rows = (Array.isArray(drafts) ? drafts : []).slice(0, 100).map(item => ({
    displayName: String(item && item.displayName != null ? item.displayName : "").trim().slice(0, 120),
    email: String(item && item.email != null ? item.email : "").trim().toLowerCase().slice(0, 320)
  }));
  const active = [];
  rows.forEach((row, index) => {
    if (row.displayName || row.email) active.push({ ...row, index });
  });
  if (!active.length) {
    return {
      representatives: [],
      error: "Add at least one representative.",
      invalid: [{ index: 0, field: "name" }, { index: 0, field: "email" }]
    };
  }
  if (active.length > max) {
    return { representatives: [], error: `You can add up to ${max} representatives at once.`, invalid: [] };
  }
  const invalid = [];
  const seen = new Map();
  let missingName = false;
  let badEmail = false;
  let duplicate = false;
  for (const row of active) {
    if (!row.displayName) {
      missingName = true;
      invalid.push({ index: row.index, field: "name" });
    }
    if (!row.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
      badEmail = true;
      invalid.push({ index: row.index, field: "email" });
      continue;
    }
    if (seen.has(row.email)) {
      duplicate = true;
      invalid.push({ index: row.index, field: "email" });
      invalid.push({ index: seen.get(row.email), field: "email" });
    } else {
      seen.set(row.email, row.index);
    }
  }
  if (missingName || badEmail || duplicate) {
    const error = missingName && badEmail
      ? "Enter a name and a valid email for each representative."
      : missingName
        ? "Enter a name for each representative."
        : badEmail
          ? "Enter a valid email for every representative."
          : "Each representative email can only be added once.";
    return { representatives: [], error, invalid };
  }
  return {
    representatives: active.map(row => ({ displayName: row.displayName, email: row.email })),
    error: "",
    invalid: []
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { normalizeRepresentativeDrafts, REPRESENTATIVE_ROW_LIMIT };
}
