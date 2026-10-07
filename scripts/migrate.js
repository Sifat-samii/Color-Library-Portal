const fs = require("fs/promises");
const path = require("path");
const { Client } = require("pg");
const { databaseName, connectionConfig } = require("../server/database-config");
const { seedPixofixColors } = require("./seed-pixofix-colors");

async function ensureDatabase(name) {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error("The configured database name is invalid");
  const client = new Client(connectionConfig("postgres"));
  await client.connect();
  try {
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname=$1", [name]);
    if (!exists.rowCount) await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
}

async function main() {
  const name = databaseName();
  let client = new Client(connectionConfig(name));
  try {
    await client.connect();
  } catch (error) {
    if (error.code !== "3D000") throw error;
    await ensureDatabase(name);
    client = new Client(connectionConfig(name));
    await client.connect();
  }
  try {
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const databaseRoot = path.join(__dirname, "..", "database");
    const files = (await fs.readdir(databaseRoot)).filter(file => /^\d{3}_.+\.sql$/.test(file) && !file.startsWith("000_")).sort();
    const applied = [];
    for (const file of files) {
      const version = path.basename(file, ".sql");
      const exists = await client.query("SELECT 1 FROM schema_migrations WHERE version=$1", [version]);
      if (exists.rowCount) continue;
      const migration = await fs.readFile(path.join(databaseRoot, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(migration);
        await client.query("INSERT INTO schema_migrations(version) VALUES($1)", [version]);
        await client.query("COMMIT");
        applied.push(version);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    const pixofixCount = await seedPixofixColors(client);
    console.log(`Database ready: ${name} (${applied.length ? `applied ${applied.join(", ")}` : "up to date"})`);
    console.log(`Explore swatches: ${pixofixCount}`);
  } catch (error) {
    throw error;
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error(error.message);
  if (error.code === "42501") {
    console.error('TUUO_ADMIN does not own the existing database objects. Run database/000_repair_ownership.sql once as a PostgreSQL superuser, then retry.');
  }
  process.exit(1);
});
