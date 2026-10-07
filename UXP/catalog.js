function normalizeText(value) {
  var text = String(value || "");
  if (text.normalize) {
    text = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  }
  return text
    .toUpperCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

function addChange(group, kind) {
  if (group.changeKinds.indexOf(kind) === -1) group.changeKinds.push(kind);
}

function referencePriority(reference) {
  var kind = normalizeText(reference && reference.kind);
  if (kind === "QUICK") return 0;
  if (kind === "FULL") return 1;
  if (kind === "WORKING") return 2;
  return 3;
}

function fileExtension(name) {
  var base = String(name || "").split(/[/\\]/).pop();
  var dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function cachedDownloadIsComplete(actualSize, expectedSize) {
  var expected = Number(expectedSize);
  if (!Number.isFinite(expected) || expected <= 0) return false;
  return Number(actualSize) === expected;
}

function remoteFileName(ref) {
  var extension = fileExtension(ref && (ref.extension ? "file." + ref.extension : ref.baseName)) || "bin";
  var id = String(ref && ref.versionId || "file").replace(/[^a-z0-9-]/gi, "").slice(0, 36) || "file";
  var checksum = String(ref && ref.checksumSha256 || "").replace(/[^a-f0-9]/gi, "").slice(0, 12);
  return id + (checksum ? "-" + checksum : "") + "." + extension;
}

function referenceDisplayName(reference) {
  var kind = normalizeText(reference && (reference.referenceKind || reference.kind));
  var label = String((reference && (reference.referenceLabel || reference.label)) || "")
    .replace(/(?:\s+reference)+$/i, "")
    .trim();
  if (kind === "QUICK") return "Crop";
  if (kind === "FULL") return "Full";
  if (kind === "WORKING") return "Working";
  if (label) return label;
  var folder = normalizePath((reference && reference.relativePath) || "").split("/")[0] || "";
  if (folder === "full" || folder.indexOf("full ") === 0) return "Full";
  if (folder === "crop" || folder.indexOf("crop ") === 0) return "Crop";
  if (reference && /^(psd|psb)$/.test(String(reference.extension || ""))) return "Working";
  var variant = String((reference && reference.variant) || "").replace(/\s+reference$/i, "");
  return variant || "Crop";
}

function buildManagedCatalog(files, baseline, portalCatalog) {
  var baselineFiles = baseline && baseline.files ? baseline.files : {};
  var hasBaseline = Boolean(baseline && baseline.files);
  var filesByPath = {};
  (files || []).forEach(function (file) { filesByPath[normalizePath(file.relativePath)] = file; });

  return ((portalCatalog && portalCatalog.colors) || []).map(function (color) {
    var group = {
      id: color.id || color.normalizedKey,
      portalColorId: color.id || null,
      normalizedKey: color.normalizedKey || normalizeText(color.name),
      displayName: color.name || color.normalizedKey,
      colorCode: color.colorCode || "",
      hexCode: color.hexCode || "",
      instructions: color.instructions || "",
      aliases: color.aliases || [],
      refs: [],
      missingRefs: [],
      changeKinds: [],
      latestModified: 0,
      latestApprovedAt: 0
    };

    (color.references || []).forEach(function (reference) {
      var version = reference.version;
      if (!version || version.status !== "APPROVED") return;
      var portalData = {
        portalReferenceId: reference.id,
        referenceKind: reference.kind || "REFERENCE",
        referenceLabel: reference.label || "",
        referenceInstructions: reference.instructions || "",
        versionId: version.id,
        versionNumber: version.number,
        approvedAt: version.approvedAt || null,
        syncedAt: version.syncedAt || null,
        uploadNote: version.uploadNote || "",
        checksumSha256: version.checksumSha256 || "",
        originalFilename: version.originalFilename || ""
      };
      group.latestApprovedAt = Math.max(group.latestApprovedAt, Date.parse(version.approvedAt || 0) || 0);
      var pathKey = version.localRelativePath ? normalizePath(version.localRelativePath) : "";
      var localFile = pathKey ? filesByPath[pathKey] : null;
      if (!localFile) {
        if (!version.id) {
          group.missingRefs.push(Object.assign({
            relativePath: version.localRelativePath || ("Not synchronized · " + (version.originalFilename || reference.label || "Approved reference")),
            baseName: version.originalFilename || reference.label || "Approved reference"
          }, portalData));
          addChange(group, "missing");
          return;
        }
        var baseName = version.originalFilename || String(version.localRelativePath || "").split(/[/\\]/).pop() || reference.label || "Approved reference";
        group.refs.push(Object.assign({
          baseName: baseName,
          relativePath: version.localRelativePath || baseName,
          extension: fileExtension(baseName),
          size: Number(version.sizeBytes) || 0,
          remote: true,
          entry: null,
          colorId: group.id,
          displayName: group.displayName,
          preference: referencePriority(reference)
        }, portalData));
        return;
      }

      var managedFile = Object.assign({}, localFile, portalData);
      managedFile.colorId = group.id;
      managedFile.displayName = group.displayName;
      managedFile.preference = referencePriority(reference);
      group.refs.push(managedFile);
      group.latestModified = Math.max(group.latestModified, localFile.modified || 0);
      var old = baselineFiles[localFile.pathKey];
      if (!hasBaseline || !old) addChange(group, "added");
      else if (Number(old.size) !== Number(localFile.size) || Number(old.modified) !== Number(localFile.modified)) addChange(group, "updated");
    });

    group.refs.sort(function (a, b) {
      if (a.preference !== b.preference) return a.preference - b.preference;
      return a.relativePath.localeCompare(b.relativePath);
    });
    group.preferredRef = group.refs.length ? group.refs[0] : null;
    return group;
  }).filter(function (group) {
    return group.refs.length > 0 || group.missingRefs.length > 0;
  });
}

function editDistance(a, b) {
  var x = normalizeText(a);
  var y = normalizeText(b);
  var matrix = [];
  var i;
  var j;
  for (i = 0; i <= x.length; i += 1) matrix[i] = [i];
  for (j = 0; j <= y.length; j += 1) matrix[0][j] = j;
  for (i = 1; i <= x.length; i += 1) {
    for (j = 1; j <= y.length; j += 1) {
      var cost = x.charAt(i - 1) === y.charAt(j - 1) ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && x.charAt(i - 1) === y.charAt(j - 2) && x.charAt(i - 2) === y.charAt(j - 1)) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + cost);
      }
    }
  }
  return matrix[x.length][y.length];
}

