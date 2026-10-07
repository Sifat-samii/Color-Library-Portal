const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const db = require("../server/db");
const config = require("../server/config");
const { swatchPng } = require("../server/adobe-rgb-swatch");

const baseUrl = process.env.WORKFLOW_BASE_URL || "http://127.0.0.1:8788";
const suffix = crypto.randomBytes(5).toString("hex");
const clientCode = `INT${suffix.toUpperCase()}`;
const productionRoot = path.resolve(config.storageRoot, `integration-${suffix}-production`);
const assetRoot = path.resolve(config.storageRoot, "assets", clientCode);
let clientId = null;
let temporaryAdminId = null;
let testHex = "";

function invariant(value, message) {
  if (!value) throw new Error(message);
}

async function request(url, cookie, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, {
    ...options,
    headers: { ...(cookie ? { Cookie: `acl_session=${cookie}` } : {}), ...(options.headers || {}) }
  });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.arrayBuffer();
  if (!response.ok) throw new Error(`${options.method || "GET"} ${url}: ${body.error || response.status}`);
  return body;
}

async function sessionFor(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  await db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [hash, userId]);
  return token;
}

async function uniqueHex() {
  for (;;) {
    const candidate = `#${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const used = await db.query("SELECT 1 FROM colors WHERE hex_code=$1 UNION ALL SELECT 1 FROM pixofix_colors WHERE hex_code=$1 LIMIT 1", [candidate]);
    if (!used.rowCount) return candidate;
  }
}

async function cleanupClient(record) {
  const hexes = (await db.query(
    "SELECT hex_code FROM color_requests WHERE client_id=$1 AND hex_code<>'' UNION SELECT hex_code FROM colors WHERE client_id=$1 AND hex_code<>''",
    [record.id]
  )).rows.map(row => row.hex_code);
  await db.query(
    `DELETE FROM reference_versions v USING color_references r,colors c
     WHERE v.reference_id=r.id AND r.color_id=c.id AND c.client_id=$1`,
    [record.id]
  );
  await db.query("DELETE FROM color_requests WHERE client_id=$1", [record.id]);
  await db.query("DELETE FROM clients WHERE id=$1", [record.id]);
  if (hexes.length) await db.query("DELETE FROM pixofix_colors WHERE hex_code=ANY($1::text[])", [hexes]);
  const storage = path.resolve(config.storageRoot);
  const paths = [path.resolve(config.storageRoot, "assets", record.code)];
  if (record.local_folder_path) paths.push(path.resolve(record.local_folder_path));
  for (const target of paths) {
    if (target.startsWith(`${storage}${path.sep}`)) await fs.rm(target, { recursive: true, force: true });
  }
}

async function cleanupStaleRuns() {
  const stale = (await db.query(
    "SELECT id,code,local_folder_path FROM clients WHERE name='Integration Client' AND code LIKE 'INT%'"
  )).rows;
  for (const record of stale) await cleanupClient(record);
}

async function main() {
  await cleanupStaleRuns();
  await fs.mkdir(productionRoot, { recursive: true });
  testHex = await uniqueHex();
  let admin = (await db.query("SELECT * FROM users WHERE role='ADMIN' AND active=true ORDER BY created_at LIMIT 1")).rows[0];
  if (!admin) {
    admin = (await db.query(
      "INSERT INTO users(email,password_hash,display_name,role) VALUES($1,NULL,'Integration Admin','ADMIN') RETURNING *",
      [`integration-admin-${suffix}@example.test`]
    )).rows[0];
    temporaryAdminId = admin.id;
  }
  const client = (await db.query(
    "INSERT INTO clients(code,name,local_folder_path) VALUES($1,$2,$3) RETURNING *",
    [clientCode, "Integration Client", productionRoot]
  )).rows[0];
  clientId = client.id;
  const ema = (await db.query(
    "INSERT INTO users(email,password_hash,display_name,role,client_id) VALUES($1,NULL,'Ema','CLIENT',$2) RETURNING *",
    [`ema-${suffix}@example.test`, clientId]
  )).rows[0];
  const jones = (await db.query(
    "INSERT INTO users(email,password_hash,display_name,role,client_id) VALUES($1,NULL,'Jones','CLIENT',$2) RETURNING *",
    [`jones-${suffix}@example.test`, clientId]
  )).rows[0];
  const alice = (await db.query(
    "INSERT INTO users(email,password_hash,display_name,role,client_id) VALUES($1,NULL,'Alice','CLIENT',$2) RETURNING *",
    [`alice-${suffix}@example.test`, clientId]
  )).rows[0];
  const [adminCookie, emaCookie, jonesCookie, aliceCookie] = await Promise.all([
    sessionFor(admin.id), sessionFor(ema.id), sessionFor(jones.id), sessionFor(alice.id)
  ]);

  await request("/api/client/profile/access-requests", emaCookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: "Karim", email: `karim-${suffix}@example.test`, note: "Color reviewer" })
  });
  const profile = await request(`/api/admin/clients/${clientId}/profile`, adminCookie);
  invariant(profile.requests.length === 1, "Access request was not visible to the admin");
  const resolved = await request(`/api/admin/clients/${clientId}/access-requests/${profile.requests[0].id}/resolve`, adminCookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "AUTHORIZED" })
  });
  invariant(resolved.user?.active, "Authorizing an access request did not create an active representative");
  invariant((await db.query("SELECT 1 FROM users WHERE client_id=$1 AND lower(email)=lower($2) AND active=true", [clientId, `karim-${suffix}@example.test`])).rowCount === 1, "Authorized representative was not persisted");
  const reviewedProfile = await request(`/api/admin/clients/${clientId}/profile`, adminCookie);
  invariant(reviewedProfile.requests.some(item => item.id === profile.requests[0].id && item.status === "AUTHORIZED"), "Reviewed access request history was not retained");
  const karimCookie = await sessionFor(resolved.user.id);

  const created = await request("/api/color-requests", emaCookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceType: "GENERATED", name: `Integration ${suffix}`, hexCode: testHex, pantone: "", note: "End-to-end workflow verification" })
  });
  const requestId = created.request.id;
  invariant(created.request.requestedBy === "Ema", "Request creator was not presented");
  invariant(created.request.sourceType === "GENERATED", "Generated source type was not retained");
  const swatch = await request(`/api/color-requests/${requestId}/swatch`, emaCookie);
  invariant(swatch.byteLength > 100, "Generated swatch was not served");

  const adminInbox = await request("/api/notifications", adminCookie);
  const jonesInbox = await request("/api/notifications", jonesCookie);
  invariant(adminInbox.notifications.some(item => item.kind === "REQUEST_CREATED"), "Admin did not receive request notification");
  invariant(jonesInbox.notifications.some(item => item.kind === "REQUEST_CREATED"), "Client colleague did not receive request notification");

  const firstDelivery = new FormData();
  firstDelivery.set("kind", "FULL");
  firstDelivery.set("uploadNote", "First reference");
  firstDelivery.set("file", new Blob([await swatchPng(testHex)], { type: "image/png" }), "reference-v1.png");
  let current = await request(`/api/color-requests/${requestId}/deliveries`, adminCookie, { method: "POST", body: firstDelivery });
  invariant(current.request.deliveries[0].uploadedBy === admin.display_name, "Delivery uploader was not presented");

  current = await request(`/api/color-requests/${requestId}/changes`, jonesCookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ comment: "Please warm the reference slightly." })
  });
  invariant(current.request.status === "CHANGES_REQUESTED", "Request did not move to changes requested");
  invariant(current.request.deliveries[0].status === "NEEDS_CHANGES", "Delivery did not retain the needs-changes state");
  invariant(current.request.activity.some(item => item.type === "CHANGES_REQUESTED" && item.actor.name === "Jones"), "Change requester was not recorded");

  const secondDelivery = new FormData();
  secondDelivery.set("kind", "FULL");
  secondDelivery.set("uploadNote", "Warmer reference");
  secondDelivery.set("file", new Blob([await swatchPng(testHex)], { type: "image/png" }), "reference-v2.png");
  current = await request(`/api/color-requests/${requestId}/deliveries`, adminCookie, { method: "POST", body: secondDelivery });
  invariant(current.request.status === "IN_PROGRESS", "Revised reference did not return to review");

  current = await request(`/api/color-requests/${requestId}/approve`, karimCookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  invariant(current.request.status === "APPROVED", "Request was not approved");
  invariant(current.request.activity.some(item => item.type === "REQUEST_APPROVED" && item.actor.name === "Karim"), "Approver was not recorded");
  invariant((await db.query("SELECT 1 FROM pixofix_colors WHERE hex_code=$1", [testHex])).rowCount === 1, "Approved color was not added to Explore swatches");

  await request(`/api/color-requests/${requestId}/comments`, aliceCookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body: "Approved result noted for the team." })
  });
  current = await request(`/api/color-requests/${requestId}`, aliceCookie);
  invariant(current.request.comments.some(item => item.authorName === "Alice" && item.body.includes("noted")), "Post-approval comment was not retained");
  invariant(current.request.activity.some(item => item.type === "COMMENT_ADDED" && item.actor.name === "Alice"), "Post-approval commenter was not recorded");

  await request(`/api/admin/clients/${clientId}`, adminCookie, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active: false })
  });
  const disabledResponse = await fetch(`${baseUrl}/api/client/profile`, { headers: { Cookie: `acl_session=${emaCookie}` } });
  invariant(disabledResponse.status === 401, "Disabling a Client Company did not invalidate its active sessions");
  const remainingClientSessions = await db.query(
    "SELECT count(*)::int AS count FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.client_id=$1",
    [clientId]
  );
  invariant(Number(remainingClientSessions.rows[0].count) === 0, "Disabled Client Company retained server sessions");

  console.log("Workflow integration verification passed: Ema request, Jones changes, Karim approval, Alice post-approval comment, notifications, publication, Gmail authorization, history, and company session revocation.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  try {
    if (clientId) await cleanupClient({ id: clientId, code: clientCode, local_folder_path: productionRoot });
    if (temporaryAdminId) await db.query("DELETE FROM users WHERE id=$1", [temporaryAdminId]);
  } finally {
    await db.pool.end();
  }
});
