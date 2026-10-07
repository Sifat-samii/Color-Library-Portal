const { query, pool } = require("../server/db");
const { hashPassword } = require("../server/security");

async function main() {
  const email = String(process.env.ADMIN_EMAIL || "admin@local.test").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "ChangeThisAdminPassword!";
  const displayName = process.env.ADMIN_NAME || "Pixofix Administrator";
  const passwordHash = await hashPassword(password);
  await query(
    `INSERT INTO users(email,password_hash,display_name,role,client_id)
     VALUES($1,$2,$3,'ADMIN',NULL)
     ON CONFLICT(email) DO UPDATE SET password_hash=EXCLUDED.password_hash,display_name=EXCLUDED.display_name,active=true,updated_at=now()`,
    [email, passwordHash, displayName]
  );
  console.log(`Administrator ready: ${email}`);
}

main().catch(error => {
  console.error(error.message);
  if (error.code === "42501") {
    console.error('TUUO_ADMIN cannot write to the existing tables. Run database/000_repair_ownership.sql once as a PostgreSQL superuser, then retry.');
  }
  process.exitCode = 1;
}).finally(() => pool.end());
