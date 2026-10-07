const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { pool } = require("../server/db");
const { verifyPassword, revokeUserSessions } = require("../server/security");
const {
  normalizeProfileEmail,
  profileEmailError,
  canSignIn,
  existingPersonMessage,
  accessRequestBlock
} = require("../server/client-profile");

const root = path.resolve(__dirname, "..");

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

assert.strictEqual(normalizeProfileEmail("  Person@Example.com  "), "person@example.com");
assert.strictEqual(normalizeProfileEmail(null), "");
assert.strictEqual(profileEmailError("person@example.com"), "");
assert.ok(profileEmailError(""));
assert.ok(profileEmailError("person"));
assert.ok(profileEmailError("@example.com"));
assert.ok(profileEmailError("person@"));
assert.ok(profileEmailError("person@@example.com"));
assert.ok(profileEmailError("person @example.com"));

assert.strictEqual(canSignIn(false), false);
assert.strictEqual(canSignIn(true), true);
assert.strictEqual(existingPersonMessage({ role: "CLIENT", client_id: "c1", active: true }, "c1"), "This person is already on this library.");
assert.strictEqual(existingPersonMessage({ role: "CLIENT", client_id: "c1", active: false }, "c1"), "This person is already on this library. Activate them instead.");
assert.strictEqual(existingPersonMessage({ role: "CLIENT", client_id: "c2", active: true }, "c1"), "That email is already registered.");
assert.strictEqual(existingPersonMessage(null, "c1"), "That email is already registered.");
assert.strictEqual(accessRequestBlock({ onLibrary: true, pending: false }), "This person is already on your library.");
assert.strictEqual(accessRequestBlock({ onLibrary: false, pending: true }), "A request for this email is already pending.");
assert.strictEqual(accessRequestBlock({ onLibrary: false, pending: false }), "");

assert.match(read("server/index.js"), /!user\.password_hash/);
assert.match(read("server/client-profile.js"), /revokeUserSessions/);
assert.match(read("database/011_client_profile.sql"), /password_hash DROP NOT NULL/);
assert.match(read("database/011_client_profile.sql"), /user_access_requests_pending_email/);

async function main() {
  assert.strictEqual(await verifyPassword("password", null), false);
  assert.strictEqual(await verifyPassword("password", ""), false);

  const code = `PRF${crypto.randomBytes(4).toString("hex")}`;
  const email = `${code.toLowerCase()}@profile.test`;
  let clientId = null;
  try {
    clientId = (await pool.query(
      "INSERT INTO clients(code, name) VALUES($1, $2) RETURNING id",
      [code, "Profile test"]
    )).rows[0].id;
    const user = (await pool.query(
      "INSERT INTO users(email, password_hash, display_name, role, client_id) VALUES($1, NULL, $2, 'CLIENT', $3) RETURNING id, password_hash",
      [email, "No Password", clientId]
    )).rows[0];
    assert.strictEqual(user.password_hash, null);
    assert.strictEqual(canSignIn(true), true);
    await pool.query(
      "INSERT INTO sessions(token_hash, user_id, expires_at) VALUES($1, $2, now() + interval '1 day')",
      [crypto.randomBytes(16).toString("hex"), user.id]
    );
    await revokeUserSessions(user.id);
    assert.strictEqual((await pool.query("SELECT 1 FROM sessions WHERE user_id=$1", [user.id])).rowCount, 0);
    await pool.query(
      "INSERT INTO user_access_requests(client_id, email, display_name) VALUES($1, $2, $3)",
      [clientId, email, "No Password"]
    );
    await assert.rejects(
      pool.query(
        "INSERT INTO user_access_requests(client_id, email, display_name) VALUES($1, $2, $3)",
        [clientId, email.toUpperCase(), "Again"]
      ),
      error => error.code === "23505" && error.constraint === "user_access_requests_pending_email"
    );
  } finally {
    if (clientId) await pool.query("DELETE FROM clients WHERE id=$1", [clientId]);
  }
  console.log("Client profile tests passed.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => pool.end());