function matchesColor(group, query) {
  var normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return true;
  var effectiveQuery = normalizedQuery;
  var names = [group.normalizedKey, group.displayName, group.colorCode, group.hexCode, group.instructions]
    .concat(group.aliases || [])
    .concat(group.refs.map(function (ref) {
    return [ref.baseName, ref.relativePath, ref.referenceKind, ref.referenceLabel, ref.referenceInstructions, ref.uploadNote].join(" ");
  }))
    .concat((group.missingRefs || []).map(function (ref) { return [ref.baseName, ref.referenceLabel, ref.referenceInstructions].join(" "); }));
  var haystack = normalizeText(names.join(" "));
  if (haystack.indexOf(effectiveQuery) !== -1 || haystack.indexOf(normalizedQuery) !== -1) return true;
  if (effectiveQuery.length < 4) return false;
  var candidates = [group.normalizedKey || group.id, group.displayName].concat(normalizeText(group.displayName).split(" "));
  return candidates.some(function (candidate) {
    var distance = editDistance(effectiveQuery, candidate);
    var threshold = effectiveQuery.length >= 9 ? 2 : 1;
    return distance <= threshold;
  });
}

function filterSwatches(colors, query, shade) {
  var selectedShade = String(shade || "").trim().toLowerCase();
  var needle = normalizeText(query).replace(/ /g, "");
  return (colors || []).filter(function (color) {
    if (selectedShade && String(color.shade || "").toLowerCase() !== selectedShade) return false;
    if (!needle) return true;
    var name = normalizeText(color.name).replace(/ /g, "");
    var hex = normalizeText(color.hexCode).replace(/ /g, "");
    return name.indexOf(needle) !== -1 || hex.indexOf(needle) !== -1;
  });
}

function createBaseline(files, reviewedAt) {
  var result = { reviewedAt: reviewedAt || Date.now(), files: {} };
  files.forEach(function (file) {
    result.files[file.pathKey] = {
      relativePath: file.relativePath,
      colorId: file.colorId,
      displayName: file.displayName || file.colorId,
      size: file.size,
      modified: file.modified
    };
  });
  return result;
}

module.exports = {
  normalizeText: normalizeText,
  buildManagedCatalog: buildManagedCatalog,
  remoteFileName: remoteFileName,
  cachedDownloadIsComplete: cachedDownloadIsComplete,
  referenceDisplayName: referenceDisplayName,
  matchesColor: matchesColor,
  filterSwatches: filterSwatches,
  createBaseline: createBaseline
};
