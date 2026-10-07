const { Client } = require("pg");
const { databaseName, connectionConfig } = require("../server/database-config");
const { cssColorEntries } = require("../server/css-color-names");

async function seedPixofixColors(client) {
  for (const color of cssColorEntries()) {
    await client.query(
      "INSERT INTO pixofix_colors(hex_code, name) VALUES($1, $2) ON CONFLICT (hex_code) DO NOTHING",
      [color.hexCode, color.name]
    );
  }
  const count = await client.query("SELECT count(*)::int AS count FROM pixofix_colors");
  return count.rows[0].count;
}

async function main() {
  const client = new Client(connectionConfig(databaseName()));
  await client.connect();
  try {
    const count = await seedPixofixColors(client);
    console.log(`Explore swatches: ${count}`);
  } finally {
    await client.end();
  }
}

module.exports = { seedPixofixColors };

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
