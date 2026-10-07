const fs = require("fs/promises");
const path = require("path");
const { query } = require("./db");
const config = require("./config");

function safeSegment(value) {
  return String(value || "REFERENCE").replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").replace(/[. ]+$/g, "").trim() || "REFERENCE";
}

function referenceTypeFolderName(kind, label) {
  const raw = String(label || kind || "").replace(/(?:\s+reference)+$/i, "").trim();
  const base = raw.toUpperCase() === "QUICK" ? "CROP" : raw.toUpperCase();
  return safeSegment(`${base || "REFERENCE"} Reference`);
}

function approvedLocalRelativePath(version) {
  const extension = path.extname(version.original_filename || "").toLowerCase() || ".jpg";
  const filename = `${safeSegment(version.color_name)}${extension}`;
  return path.join(referenceTypeFolderName(version.kind, version.label), filename);
}

async function ensureReferenceTypeFolder(clientRoot, folderName) {
  const root = path.resolve(clientRoot);
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("The local folder does not exist on this server");
    throw error;
  }
  const wanted = folderName.toLowerCase();
  const existing = entries.find(entry => entry.isDirectory() && entry.name.toLowerCase() === wanted);
  if (existing) {
    const folder = path.resolve(root, existing.name);
    ensureInside(root, folder);
    return existing.name;
  }
  if (entries.some(entry => !entry.isDirectory() && entry.name.toLowerCase() === wanted)) {
    throw new Error("A file already uses the reference type folder name");
  }
  const folder = path.resolve(root, folderName);
  ensureInside(root, folder);
  try {
    await fs.mkdir(folder);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  return folderName;
}

function ensureInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Resolved path escapes its managed root");
}

function isTransientFileError(error) {
  return ["EPERM", "EBUSY", "EACCES", "UNKNOWN"].includes(error && error.code);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function replaceApprovedFile(source, destination, clientRoot) {
  const temporary = destination + ".syncing";
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await fs.rm(temporary, { force: true });
      await fs.copyFile(source, temporary);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      await fs.rm(temporary, { force: true }).catch(() => {});
      if (!isTransientFileError(error) || attempt === 3) throw error;
      await delay(120 * (attempt + 1));
    }
  }
  if (lastError) throw lastError;
  await archiveExisting(destination, clientRoot);
  try {
    await fs.rename(temporary, destination);
  } catch (error) {
    if (!isTransientFileError(error)) throw error;
    await delay(200);
    await fs.rename(temporary, destination);
  }
}

async function archiveExisting(destination, clientRoot) {
  try {
    await fs.access(destination);
  } catch (_error) { return; }
  const archiveRoot = path.join(clientRoot, ".archive");
  await fs.mkdir(archiveRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archived = path.join(archiveRoot, stamp + "-" + path.basename(destination));
  ensureInside(clientRoot, archived);
  await fs.rename(destination, archived);
}

async function syncApprovedVersion(versionId) {
  const result = await query(
    `SELECT v.*, r.kind, r.label, c.name AS color_name, c.client_id,
            cl.code AS client_code, cl.local_folder_path
     FROM reference_versions v
     JOIN color_references r ON r.id=v.reference_id
     JOIN colors c ON c.id=r.color_id
     JOIN clients cl ON cl.id=c.client_id
     WHERE v.id=$1`,
    [versionId]
  );
  const version = result.rows[0];
  if (!version) throw new Error("Reference version not found");
  if (version.status !== "APPROVED") throw new Error("Only approved versions can be synchronized");
  if (!version.local_folder_path) throw new Error("Client local folder is not configured");

  const clientRoot = path.resolve(version.local_folder_path);
  const source = path.resolve(config.storageRoot, version.storage_path);
  ensureInside(config.storageRoot, source);
  const planned = approvedLocalRelativePath(version);
  const folderName = await ensureReferenceTypeFolder(clientRoot, path.dirname(planned));
  const relativePath = path.join(folderName, path.basename(planned));
  const destination = path.resolve(clientRoot, relativePath);
  ensureInside(clientRoot, destination);

  const job = await query(
    "INSERT INTO sync_jobs(client_id,reference_version_id,status,destination_path) VALUES($1,$2,'RUNNING',$3) RETURNING id",
    [version.client_id, versionId, destination]
  );
  try {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await replaceApprovedFile(source, destination, clientRoot);
    await query("UPDATE reference_versions SET local_relative_path=$1,synced_at=now() WHERE id=$2", [relativePath.replace(/\\/g, "/"), versionId]);
    await query("UPDATE sync_jobs SET status='COMPLETE',completed_at=now() WHERE id=$1", [job.rows[0].id]);
    await query("DELETE FROM sync_jobs WHERE reference_version_id=$1 AND status='FAILED'", [versionId]);
    return { destination, relativePath: relativePath.replace(/\\/g, "/") };
  } catch (error) {
    await query("UPDATE sync_jobs SET status='FAILED',error_message=$1,completed_at=now() WHERE id=$2", [error.message, job.rows[0].id]);
    throw error;
  }
}

async function removeSyncedVersion(versionId) {
  const result = await query(
    `SELECT v.local_relative_path, cl.local_folder_path
     FROM reference_versions v
     JOIN color_references r ON r.id=v.reference_id
     JOIN colors c ON c.id=r.color_id
     JOIN clients cl ON cl.id=c.client_id
     WHERE v.id=$1`,
    [versionId]
  );
  const version = result.rows[0];
  if (!version || !version.local_relative_path || !version.local_folder_path) return { archived: false };
  const clientRoot = path.resolve(version.local_folder_path);
  const destination = path.resolve(clientRoot, version.local_relative_path);
  ensureInside(clientRoot, destination);
  await archiveExisting(destination, clientRoot);
  await query("UPDATE reference_versions SET local_relative_path=NULL,synced_at=NULL WHERE id=$1", [versionId]);
  return { archived: true };
}

module.exports = {
  safeSegment,
  ensureInside,
  referenceTypeFolderName,
  approvedLocalRelativePath,
  ensureReferenceTypeFolder,
  isTransientFileError,
  replaceApprovedFile,
  syncApprovedVersion,
  removeSyncedVersion
};
