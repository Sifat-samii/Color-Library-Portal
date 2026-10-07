const path = require("path");
const config = require("../server/config");
const db = require("../server/db");
const { ensureInside } = require("../server/sync");
const { cachedPreview } = require("../server/previews");

async function main() {
  const result = await db.query(
    "SELECT id,storage_path FROM reference_versions WHERE status<>'REMOVED' ORDER BY created_at DESC"
  );
  let completed = 0;
  let unsupported = 0;
  await Promise.all(result.rows.map(async version => {
    const assetPath = path.resolve(config.storageRoot, version.storage_path);
    ensureInside(config.storageRoot, assetPath);
    try {
      await cachedPreview(config.storageRoot, assetPath, version.id);
      completed += 1;
    } catch (_error) {
      unsupported += 1;
    }
  }));
  console.log(`Preview cache ready: ${completed} generated or verified, ${unsupported} unsupported.`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => db.pool.end());
