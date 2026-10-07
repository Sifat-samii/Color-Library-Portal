const { Pool } = require("pg");
const config = require("./config");

const pool = new Pool({ ...config.database, max: 10 });

pool.on("error", error => {
  console.error("PostgreSQL connection error:", error.message);
});

async function query(text, params) {
  return pool.query(text, params);
}

async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await callback(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, transaction };
