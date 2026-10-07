const config = require("../server/config");
const db = require("../server/db");

const results = [];

function check(label, ok, detail) {
  results.push({ label, ok: Boolean(ok), detail });
}

async function main() {
  let configError = null;
  try { config.validateRuntimeConfig(); } catch (error) { configError = error; }

  check("Runtime configuration", !configError, configError?.message || "valid");
  check("Google OAuth values", config.google.enabled, config.google.enabled ? "all three values are present" : "set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI");
  check("Password fallback", !config.allowPasswordLogin || !config.production, config.allowPasswordLogin ? "enabled for development" : "disabled");
  check("Session lifetime", config.sessionDays >= 1 && config.sessionDays <= 30, `${config.sessionDays} day(s)`);
  if (config.allowPasswordLogin) {
    const adminPasswordLength = String(process.env.ADMIN_PASSWORD || "").length;
    const clientPasswordLength = String(process.env.CBI_CLIENT_PASSWORD || "").length;
    check("Administrator seed password", adminPasswordLength >= 7, "must contain at least 7 characters while password login is enabled");
    if (process.env.CBI_CLIENT_PASSWORD) {
      check("Client seed password", clientPasswordLength >= 7, "must contain at least 7 characters while password login is enabled");
    }
  }
  if (config.production) {
    check("Secure session cookie", config.cookieSecure, "COOKIE_SECURE must be true in production");
  }

  try {
    const schema = await db.query(
      `SELECT
         to_regclass('public.oauth_login_states') IS NOT NULL AS oauth_states,
         EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='google_subject') AS google_subject`
    );
    check("Authentication migration", schema.rows[0]?.oauth_states && schema.rows[0]?.google_subject, "run npm run db:migrate if missing");
    const users = await db.query(
      `SELECT count(*)::int AS authorized,
              count(*) FILTER (WHERE google_subject IS NOT NULL)::int AS connected
       FROM users u LEFT JOIN clients c ON c.id=u.client_id
       WHERE u.active=true AND (u.role='ADMIN' OR (u.role='CLIENT' AND c.active=true))`
    );
    check("Authorized users", users.rows[0].authorized > 0, `${users.rows[0].authorized} authorized, ${users.rows[0].connected} connected to Google`);
  } catch (error) {
    check("Database authentication schema", false, error.message);
  } finally {
    await db.pool.end();
  }

  for (const result of results) console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.label}: ${result.detail}`);
  const failures = results.filter(result => !result.ok).length;
  console.log(`\n${failures ? `${failures} authentication check(s) need attention.` : "Authentication setup is ready."}`);
  if (failures) process.exitCode = 1;
}

main().catch(error => {
  console.error("Authentication check failed:", error.message);
  process.exitCode = 1;
});
