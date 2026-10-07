const db = require("./db");
const { writeAudit } = require("./audit");
const { requireRole, revokeUserSessions } = require("./security");
const { recordActivity } = require("./activity");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return UUID.test(String(value || ""));
}

function normalizeProfileEmail(value) {
  return String(value == null ? "" : value).trim().toLowerCase();
}

function profileEmailError(email) {
  if (!email) return "Email is required";
  if (email.length > 320 || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email)) {
    return "Enter a valid email address";
  }
  return "";
}

function canSignIn(active) {
  return Boolean(active);
}

function existingPersonMessage(person, clientId) {
  if (!person) return "That email is already registered.";
  if (person.client_id === clientId && person.role === "CLIENT") {
    return person.active
      ? "This person is already on this library."
      : "This person is already on this library. Activate them instead.";
  }
  return "That email is already registered.";
}

function accessRequestBlock({ onLibrary, pending }) {
  if (onLibrary) return "This person is already on your library.";
  if (pending) return "A request for this email is already pending.";
  return "";
}

function presentPerson(row) {
  const person = {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    active: row.active,
    createdAt: row.created_at,
    authorized: Boolean(row.active),
    canSignIn: canSignIn(row.active),
    googleConnected: Boolean(row.google_subject),
    googleConnectedAt: row.google_connected_at || null,
    lastLoginAt: row.last_login_at || null
  };
  return person;
}

function presentRequest(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    note: row.note || "",
    requestedBy: row.requested_by_name || row.requested_by_email || "",
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at || null,
    resolvedBy: row.resolved_by_name || row.resolved_by_email || ""
  };
}

async function loadClient(id) {
  if (!isUuid(id)) return null;
  const result = await db.query("SELECT id, code, name FROM clients WHERE id=$1", [id]);
  return result.rows[0] || null;
}

async function loadPeople(clientId) {
  const result = await db.query(
    `SELECT id,email,display_name,active,created_at,google_subject,google_connected_at,last_login_at
     FROM users WHERE client_id=$1 AND role='CLIENT' ORDER BY display_name, email`,
    [clientId]
  );
  return result.rows;
}

async function loadRequests(clientId, pendingOnly = false) {
  const result = await db.query(
    `SELECT r.id,r.email,r.display_name,r.note,r.status,r.created_at,r.resolved_at,
            u.display_name AS requested_by_name,u.email AS requested_by_email,
            resolver.display_name AS resolved_by_name,resolver.email AS resolved_by_email
     FROM user_access_requests r
     LEFT JOIN users u ON u.id=r.requested_by
     LEFT JOIN users resolver ON resolver.id=r.resolved_by
     WHERE r.client_id=$1 AND ($2::boolean=false OR r.status='PENDING')
     ORDER BY CASE WHEN r.status='PENDING' THEN 0 ELSE 1 END,r.created_at DESC`,
    [clientId, pendingOnly]
  );
  return result.rows;
}

