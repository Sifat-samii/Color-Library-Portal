const assert = require("assert");
const { presentAuditEvent } = require("../server/audit-history");

const clientId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const colorId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";

const approved = presentAuditEvent({
  id: 1,
  created_at: "2026-09-29T03:31:34.000Z",
  action: "APPROVE",
  entity_type: "color_request",
  entity_id: requestId,
  client_id: clientId,
  client_code: "TTE",
  client_name: "TTE Studio",
  actor_email: "sifatmahmud@pixofix.com",
  actor_name: "Sifat",
  actor_role: "CLIENT",
  request_subject: "Navy"
});
assert.equal(approved.party, "client");
assert.equal(approved.title, "Approved a color request");
assert.equal(approved.subject, "Navy");
assert.equal(approved.href, `/requests/${requestId}?client=${clientId}#activity`);
assert.equal(approved.destination, "Open request");
assert.equal(approved.recordGroup, "requests");

const uploaded = presentAuditEvent({
  id: 2,
  created_at: "2026-09-28T14:41:10.000Z",
  action: "UPLOAD",
  entity_type: "color_request",
  entity_id: requestId,
  client_id: clientId,
  actor_email: "admin@local.test",
  actor_role: "ADMIN",
  request_subject: "Navy"
});
assert.equal(uploaded.party, "admin");
assert.equal(uploaded.title, "Uploaded a reference");

const archived = presentAuditEvent({
  id: 3,
  created_at: "2026-09-25T06:10:22.000Z",
  action: "ARCHIVE",
  entity_type: "color",
  entity_id: colorId,
  client_id: clientId,
  client_code: "CBI",
  color_name: "Solar Red",
  color_archived_at: "2026-09-25T06:10:22.000Z"
});
assert.equal(archived.href, `/archived?client=${clientId}`);
assert.equal(archived.destination, "Open archived colors");
assert.equal(archived.subject, "Solar Red");

const reference = presentAuditEvent({
  id: 4,
  created_at: "2026-09-25T06:10:22.000Z",
  action: "APPROVE",
  entity_type: "reference_version",
  entity_id: "55555555-5555-4555-8555-555555555555",
  client_id: clientId,
  version_color_id: colorId,
  version_color_name: "Solar Red",
  actor_role: "ADMIN"
});
assert.equal(reference.href, `/colors/${colorId}?client=${clientId}#references`);
assert.equal(reference.recordGroup, "colors");

const signIn = presentAuditEvent({
  id: 5,
  created_at: "2026-09-25T09:00:11.000Z",
  action: "GOOGLE_LOGIN",
  entity_type: "session",
  entity_id: userId,
  client_id: clientId,
  client_code: "TTE",
  actor_role: "CLIENT",
  subject_user_name: "Sifat"
});
assert.equal(signIn.href, `/profile?client=${clientId}#person-${userId}`);
assert.equal(signIn.title, "Signed in with Google");
assert.equal(signIn.recordGroup, "access");

const adminSignIn = presentAuditEvent({
  id: 6,
  created_at: "2026-09-25T06:10:22.000Z",
  action: "LOGIN",
  entity_type: "session",
  entity_id: userId,
  actor_role: "ADMIN",
  subject_user_name: "Admin"
});
assert.equal(adminSignIn.party, "admin");
assert.equal(adminSignIn.href, "/clients");

const system = presentAuditEvent({
  id: 7,
  created_at: "2026-09-25T06:10:22.000Z",
  action: "UPDATE",
  entity_type: "client",
  entity_id: clientId,
  client_code: "CBI",
  client_name: "CBI"
});
assert.equal(system.party, "system");
assert.equal(system.href, `/profile?client=${clientId}`);
assert.equal(system.recordGroup, "libraries");

const swatch = presentAuditEvent({
  id: 8,
  created_at: "2026-09-25T06:10:22.000Z",
  action: "DELETE",
  entity_type: "pixofix_color",
  entity_id: colorId,
  before_data: { name: "Clay" }
});
assert.equal(swatch.href, "/pixofix");
assert.equal(swatch.subject, "Clay");

console.log("Audit history presentation tests passed.");
