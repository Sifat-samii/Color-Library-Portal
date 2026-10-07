const fs = require("fs/promises");
const fsNative = require("fs");
const path = require("path");
const crypto = require("crypto");
const { query, transaction, pool } = require("../server/db");
const { hashPassword } = require("../server/security");
const config = require("../server/config");

const supported = new Set([".jpg", ".jpeg", ".png", ".tif", ".tiff", ".psd", ".psb"]);
function normalize(value) { return String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[_-]+/g, " ").replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim(); }
function colorName(filename) {
  let stem = path.basename(filename, path.extname(filename)).replace(/^CK605_CK002__CIEL_F_1178_/i, "").replace(/[ _-]+FULL$/i, "").trim();
  let key = normalize(stem);
  if (key === "WHITE1") key = "WHITE";
  if (key === "TEAL") key = "TEAL BLUE";
  return key;
}
async function walk(root, folder = root, files = []) {
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const fullPath = path.join(folder, entry.name);
    if (entry.isDirectory()) await walk(root, fullPath, files);
    else if (supported.has(path.extname(entry.name).toLowerCase())) files.push({ fullPath, relativePath: path.relative(root, fullPath), name: entry.name });
  }
  return files;
}
function checksum(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fsNative.createReadStream(filePath).on("data", chunk => hash.update(chunk)).on("end", () => resolve(hash.digest("hex"))).on("error", reject);
  });
}
function mime(file) {
  return ({ ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".tif": "image/tiff", ".tiff": "image/tiff", ".psd": "image/vnd.adobe.photoshop" })[path.extname(file).toLowerCase()] || "application/octet-stream";
}

async function main() {
  const sourceRoot = path.resolve(process.env.CBI_IMPORT_FOLDER || "F:\\CBI\\Approve");
  const files = await walk(sourceRoot);
  if (!files.length) throw new Error(`No supported references found in ${sourceRoot}`);
  const admin = (await query("SELECT id FROM users WHERE role='ADMIN' ORDER BY created_at LIMIT 1")).rows[0];
  if (!admin) throw new Error("Run npm run db:seed-admin before importing CBI");
  const clientPasswordHash = await hashPassword(process.env.CBI_CLIENT_PASSWORD || "ChangeThisClientPassword!");
  const client = await transaction(async db => {
    const row = (await db.query(
      `INSERT INTO clients(code,name,local_folder_path) VALUES('CBI','CBI',$1)
       ON CONFLICT(code) DO UPDATE SET name='CBI',local_folder_path=EXCLUDED.local_folder_path,active=true,updated_at=now() RETURNING *`, [sourceRoot]
    )).rows[0];
    await db.query(
      `INSERT INTO users(email,password_hash,display_name,role,client_id) VALUES($1,$2,'CBI Client','CLIENT',$3)
       ON CONFLICT(email) DO UPDATE SET password_hash=EXCLUDED.password_hash,client_id=EXCLUDED.client_id,active=true,updated_at=now()`,
      [String(process.env.CBI_CLIENT_EMAIL || "cbi@local.test").toLowerCase(), clientPasswordHash, row.id]
    );
    return row;
  });
  let imported = 0;
  for (const file of files) {
    const name = colorName(file.name);
    const kind = file.relativePath.split(path.sep).some(part => part.toUpperCase() === "FULL") || /[ _-]+FULL\.[^.]+$/i.test(file.name) ? "FULL" : "QUICK";
    const stat = await fs.stat(file.fullPath);
    const sha = await checksum(file.fullPath);
    await transaction(async db => {
      const color = (await db.query(
        `INSERT INTO colors(client_id,name,normalized_key,created_by) VALUES($1,$2,$2,$3)
         ON CONFLICT(client_id,normalized_key) DO UPDATE SET name=EXCLUDED.name,updated_at=now() RETURNING *`, [client.id, name, admin.id]
      )).rows[0];
      const reference = (await db.query(
        `INSERT INTO color_references(color_id,kind,label) VALUES($1,$2,'')
         ON CONFLICT(color_id,kind,label) DO UPDATE SET updated_at=now() RETURNING *`, [color.id, kind]
      )).rows[0];
      const existing = (await db.query("SELECT * FROM reference_versions WHERE reference_id=$1 AND checksum_sha256=$2 LIMIT 1", [reference.id, sha])).rows[0];
      let version = existing;
      if (!version) {
        const next = Number((await db.query("SELECT coalesce(max(version_number),0)+1 AS n FROM reference_versions WHERE reference_id=$1", [reference.id])).rows[0].n);
        const id = crypto.randomUUID();
        const relativeStorage = path.join("assets", "CBI", color.id, reference.id, `v${next}-${id}${path.extname(file.name).toLowerCase()}`);
        const destination = path.join(config.storageRoot, relativeStorage);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(file.fullPath, destination);
        version = (await db.query(
          `INSERT INTO reference_versions(id,reference_id,version_number,status,original_filename,storage_path,local_relative_path,mime_type,size_bytes,checksum_sha256,uploaded_by,approved_by,approved_at,synced_at)
           VALUES($1,$2,$3,'APPROVED',$4,$5,$6,$7,$8,$9,$10,$10,now(),now()) RETURNING *`,
          [id, reference.id, next, file.name, relativeStorage.replace(/\\/g, "/"), file.relativePath.replace(/\\/g, "/"), mime(file.name), stat.size, sha, admin.id]
        )).rows[0];
      } else {
        await db.query("UPDATE reference_versions SET status='APPROVED',local_relative_path=$1,approved_by=$2,approved_at=coalesce(approved_at,now()),synced_at=now(),removed_at=NULL WHERE id=$3", [file.relativePath.replace(/\\/g, "/"), admin.id, version.id]);
      }
      await db.query("UPDATE reference_versions SET status='UNAPPROVED' WHERE reference_id=$1 AND id<>$2 AND status='APPROVED'", [reference.id, version.id]);
      await db.query("UPDATE color_references SET active_approved_version_id=$1,updated_at=now() WHERE id=$2", [version.id, reference.id]);
    });
    imported += 1;
  }
  const count = (await query("SELECT count(*)::int AS n FROM colors WHERE client_id=$1 AND archived_at IS NULL", [client.id])).rows[0].n;
  console.log(`Imported ${imported} CBI references across ${count} colors.`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