function registerClientProfile(app, { asyncRoute, cleanString }) {
  app.get("/api/admin/clients/:id/profile", requireRole("ADMIN"), asyncRoute(async (req, res) => {
    const client = await loadClient(req.params.id);
    if (!client) return res.status(404).json({ error: "Client not found" });
    const [people, requests] = await Promise.all([
      loadPeople(client.id),
      loadRequests(client.id)
    ]);
    res.json({
      client,
      users: people.map(presentPerson),
      requests: requests.map(presentRequest)
    });
  }));

  app.post("/api/admin/clients/:id/users", requireRole("ADMIN"), asyncRoute(async (req, res) => {
    const client = await loadClient(req.params.id);
    if (!client) return res.status(404).json({ error: "Client not found" });
    const email = normalizeProfileEmail(req.body.email);
    const displayName = cleanString(req.body.displayName, 120);
    const emailError = profileEmailError(email);
    if (emailError) return res.status(400).json({ error: emailError });
    if (!displayName) return res.status(400).json({ error: "Name is required" });
    const existing = (await db.query(
      "SELECT id, email, role, client_id, active FROM users WHERE lower(email)=lower($1)",
      [email]
    )).rows[0];
    if (existing) return res.status(409).json({ error: existingPersonMessage(existing, client.id) });
    try {
      const created = await db.transaction(async tx => {
        const person = (await tx.query(
          `INSERT INTO users(email, password_hash, display_name, role, client_id)
           VALUES($1, NULL, $2, 'CLIENT', $3)
           RETURNING id, email, display_name, active, created_at, password_hash, client_id, role`,
          [email, displayName, client.id]
        )).rows[0];
        await writeAudit(tx, req, {
          clientId: client.id,
          entityType: "user",
          entityId: person.id,
          action: "CREATE",
          after: { id: person.id, email: person.email, displayName: person.display_name, active: person.active }
        });
        await recordActivity(tx, {
          actor: req.user,
          clientId: client.id,
          eventType: "REPRESENTATIVE_ADDED",
          subjectType: "user",
          subjectId: person.id,
          targetUrl: `/profile?client=${client.id}`,
          metadata: { email: person.email, displayName: person.display_name }
        });
        return person;
      });
      res.status(201).json({ user: presentPerson(created) });
    } catch (error) {
      if (error.code !== "23505") throw error;
      const raced = (await db.query(
        "SELECT id, email, role, client_id, active FROM users WHERE lower(email)=lower($1)",
        [email]
      )).rows[0];
      res.status(409).json({ error: existingPersonMessage(raced, client.id) });
    }
  }));

  app.patch("/api/admin/users/:id", requireRole("ADMIN"), asyncRoute(async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: "Person not found" });
    const before = (await db.query(
      "SELECT * FROM users WHERE id=$1 AND role='CLIENT'",
      [req.params.id]
    )).rows[0];
    if (!before) return res.status(404).json({ error: "Person not found" });
    const email = normalizeProfileEmail(req.body.email == null ? before.email : req.body.email);
    const displayName = cleanString(req.body.displayName == null ? before.display_name : req.body.displayName, 120);
    const emailError = profileEmailError(email);
    if (emailError) return res.status(400).json({ error: emailError });
    if (!displayName) return res.status(400).json({ error: "Name is required" });
    const emailChanged = email !== String(before.email).toLowerCase();
    const updated = await db.transaction(async tx => {
      const conflict = (await tx.query("SELECT id FROM users WHERE lower(email)=lower($1) AND id<>$2", [email, before.id])).rows[0];
      if (conflict) {
        const error = new Error("That email is already registered.");
        error.status = 409;
        throw error;
      }
      const person = (await tx.query(
        `UPDATE users SET email=$1,display_name=$2,
             google_subject=CASE WHEN $3 THEN NULL ELSE google_subject END,
             google_connected_at=CASE WHEN $3 THEN NULL ELSE google_connected_at END,
             updated_at=now()
         WHERE id=$4 RETURNING *`,
        [email, displayName, emailChanged, before.id]
      )).rows[0];
      await writeAudit(tx, req, {
        clientId: person.client_id,
        entityType: "user",
        entityId: person.id,
        action: "UPDATE",
        before: { email: before.email, displayName: before.display_name },
        after: { email: person.email, displayName: person.display_name }
      });
      await recordActivity(tx, {
        actor: req.user,
        clientId: person.client_id,
        eventType: "REPRESENTATIVE_UPDATED",
        subjectType: "user",
        subjectId: person.id,
        targetUrl: `/profile?client=${person.client_id}`,
        metadata: { email: person.email, displayName: person.display_name }
      });
      return person;
    });
    if (emailChanged) await revokeUserSessions(updated.id);
    res.json({ user: presentPerson(updated) });
  }));

  app.post("/api/admin/users/:id/active", requireRole("ADMIN"), asyncRoute(async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: "Person not found" });
    if (typeof req.body.active !== "boolean") return res.status(400).json({ error: "Active must be true or false" });
    const before = (await db.query(
      "SELECT id, email, display_name, role, client_id, active FROM users WHERE id=$1 AND role='CLIENT'",
      [req.params.id]
    )).rows[0];
    if (!before) return res.status(404).json({ error: "Person not found" });
    const updated = await db.transaction(async tx => {
      const person = (await tx.query(
        "UPDATE users SET active=$1, updated_at=now() WHERE id=$2 AND role='CLIENT' RETURNING id, email, display_name, role, client_id, active",
        [req.body.active, before.id]
      )).rows[0];
      await writeAudit(tx, req, {
        clientId: person.client_id,
        entityType: "user",
        entityId: person.id,
        action: "UPDATE",
        before: { active: before.active },
        after: { active: person.active }
      });
      await recordActivity(tx, {
        actor: req.user,
        clientId: person.client_id,
        eventType: "REPRESENTATIVE_UPDATED",
        subjectType: "user",
        subjectId: person.id,
        targetUrl: `/profile?client=${person.client_id}`,
        metadata: { email: person.email, displayName: person.display_name, active: person.active }
      });
      return person;
    });
    if (!updated.active) await revokeUserSessions(updated.id);
    res.json({ user: { id: updated.id, email: updated.email, displayName: updated.display_name, active: updated.active } });
  }));

  app.post("/api/admin/clients/:id/access-requests/:requestId/resolve", requireRole("ADMIN"), asyncRoute(async (req, res) => {
    const client = await loadClient(req.params.id);
    if (!client || !isUuid(req.params.requestId)) return res.status(404).json({ error: "Request not found" });
    const status = req.body.status;
    if (status !== "AUTHORIZED" && status !== "DISMISSED") return res.status(400).json({ error: "Status must be AUTHORIZED or DISMISSED" });
    const resolved = await db.transaction(async tx => {
      const current = (await tx.query(
        "SELECT * FROM user_access_requests WHERE id=$1 AND client_id=$2 FOR UPDATE",
        [req.params.requestId, client.id]
      )).rows[0];
      if (!current) return { missing: true };
      if (current.status !== "PENDING") return { conflict: true };
      let person = null;
      if (status === "AUTHORIZED") {
        const existing = (await tx.query("SELECT * FROM users WHERE lower(email)=lower($1) FOR UPDATE", [current.email])).rows[0];
        if (existing && (existing.role !== "CLIENT" || existing.client_id !== client.id)) {
          const error = new Error("That email is already registered to another account.");
          error.status = 409;
          throw error;
        }
        person = existing
          ? (await tx.query(
              "UPDATE users SET active=true,display_name=$1,updated_at=now() WHERE id=$2 RETURNING *",
              [current.display_name, existing.id]
            )).rows[0]
          : (await tx.query(
              `INSERT INTO users(email,password_hash,display_name,role,client_id)
               VALUES($1,NULL,$2,'CLIENT',$3) RETURNING *`,
              [current.email, current.display_name, client.id]
            )).rows[0];
      }
      const request = (await tx.query(
        `UPDATE user_access_requests
         SET status=$1, resolved_by=$2, resolved_at=now(), updated_at=now()
         WHERE id=$3 AND client_id=$4 AND status='PENDING'
         RETURNING id, email, display_name, status`,
        [status, req.user.id, current.id, client.id]
      )).rows[0];
      if (!request) return { conflict: true };
      await writeAudit(tx, req, {
        clientId: client.id,
        entityType: "user_access_request",
        entityId: request.id,
        action: "RESOLVE",
        after: { status: request.status, email: request.email }
      });
      await recordActivity(tx, {
        actor: req.user,
        clientId: client.id,
        eventType: status === "AUTHORIZED" ? "ACCESS_AUTHORIZED" : "ACCESS_DISMISSED",
        subjectType: "user_access_request",
        subjectId: request.id,
        targetUrl: `/profile?client=${client.id}`,
        metadata: { email: request.email, displayName: request.display_name }
      });
      return { request, person };
    });
    if (resolved.missing) return res.status(404).json({ error: "Request not found" });
    if (resolved.conflict) return res.status(409).json({ error: "This request is no longer pending" });
    res.json({
      request: { id: resolved.request.id, email: resolved.request.email, displayName: resolved.request.display_name, status: resolved.request.status },
      user: resolved.person ? presentPerson(resolved.person) : null
    });
  }));

  app.get("/api/client/profile", requireRole("CLIENT"), asyncRoute(async (req, res) => {
    const client = await loadClient(req.user.client_id);
    if (!client) return res.status(404).json({ error: "Client not found" });
    const [people, requests] = await Promise.all([loadPeople(client.id), loadRequests(client.id)]);
    res.json({ client, users: people.map(presentPerson), requests: requests.map(presentRequest) });
  }));

  app.post("/api/client/profile/access-requests", requireRole("CLIENT"), asyncRoute(async (req, res) => {
    const client = await loadClient(req.user.client_id);
    if (!client) return res.status(404).json({ error: "Client not found" });
    const email = normalizeProfileEmail(req.body.email);
    const displayName = cleanString(req.body.displayName, 120);
    const note = cleanString(req.body.note, 500);
    const emailError = profileEmailError(email);
    if (emailError) return res.status(400).json({ error: emailError });
    if (!displayName) return res.status(400).json({ error: "Name is required" });
    const onLibrary = (await db.query(
      "SELECT 1 FROM users WHERE client_id=$1 AND role='CLIENT' AND lower(email)=lower($2)",
      [client.id, email]
    )).rowCount > 0;
    const pending = (await db.query(
      "SELECT 1 FROM user_access_requests WHERE client_id=$1 AND lower(email)=lower($2) AND status='PENDING'",
      [client.id, email]
    )).rowCount > 0;
    const block = accessRequestBlock({ onLibrary, pending });
    if (block) return res.status(409).json({ error: block });
    try {
      await db.transaction(async tx => {
        const request = (await tx.query(
          `INSERT INTO user_access_requests(client_id, email, display_name, note, requested_by)
           VALUES($1,$2,$3,$4,$5)
           RETURNING id, email, display_name, note, status`,
          [client.id, email, displayName, note, req.user.id]
        )).rows[0];
        await writeAudit(tx, req, {
          clientId: client.id,
          entityType: "user_access_request",
          entityId: request.id,
          action: "CREATE",
          after: { email: request.email, displayName: request.display_name, status: request.status }
        });
        await recordActivity(tx, {
          actor: req.user,
          clientId: client.id,
          eventType: "ACCESS_REQUESTED",
          subjectType: "user_access_request",
          subjectId: request.id,
          targetUrl: `/profile?client=${client.id}`,
          metadata: { email: request.email, displayName: request.display_name }
        });
      });
      res.status(201).json({ ok: true });
    } catch (error) {
      if (error.code !== "23505") throw error;
      res.status(409).json({ error: "A request for this email is already pending." });
    }
  }));
}

module.exports = {
  registerClientProfile,
  normalizeProfileEmail,
  profileEmailError,
  canSignIn,
  existingPersonMessage,
  accessRequestBlock
};
