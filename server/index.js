const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const fs = require("fs/promises");
const fsNative = require("fs");
const path = require("path");
const config = require("./config");
const { portalUrls, listenOptions, ensureLanFirewall } = require("./studio-network");
const db = require("./db");
const {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  revokeClientSessions,
  authenticate,
  requireRole
} = require("./security");
const { writeAudit } = require("./audit");
const { presentAuditEvent } = require("./audit-history");
const { syncApprovedVersion, removeSyncedVersion, ensureInside } = require("./sync");
const { cachedPreview, displayImage } = require("./previews");
const { registerColorRequests } = require("./color-requests");
const { libraryEditBlock } = require("./library-lock");
const { normalizeHex } = require("./hex-code");
const { registerPixofixLibrary } = require("./pixofix-library");
const { registerClientProfile } = require("./client-profile");
const { registerNotifications } = require("./notifications");
const { registerGoogleAuth } = require("./google-auth");
const { securityHeaders, pluginCors, protectUnsafeRequests, createRateLimiter } = require("./http-security");

const app = express();
if (config.trustProxy) app.set("trust proxy", 1);
const catalogCache = new Map();
const CATALOG_CACHE_TTL_MS = 15000;
const RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const incomingRoot = path.join(config.storageRoot, "incoming");
fsNative.mkdirSync(incomingRoot, { recursive: true });
const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".tif", ".tiff", ".psd", ".psb"]);
const upload = multer({
  dest: incomingRoot,
  limits: { fileSize: 100 * 1024 * 1024, files: 12 },
  fileFilter: (_req, file, callback) => callback(null, allowedExtensions.has(path.extname(file.originalname).toLowerCase()))
});

app.disable("x-powered-by");
app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  res.setHeader("X-Request-ID", req.requestId);
  next();
});
app.use(securityHeaders);
app.use(express.json({ limit: "1mb" }));
app.use("/api/plugin", pluginCors);
app.use(authenticate);
app.use(protectUnsafeRequests);
app.use((req, res, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && (req.path.startsWith("/api/client/") || req.path.startsWith("/api/admin/clients") || req.path.startsWith("/api/color-requests"))) {
    res.on("finish", () => {
      if (res.statusCode < 400) catalogCache.clear();
    });
  }
  next();
});
function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanString(value, max = 5000) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 320;
}

function assertClientAccess(req, clientId) {
  if (req.user.role === "ADMIN") return;
  if (req.user.client_id !== clientId) {
    const error = new Error("This record belongs to another client");
    error.status = 403;
    throw error;
  }
}

async function assertLibraryEdit(req, colorId) {
  const edit = (await db.query(
    "SELECT status FROM color_edit_requests WHERE color_id=$1 AND status='IN_EDIT' LIMIT 1",
    [colorId]
  )).rows[0];
  const message = libraryEditBlock(req.user.role, edit?.status || "");
  if (message) {
    const error = new Error(message);
    error.status = 403;
    throw error;
  }
}

async function fileChecksum(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fsNative.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function buildCatalogForClient(clientId, includeHistory, archivedOnly = false) {
  const clientResult = await db.query("SELECT id,code,name,local_folder_path,active,updated_at FROM clients WHERE id=$1", [clientId]);
  if (!clientResult.rows[0]) return null;
  const [archivedCountResult, colorsResult] = await Promise.all([
    db.query("SELECT count(*)::int AS count FROM colors WHERE client_id=$1 AND archived_at IS NOT NULL", [clientId]),
    db.query(
      `SELECT id,name,normalized_key,color_code,hex_code,collection,instructions,archived_at,updated_at
       FROM colors
       WHERE client_id=$1 AND (($2::boolean=true AND archived_at IS NOT NULL) OR ($2::boolean=false AND archived_at IS NULL))
       ORDER BY name`,
      [clientId, Boolean(archivedOnly)]
    )
  ]);
  const archivedColorCount = Number(archivedCountResult.rows[0].count);
  const colorIds = colorsResult.rows.map(row => row.id);
  if (!colorIds.length) return { client: clientResult.rows[0], colors: [], archivedColorCount };
  const [refsResult, aliasesResult, editsResult] = await Promise.all([
    db.query(
      `SELECT r.id,r.color_id,r.kind,r.label,r.instructions,r.active_approved_version_id,
              v.id AS version_id,v.version_number,
              CASE WHEN $2::boolean THEN dense_rank() OVER (PARTITION BY r.id ORDER BY v.version_number)::int ELSE v.version_number END AS display_version_number,
              v.status,v.original_filename,v.local_relative_path,
              v.size_bytes,v.checksum_sha256,v.upload_note,v.approved_at,v.synced_at,v.created_at
       FROM color_references r
       JOIN reference_versions v ON v.reference_id=r.id
         AND v.status<>'REMOVED'
         AND ($2::boolean=true OR v.id=r.active_approved_version_id)
       WHERE r.color_id=ANY($1::uuid[])
       ORDER BY r.kind,v.version_number DESC`,
      [colorIds, Boolean(includeHistory)]
    ),
    db.query("SELECT color_id,alias FROM color_aliases WHERE color_id=ANY($1::uuid[]) ORDER BY alias", [colorIds]),
    db.query(
      `SELECT id, color_id, details, reason, status, created_at
       FROM color_edit_requests
       WHERE color_id=ANY($1::uuid[]) AND status IN ('PENDING','IN_EDIT')`,
      [colorIds]
    )
  ]);
  const referencesByColor = new Map();
  const aliasesByColor = new Map();
  const editsByColor = new Map();
  for (const ref of refsResult.rows) {
    if (!referencesByColor.has(ref.color_id)) referencesByColor.set(ref.color_id, []);
    referencesByColor.get(ref.color_id).push(ref);
  }
  for (const alias of aliasesResult.rows) {
    if (!aliasesByColor.has(alias.color_id)) aliasesByColor.set(alias.color_id, []);
    aliasesByColor.get(alias.color_id).push(alias.alias);
  }
  for (const edit of editsResult.rows) editsByColor.set(edit.color_id, edit);
  return {
    client: clientResult.rows[0],
    archivedColorCount,
    colors: colorsResult.rows.map(color => ({
      id: color.id,
      name: color.name,
      normalizedKey: color.normalized_key,
      colorCode: color.color_code,
      hexCode: color.hex_code || "",
      collection: color.collection === "CORE" ? "CORE" : "SEASONAL",
      instructions: color.instructions,
      editRequest: editsByColor.has(color.id) ? {
        id: editsByColor.get(color.id).id,
        status: editsByColor.get(color.id).status,
        details: editsByColor.get(color.id).details,
        reason: editsByColor.get(color.id).reason,
        createdAt: editsByColor.get(color.id).created_at
      } : null,
      archivedAt: color.archived_at,
      updatedAt: color.updated_at,
      aliases: aliasesByColor.get(color.id) || [],
      references: (referencesByColor.get(color.id) || []).map(ref => ({
        id: ref.id,
        kind: ref.kind,
        label: ref.label,
        instructions: ref.instructions,
        activeApprovedVersionId: ref.active_approved_version_id,
        version: ref.version_id ? {
          id: ref.version_id,
          number: ref.display_version_number,
          status: ref.status,
          originalFilename: ref.original_filename,
          localRelativePath: ref.local_relative_path,
          sizeBytes: Number(ref.size_bytes),
          checksumSha256: ref.checksum_sha256,
          uploadNote: ref.upload_note,
          approvedAt: ref.approved_at,
          syncedAt: ref.synced_at,
          createdAt: ref.created_at
        } : null
      }))
    }))
  };
}

async function catalogForClient(clientId, includeHistory, archivedOnly = false) {
  if (!RECORD_ID.test(String(clientId || ""))) return null;
  const key = `${clientId}:${Boolean(includeHistory)}:${Boolean(archivedOnly)}`;
  const cached = catalogCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) catalogCache.delete(key);
  const pending = buildCatalogForClient(clientId, includeHistory, archivedOnly).catch(error => {
    catalogCache.delete(key);
    throw error;
  });
  if (catalogCache.size >= 100) catalogCache.delete(catalogCache.keys().next().value);
  catalogCache.set(key, { value: pending, expiresAt: Date.now() + CATALOG_CACHE_TTL_MS });
  return pending;
}

async function withSavedColors(catalog, userId) {
  if (!catalog?.colors?.length || !userId) return catalog;
  const saved = await db.query(
    "SELECT color_id FROM color_saves WHERE user_id=$1 AND color_id=ANY($2::uuid[])",
    [userId, catalog.colors.map(color => color.id)]
  );
  const savedIds = new Set(saved.rows.map(row => row.color_id));
  return { ...catalog, colors: catalog.colors.map(color => ({ ...color, saved: savedIds.has(color.id) })) };
}

app.get("/api/health", asyncRoute(async (_req, res) => {
  await db.query("SELECT 1");
  res.json({ ok: true, service: "pixofix-color-library", time: new Date().toISOString() });
}));

const googleStartLimiter = createRateLimiter({ limit: 20 });
const googleCallbackLimiter = createRateLimiter({ limit: 60 });
const passwordAuthLimiter = createRateLimiter({ limit: 10 });
registerGoogleAuth(app, { asyncRoute, authStartLimiter: googleStartLimiter, authCallbackLimiter: googleCallbackLimiter });

app.post("/api/auth/login", passwordAuthLimiter, asyncRoute(async (req, res) => {
  if (!config.allowPasswordLogin) return res.status(404).json({ error: "Password sign-in is disabled. Continue with Google." });
  const email = String(req.body.email == null ? "" : req.body.email).trim().toLowerCase();
  const password = typeof req.body.password === "string" ? req.body.password : "";
  if (!validEmail(email) || !password) return res.status(400).json({ error: "A valid email and password are required" });
  const result = await db.query(
    `SELECT u.* FROM users u
     LEFT JOIN clients c ON c.id=u.client_id
     WHERE lower(u.email)=lower($1) AND u.active=true
       AND (u.role='ADMIN' OR (u.role='CLIENT' AND c.active=true))`,
    [email]
  );
  const user = result.rows[0];
  if (!user || !user.password_hash || !(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ error: "Incorrect email or password" });
  }
  await db.query("UPDATE users SET last_login_at=now() WHERE id=$1", [user.id]);
  await createSession(user.id, req, res);
  await writeAudit(db, { user, ip: req.ip }, { clientId: user.client_id, entityType: "session", entityId: user.id, action: "LOGIN" });
  res.setHeader("Cache-Control", "no-store");
  res.json({ user: { id: user.id, email: user.email, displayName: user.display_name, role: user.role, clientId: user.client_id } });
}));

app.post("/api/auth/logout", asyncRoute(async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
}));

app.get("/api/auth/me", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!req.user) return res.status(401).json({ error: "Not signed in" });
  res.json({ user: { id: req.user.id, email: req.user.email, displayName: req.user.display_name, role: req.user.role, clientId: req.user.client_id } });
});

app.get("/api/admin/clients", requireRole("ADMIN"), asyncRoute(async (_req, res) => {
  const result = await db.query(
    `SELECT c.*,
            (SELECT count(*)::int FROM users u WHERE u.client_id=c.id AND u.role='CLIENT') AS user_count,
            (SELECT count(*)::int FROM colors x WHERE x.client_id=c.id AND x.archived_at IS NULL) AS color_count
     FROM clients c
     ORDER BY c.name`
  );
  res.json({ clients: result.rows });
}));

app.post("/api/admin/clients", requireRole("ADMIN"), asyncRoute(async (req, res) => {
  const code = cleanString(req.body.code, 24).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  const name = cleanString(req.body.name, 120);
  const folderPath = cleanString(req.body.localFolderPath, 1000);
  const submitted = Array.isArray(req.body.representatives) ? req.body.representatives : [];
  if (req.body.email) submitted.push({ email: req.body.email, displayName: req.body.displayName || name, password: req.body.password });
  const representatives = submitted.slice(0, 100).map(item => ({
    email: String(item?.email == null ? "" : item.email).trim().toLowerCase(),
    displayName: cleanString(item?.displayName, 120)
  })).filter(item => item.email);
  if (!code || !name || !folderPath || !representatives.length) {
    return res.status(400).json({ error: "Code, name, folder, and at least one authorized Gmail are required" });
  }
  if (representatives.some(item => !validEmail(item.email))) return res.status(400).json({ error: "Enter a valid email for every representative" });
  if (new Set(representatives.map(item => item.email)).size !== representatives.length) {
    return res.status(400).json({ error: "Each representative email can only be added once" });
  }
  const stat = await fs.stat(path.resolve(folderPath)).catch(() => null);
  if (!stat || !stat.isDirectory()) return res.status(400).json({ error: "The local folder does not exist on this server" });
  const legacyPasswordHash = config.allowPasswordLogin && req.body.password ? await hashPassword(req.body.password) : null;
  const created = await db.transaction(async client => {
    const clientRow = (await client.query("INSERT INTO clients(code,name,local_folder_path) VALUES($1,$2,$3) RETURNING *", [code, name, path.resolve(folderPath)])).rows[0];
    const users = [];
    for (let index = 0; index < representatives.length; index += 1) {
      const representative = representatives[index];
      users.push((await client.query(
        `INSERT INTO users(email,password_hash,display_name,role,client_id)
         VALUES($1,$2,$3,'CLIENT',$4)
         RETURNING id,email,display_name,role,client_id,active`,
        [representative.email, index === 0 ? legacyPasswordHash : null, representative.displayName || representative.email.split("@")[0], clientRow.id]
      )).rows[0]);
    }
    await writeAudit(client, req, { clientId: clientRow.id, entityType: "client", entityId: clientRow.id, action: "CREATE", after: clientRow });
    return { client: clientRow, users, user: users[0] };
  });
  res.status(201).json(created);
}));

app.patch("/api/admin/clients/:id", requireRole("ADMIN"), asyncRoute(async (req, res) => {
  const before = (await db.query("SELECT * FROM clients WHERE id=$1", [req.params.id])).rows[0];
  if (!before) return res.status(404).json({ error: "Client not found" });
  const folderPath = req.body.localFolderPath == null ? before.local_folder_path : path.resolve(cleanString(req.body.localFolderPath, 1000));
  if (req.body.localFolderPath != null) {
    const stat = await fs.stat(folderPath).catch(() => null);
    if (!stat || !stat.isDirectory()) return res.status(400).json({ error: "The local folder does not exist on this server" });
  }
  const result = await db.query(
    `UPDATE clients SET name=$1,local_folder_path=$2,active=$3,updated_at=now() WHERE id=$4 RETURNING *`,
    [cleanString(req.body.name == null ? before.name : req.body.name, 120), folderPath, req.body.active == null ? before.active : Boolean(req.body.active), req.params.id]
  );
  if (before.active && !result.rows[0].active) await revokeClientSessions(before.id);
  await writeAudit(db, req, { clientId: before.id, entityType: "client", entityId: before.id, action: "UPDATE", before, after: result.rows[0] });
  res.json({ client: result.rows[0] });
}));

app.post("/api/admin/clients/:id/delete", requireRole("ADMIN"), asyncRoute(async (req, res) => {
  if (req.body.confirmation !== "delete") return res.status(400).json({ error: "Type delete to confirm" });
  const before = (await db.query("SELECT * FROM clients WHERE id=$1", [req.params.id])).rows[0];
  if (!before) return res.status(404).json({ error: "Client not found" });
  const versions = (await db.query(
    `SELECT v.id, v.storage_path, v.local_relative_path
     FROM reference_versions v
     JOIN color_references r ON r.id=v.reference_id
     JOIN colors c ON c.id=r.color_id
     WHERE c.client_id=$1`,
    [before.id]
  )).rows;
  const requestFiles = (await db.query(
    `SELECT id, storage_path FROM color_request_sources
     WHERE request_id IN (SELECT id FROM color_requests WHERE client_id=$1)
     UNION ALL
     SELECT id, storage_path FROM color_request_deliveries
     WHERE request_id IN (SELECT id FROM color_requests WHERE client_id=$1)`,
    [before.id]
  )).rows;
  for (const version of versions) {
    if (!version.local_relative_path) continue;
    try { await removeSyncedVersion(version.id); } catch (_error) {}
  }
  await revokeClientSessions(before.id);
  await db.transaction(async client => {
    await writeAudit(client, req, { clientId: before.id, entityType: "client", entityId: before.id, action: "DELETE", before });
    await client.query("UPDATE colors SET created_by=NULL WHERE client_id=$1", [before.id]);
    await client.query(
      `UPDATE reference_versions SET uploaded_by=NULL, approved_by=NULL
       WHERE reference_id IN (SELECT r.id FROM color_references r JOIN colors c ON c.id=r.color_id WHERE c.client_id=$1)`,
      [before.id]
    );
    await client.query("UPDATE color_requests SET created_by=NULL WHERE client_id=$1", [before.id]);
    await client.query(
      `UPDATE color_request_deliveries SET uploaded_by=NULL
       WHERE request_id IN (SELECT id FROM color_requests WHERE client_id=$1)`,
      [before.id]
    );
    await client.query(
      `UPDATE color_request_comments SET author_id=NULL
       WHERE request_id IN (SELECT id FROM color_requests WHERE client_id=$1)`,
      [before.id]
    );
    await client.query("UPDATE color_edit_requests SET created_by=NULL, decided_by=NULL WHERE client_id=$1", [before.id]);
    await client.query("DELETE FROM clients WHERE id=$1", [before.id]);
  });
  const stored = [
    ...versions.flatMap(version => [version.storage_path, ...(/^[0-9a-f-]{36}$/i.test(version.id) ? [`previews/${version.id}.jpg`, `previews/${version.id}.full.png`] : [])]),
    ...requestFiles.flatMap(file => [file.storage_path, ...(/^[0-9a-f-]{36}$/i.test(file.id) ? [`previews/${file.id}.jpg`, `previews/${file.id}.full.png`] : [])])
  ];
  for (const relativePath of stored) {
    if (!relativePath) continue;
    try {
      const assetPath = path.resolve(config.storageRoot, relativePath);
      ensureInside(config.storageRoot, assetPath);
      await fs.unlink(assetPath);
    } catch (_error) {}
  }
  res.json({ ok: true });
}));

app.get("/api/admin/filesystem", requireRole("ADMIN"), asyncRoute(async (req, res) => {
  let requested = cleanString(req.query.path, 1000);
  if (!requested) {
    if (process.platform === "win32") {
      const roots = [];
      for (let code = 67; code <= 90; code += 1) {
        const root = String.fromCharCode(code) + ":\\";
        if (await fs.stat(root).catch(() => null)) roots.push({ name: root, path: root });
      }
      return res.json({ path: null, parent: null, folders: roots });
    }
    requested = "/";
  }
  const resolved = path.resolve(requested);
  const entries = await fs.readdir(resolved, { withFileTypes: true });
  res.json({
    path: resolved,
    parent: path.dirname(resolved) === resolved ? null : path.dirname(resolved),
    folders: entries.filter(entry => entry.isDirectory()).map(entry => ({ name: entry.name, path: path.join(resolved, entry.name) })).sort((a, b) => a.name.localeCompare(b.name))
  });
}));

app.get("/api/admin/audit", requireRole("ADMIN"), asyncRoute(async (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
  const params = [];
  let where = "";
  if (req.query.clientId) { params.push(req.query.clientId); where = `WHERE a.client_id=$${params.length}`; }
  params.push(limit);
  const result = await db.query(
    `SELECT a.id, a.created_at, a.action, a.entity_type, a.entity_id, a.client_id, a.after_data, a.before_data,
            u.email AS actor_email, u.display_name AS actor_name, u.role AS actor_role,
            c.code AS client_code, c.name AS client_name,
            COALESCE(req_color.name, req.proposed_name) AS request_subject,
            color.name AS color_name, color.archived_at AS color_archived_at,
            ref_color.id AS reference_color_id, ref_color.name AS reference_color_name, ref_color.archived_at AS reference_color_archived_at,
            ver_color.id AS version_color_id, ver_color.name AS version_color_name, ver_color.archived_at AS version_color_archived_at,
            edit_color.id AS edit_color_id, edit_color.name AS edit_color_name, edit_color.archived_at AS edit_color_archived_at,
            pix.name AS pixofix_name,
            access_req.display_name AS access_name, access_req.client_id AS access_client_id,
            subject_user.display_name AS subject_user_name, subject_user.client_id AS subject_user_client_id
     FROM audit_events a
     LEFT JOIN users u ON u.id = a.actor_user_id
     LEFT JOIN clients c ON c.id = a.client_id
     LEFT JOIN color_requests req ON a.entity_type = 'color_request' AND req.id::text = a.entity_id
     LEFT JOIN colors req_color ON req_color.id = req.color_id
     LEFT JOIN colors color ON a.entity_type = 'color' AND color.id::text = a.entity_id
     LEFT JOIN color_references ref ON a.entity_type = 'color_reference' AND ref.id::text = a.entity_id
     LEFT JOIN colors ref_color ON ref_color.id = ref.color_id
     LEFT JOIN reference_versions ver ON a.entity_type = 'reference_version' AND ver.id::text = a.entity_id
     LEFT JOIN color_references ver_ref ON ver_ref.id = ver.reference_id
     LEFT JOIN colors ver_color ON ver_color.id = ver_ref.color_id
     LEFT JOIN color_edit_requests edit ON a.entity_type = 'color_edit_request' AND edit.id::text = a.entity_id
     LEFT JOIN colors edit_color ON edit_color.id = edit.color_id
     LEFT JOIN pixofix_colors pix ON a.entity_type = 'pixofix_color' AND pix.id::text = a.entity_id
     LEFT JOIN user_access_requests access_req ON a.entity_type = 'user_access_request' AND access_req.id::text = a.entity_id
     LEFT JOIN users subject_user ON a.entity_type IN ('user', 'session') AND subject_user.id::text = a.entity_id
     ${where} ORDER BY a.created_at DESC LIMIT $${params.length}`,
    params
  );
  res.json({ events: result.rows.map(presentAuditEvent) });
}));

app.get("/api/client/colors", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
  const clientId = req.user.role === "ADMIN" ? req.query.clientId : req.user.client_id;
  if (!clientId) return res.status(400).json({ error: "Client is required" });
  assertClientAccess(req, clientId);
  const catalog = await withSavedColors(await catalogForClient(clientId, true), req.user.id);
  if (!catalog) return res.status(404).json({ error: "Client not found" });
  res.json(catalog);
}));

app.get("/api/client/colors/archived", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
  const clientId = req.user.role === "ADMIN" ? req.query.clientId : req.user.client_id;
  if (!clientId) return res.status(400).json({ error: "Client is required" });
  assertClientAccess(req, clientId);
  const catalog = await catalogForClient(clientId, true, true);
  if (!catalog) return res.status(404).json({ error: "Client not found" });
  res.json(catalog);
}));

app.post("/api/client/colors", requireRole("ADMIN"), asyncRoute(async (req, res) => {
  const clientId = req.user.role === "ADMIN" ? req.body.clientId : req.user.client_id;
  assertClientAccess(req, clientId);
  const name = cleanString(req.body.name, 120);
  if (!name) return res.status(400).json({ error: "Color name is required" });
  const result = await db.query(
    `INSERT INTO colors(client_id,name,normalized_key,color_code,instructions,created_by)
     VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [clientId, name, normalizeKey(name), cleanString(req.body.colorCode, 80) || null, cleanString(req.body.instructions), req.user.id]
  );
  await writeAudit(db, req, { clientId, entityType: "color", entityId: result.rows[0].id, action: "CREATE", after: result.rows[0] });
  res.status(201).json({ color: result.rows[0] });
}));

app.post("/api/client/colors/:id/save", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
  if (typeof req.body.saved !== "boolean") return res.status(400).json({ error: "Choose whether to save this color" });
  const color = (await db.query("SELECT id, client_id FROM colors WHERE id=$1 AND archived_at IS NULL", [req.params.id])).rows[0];
  if (!color) return res.status(404).json({ error: "Color not found" });
  assertClientAccess(req, color.client_id);
  if (req.body.saved) await db.query("INSERT INTO color_saves(user_id,color_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [req.user.id, color.id]);
  else await db.query("DELETE FROM color_saves WHERE user_id=$1 AND color_id=$2", [req.user.id, color.id]);
  res.json({ saved: req.body.saved });
}));

app.post("/api/client/colors/:id/collection", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
  const collection = String(req.body.collection || "").toUpperCase();
  if (collection !== "CORE" && collection !== "SEASONAL") return res.status(400).json({ error: "Choose core or seasonal" });
  const before = (await db.query("SELECT * FROM colors WHERE id=$1 AND archived_at IS NULL", [req.params.id])).rows[0];
  if (!before) return res.status(404).json({ error: "Color not found" });
  assertClientAccess(req, before.client_id);
  const result = await db.query("UPDATE colors SET collection=$1,updated_at=now() WHERE id=$2 RETURNING *", [collection, before.id]);
  await writeAudit(db, req, { clientId: before.client_id, entityType: "color", entityId: before.id, action: "UPDATE", before, after: result.rows[0] });
  res.json({ color: result.rows[0] });
}));

app.patch("/api/client/colors/:id", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
  const before = (await db.query("SELECT * FROM colors WHERE id=$1 AND archived_at IS NULL", [req.params.id])).rows[0];
  if (!before) return res.status(404).json({ error: "Color not found" });
  assertClientAccess(req, before.client_id);
  await assertLibraryEdit(req, before.id);
  const name = cleanString(req.body.name == null ? before.name : req.body.name, 120);
  let hexCode = before.hex_code || "";
  if (req.body.hexCode != null) {
    const raw = String(req.body.hexCode).trim();
    hexCode = raw ? normalizeHex(raw) : "";
    if (raw && !hexCode) return res.status(400).json({ error: "Enter a hex code such as #E76223." });
  }
  if (hexCode && hexCode !== before.hex_code) {
    const taken = (await db.query(
      "SELECT name FROM colors WHERE client_id=$1 AND hex_code=$2 AND archived_at IS NULL AND id<>$3 LIMIT 1",
      [before.client_id, hexCode, before.id]
    )).rows[0];
    if (taken) return res.status(409).json({ error: `Hex code ${hexCode} is already used by ${taken.name}.` });
  }
  const result = await db.query(
    `UPDATE colors SET name=$1,normalized_key=$2,color_code=$3,hex_code=$4,instructions=$5,updated_at=now() WHERE id=$6 RETURNING *`,
    [name, normalizeKey(name), req.body.colorCode == null ? before.color_code : cleanString(req.body.colorCode, 80) || null, hexCode, req.body.instructions == null ? before.instructions : cleanString(req.body.instructions), before.id]
  );
  await writeAudit(db, req, { clientId: before.client_id, entityType: "color", entityId: before.id, action: "UPDATE", before, after: result.rows[0] });
  res.json({ color: result.rows[0] });
}));

app.delete("/api/client/colors/:id", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
  const before = (await db.query("SELECT * FROM colors WHERE id=$1 AND archived_at IS NULL", [req.params.id])).rows[0];
  if (!before) return res.status(404).json({ error: "Color not found" });
  assertClientAccess(req, before.client_id);
  await assertLibraryEdit(req, before.id);
  const activeVersions = (await db.query("SELECT active_approved_version_id AS id FROM color_references WHERE color_id=$1 AND active_approved_version_id IS NOT NULL", [before.id])).rows;
  await db.query("UPDATE colors SET archived_at=now(),updated_at=now() WHERE id=$1", [before.id]);
  await writeAudit(db, req, { clientId: before.client_id, entityType: "color", entityId: before.id, action: "ARCHIVE", before });
  for (const version of activeVersions) await removeSyncedVersion(version.id);
  res.json({ ok: true });
}));

app.post("/api/client/colors/:id/delete", requireRole("ADMIN"), asyncRoute(async (req, res) => {
  if (req.body.confirmation !== "delete") return res.status(400).json({ error: "Type delete to confirm" });
  const before = (await db.query("SELECT * FROM colors WHERE id=$1", [req.params.id])).rows[0];
  if (!before) return res.status(404).json({ error: "Color not found" });
  assertClientAccess(req, before.client_id);
  const versions = (await db.query(
    `SELECT v.id, v.storage_path, v.local_relative_path
     FROM reference_versions v
     JOIN color_references r ON r.id=v.reference_id
     WHERE r.color_id=$1`,
    [before.id]
  )).rows;
  for (const version of versions) {
    if (!version.local_relative_path) continue;
    try { await removeSyncedVersion(version.id); } catch (_error) {}
  }
  await db.transaction(async client => {
    await writeAudit(client, req, { clientId: before.client_id, entityType: "color", entityId: before.id, action: "DELETE", before });
    await client.query("DELETE FROM color_requests WHERE color_id=$1", [before.id]);
    await client.query("DELETE FROM colors WHERE id=$1", [before.id]);
  });
  for (const version of versions) {
    const relativePaths = [version.storage_path, ...( /^[0-9a-f-]{36}$/i.test(version.id) ? [`previews/${version.id}.jpg`, `previews/${version.id}.full.png`] : [])];
    for (const relativePath of relativePaths) {
      if (!relativePath) continue;
      try {
        const assetPath = path.resolve(config.storageRoot, relativePath);
        ensureInside(config.storageRoot, assetPath);
        await fs.unlink(assetPath);
      } catch (_error) {}
    }
  }
  res.json({ ok: true });
}));

app.post("/api/client/colors/:id/unarchive", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
  const before = (await db.query("SELECT * FROM colors WHERE id=$1 AND archived_at IS NOT NULL", [req.params.id])).rows[0];
  if (!before) return res.status(404).json({ error: "Archived color not found" });
  assertClientAccess(req, before.client_id);
  await assertLibraryEdit(req, before.id);
  let restored;
  try {
    restored = (await db.query("UPDATE colors SET archived_at=NULL,updated_at=now() WHERE id=$1 RETURNING *", [before.id])).rows[0];
  } catch (error) {
    if (error.code === "23505" && error.constraint === "colors_client_hex_active") {
      return res.status(409).json({ error: `Hex code ${before.hex_code} is already used by an active color.` });
    }
    throw error;
  }
  await writeAudit(db, req, { clientId: before.client_id, entityType: "color", entityId: before.id, action: "UNARCHIVE", before, after: restored });
  const activeVersions = (await db.query("SELECT active_approved_version_id AS id FROM color_references WHERE color_id=$1 AND active_approved_version_id IS NOT NULL", [before.id])).rows;
  const syncFailures = [];
  for (const version of activeVersions) {
    try { await syncApprovedVersion(version.id); }
    catch (error) { syncFailures.push(error.message); }
  }
  res.json({ color: restored, sync: { status: syncFailures.length ? "PARTIAL" : "COMPLETE", failures: syncFailures } });
}));

function presentEditRequest(row) {
  return {
    id: row.id,
    colorId: row.color_id,
    status: row.status,
    details: row.details,
    reason: row.reason,
    createdAt: row.created_at,
    decidedAt: row.decided_at
  };
}

app.post("/api/client/colors/:id/edit-requests", requireRole("CLIENT"), asyncRoute(async (req, res) => {
  const color = (await db.query("SELECT id, client_id, archived_at FROM colors WHERE id=$1", [req.params.id])).rows[0];
  if (!color || color.archived_at) return res.status(404).json({ error: "Color not found" });
  assertClientAccess(req, color.client_id);
  const details = cleanString(req.body.details, 5000);
  const reason = cleanString(req.body.reason, 5000);
  if (!details || !reason) return res.status(400).json({ error: "Describe the edit and the reason." });
  const open = (await db.query(
    "SELECT id FROM color_edit_requests WHERE color_id=$1 AND status IN ('PENDING','IN_EDIT') LIMIT 1",
    [color.id]
  )).rows[0];
  if (open) return res.status(409).json({ error: "An edit request is already open for this color." });
  try {
    const created = (await db.query(
      `INSERT INTO color_edit_requests(color_id, client_id, details, reason, status, created_by)
       VALUES($1,$2,$3,$4,'PENDING',$5) RETURNING *`,
      [color.id, color.client_id, details, reason, req.user.id]
    )).rows[0];
    await writeAudit(db, req, { clientId: color.client_id, entityType: "color_edit_request", entityId: created.id, action: "CREATE", after: created });
    res.status(201).json({ editRequest: presentEditRequest(created) });
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "An edit request is already open for this color." });
    throw error;
  }
}));

app.post("/api/client/colors/:id/edit-requests/start", requireRole("ADMIN"), asyncRoute(async (req, res) => {
  const color = (await db.query("SELECT id, client_id, archived_at FROM colors WHERE id=$1", [req.params.id])).rows[0];
  if (!color || color.archived_at) return res.status(404).json({ error: "Color not found" });
  const open = (await db.query(
    "SELECT * FROM color_edit_requests WHERE color_id=$1 AND status IN ('PENDING','IN_EDIT') LIMIT 1",
    [color.id]
  )).rows[0];
  if (open?.status === "IN_EDIT") return res.json({ editRequest: presentEditRequest(open) });
  if (open?.status === "PENDING") return res.status(409).json({ error: "Accept the client's edit request to unlock this color." });
  try {
    const created = (await db.query(
      `INSERT INTO color_edit_requests(color_id, client_id, details, reason, status, created_by, decided_by, decided_at)
       VALUES($1,$2,$3,$4,'IN_EDIT',$5,$5,now()) RETURNING *`,
      [color.id, color.client_id, "Administrator edit", "Opened by an administrator", req.user.id]
    )).rows[0];
    await writeAudit(db, req, { clientId: color.client_id, entityType: "color_edit_request", entityId: created.id, action: "START", after: created });
    res.status(201).json({ editRequest: presentEditRequest(created) });
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "An edit request is already open for this color." });
    throw error;
  }
}));

app.post("/api/client/colors/:id/edit-requests/:editId/:decision", requireRole("ADMIN"), asyncRoute(async (req, res) => {
  const decision = req.params.decision;
  if (!["edit", "reject", "complete"].includes(decision)) return res.status(404).json({ error: "Edit action not found" });
  const color = (await db.query("SELECT id, client_id FROM colors WHERE id=$1", [req.params.id])).rows[0];
  if (!color) return res.status(404).json({ error: "Color not found" });
  const edit = (await db.query(
    "SELECT * FROM color_edit_requests WHERE id=$1 AND color_id=$2",
    [req.params.editId, color.id]
  )).rows[0];
  if (!edit) return res.status(404).json({ error: "Edit request not found" });
  const next = decision === "edit" ? "IN_EDIT" : decision === "reject" ? "REJECTED" : "COMPLETED";
  const allowed = decision === "complete" ? "IN_EDIT" : "PENDING";
  if (edit.status !== allowed) return res.status(409).json({ error: "This edit request can no longer be changed." });
  const updated = (await db.query(
    `UPDATE color_edit_requests
     SET status=$1, decided_by=$2, decided_at=now(), updated_at=now()
     WHERE id=$3 RETURNING *`,
    [next, req.user.id, edit.id]
  )).rows[0];
  await writeAudit(db, req, {
    clientId: color.client_id,
    entityType: "color_edit_request",
    entityId: edit.id,
    action: decision === "edit" ? "ACCEPT" : decision === "reject" ? "REJECT" : "COMPLETE",
    before: edit,
    after: updated
  });
  res.json({ editRequest: presentEditRequest(updated) });
}));

async function saveVersion(req, res, referenceId) {
  if (!req.file) return res.status(400).json({ error: "Reference image is required" });
  const ref = (await db.query(
    `SELECT r.*,c.client_id,c.name AS color_name,cl.code AS client_code
     FROM color_references r JOIN colors c ON c.id=r.color_id JOIN clients cl ON cl.id=c.client_id
     WHERE r.id=$1 AND c.archived_at IS NULL`, [referenceId]
  )).rows[0];
  if (!ref) { await fs.unlink(req.file.path).catch(() => {}); return res.status(404).json({ error: "Reference not found" }); }
  assertClientAccess(req, ref.client_id);
  await assertLibraryEdit(req, ref.color_id);
  const staleVersions = await db.transaction(async client => {
    await client.query(
      `UPDATE color_references SET active_approved_version_id=NULL
       WHERE id=$1 AND active_approved_version_id IN
       (SELECT id FROM reference_versions WHERE reference_id=$1 AND status='REMOVED')`,
      [referenceId]
    );
    const removed = (await client.query(
      "DELETE FROM reference_versions WHERE reference_id=$1 AND status='REMOVED' RETURNING storage_path",
      [referenceId]
    )).rows;
    if (removed.length) {
      await client.query("UPDATE reference_versions SET version_number=-version_number WHERE reference_id=$1", [referenceId]);
      await client.query(
        `WITH ranked AS (
           SELECT id,row_number() OVER (ORDER BY -version_number)::int AS serial
           FROM reference_versions WHERE reference_id=$1
         )
         UPDATE reference_versions v SET version_number=ranked.serial FROM ranked WHERE v.id=ranked.id`,
        [referenceId]
      );
    }
    return removed;
  });
  for (const stale of staleVersions) {
    const stalePath = path.resolve(config.storageRoot, stale.storage_path);
    ensureInside(config.storageRoot, stalePath);
    await fs.unlink(stalePath).catch(() => {});
  }
  const nextVersion = Number((await db.query(
    `SELECT coalesce(min(candidate),1) AS next
     FROM generate_series(1,(SELECT coalesce(max(version_number),0)+1 FROM reference_versions WHERE reference_id=$1)) candidate
     LEFT JOIN reference_versions v ON v.reference_id=$1 AND v.version_number=candidate
     WHERE v.id IS NULL`,
    [referenceId]
  )).rows[0].next);
  const versionId = crypto.randomUUID();
  const extension = path.extname(req.file.originalname).toLowerCase() || ".bin";
  const relativeStorage = path.join(ref.client_code, ref.color_id, referenceId, `v${nextVersion}-${versionId}${extension}`);
  const destination = path.join(config.storageRoot, "assets", relativeStorage);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.rename(req.file.path, destination);
  const checksum = await fileChecksum(destination);
  const storagePath = path.relative(config.storageRoot, destination).replace(/\\/g, "/");
  const result = await db.query(
    `INSERT INTO reference_versions(id,reference_id,version_number,original_filename,storage_path,mime_type,size_bytes,checksum_sha256,upload_note,uploaded_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [versionId, referenceId, nextVersion, req.file.originalname, storagePath, req.file.mimetype || "application/octet-stream", req.file.size, checksum, cleanString(req.body.uploadNote), req.user.id]
  );
  await writeAudit(db, req, { clientId: ref.client_id, entityType: "reference_version", entityId: versionId, action: "UPLOAD", after: result.rows[0] });
  cachedPreview(config.storageRoot, destination, versionId).catch(error => {
    console.warn("Uploaded file preview could not be prepared", versionId, error.message);
  });
  res.status(201).json({ version: result.rows[0] });
}

app.post("/api/client/colors/:colorId/references", requireRole("CLIENT", "ADMIN"), upload.single("file"), asyncRoute(async (req, res) => {
  const color = (await db.query("SELECT * FROM colors WHERE id=$1 AND archived_at IS NULL", [req.params.colorId])).rows[0];
  if (!color) return res.status(404).json({ error: "Color not found" });
  assertClientAccess(req, color.client_id);
  await assertLibraryEdit(req, color.id);
  const kind = ["QUICK", "FULL", "OTHER"].includes(req.body.kind) ? req.body.kind : "QUICK";
  const label = kind === "OTHER" ? cleanString(req.body.label, 80).replace(/(?:\s+reference)+$/i, "").trim().toUpperCase() : "";
  if (kind === "OTHER" && !label) return res.status(400).json({ error: "Enter a name for the new reference type" });
  const reference = (await db.query(
    `INSERT INTO color_references(color_id,kind,label,instructions) VALUES($1,$2,$3,$4)
     ON CONFLICT(color_id,kind,label) DO UPDATE SET instructions=EXCLUDED.instructions,updated_at=now()
     RETURNING *`,
    [color.id, kind, label, cleanString(req.body.instructions)]
  )).rows[0];
  return saveVersion(req, res, reference.id);
}));

app.post("/api/client/references/:id/versions", requireRole("CLIENT", "ADMIN"), upload.single("file"), asyncRoute(async (req, res) => saveVersion(req, res, req.params.id)));

app.patch("/api/client/references/:id", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
  const before = (await db.query(
    `SELECT r.*,c.client_id FROM color_references r
     JOIN colors c ON c.id=r.color_id
     WHERE r.id=$1 AND c.archived_at IS NULL`,
    [req.params.id]
  )).rows[0];
  if (!before) return res.status(404).json({ error: "Reference not found" });
  assertClientAccess(req, before.client_id);
  await assertLibraryEdit(req, before.color_id);
  const kind = req.body.kind == null ? before.kind : cleanString(req.body.kind, 10).toUpperCase();
  if (!["QUICK", "FULL", "OTHER"].includes(kind)) return res.status(400).json({ error: "Invalid reference type" });
  const label = kind === "OTHER" ? cleanString(req.body.label == null ? before.label : req.body.label, 80) : "";
  if (kind === "OTHER" && !label) return res.status(400).json({ error: "A custom reference type needs a name" });
  try {
    const result = await db.query(
      `UPDATE color_references SET kind=$1,label=$2,instructions=$3,updated_at=now()
       WHERE id=$4 RETURNING *`,
      [kind, label, req.body.instructions == null ? before.instructions : cleanString(req.body.instructions), before.id]
    );
    await writeAudit(db, req, { clientId: before.client_id, entityType: "color_reference", entityId: before.id, action: "UPDATE", before, after: result.rows[0] });
    res.json({ reference: result.rows[0] });
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "A reference with this type or name already exists for the color" });
    throw error;
  }
}));

app.post("/api/client/references/:id/delete", requireRole("ADMIN"), asyncRoute(async (req, res) => {
  if (req.body.confirmation !== "delete") return res.status(400).json({ error: "Type delete to confirm" });
  const before = (await db.query(
    `SELECT r.*, c.client_id
     FROM color_references r
     JOIN colors c ON c.id=r.color_id
     WHERE r.id=$1`,
    [req.params.id]
  )).rows[0];
  if (!before) return res.status(404).json({ error: "Reference not found" });
  assertClientAccess(req, before.client_id);
  const versions = (await db.query(
    "SELECT id, storage_path, local_relative_path FROM reference_versions WHERE reference_id=$1",
    [before.id]
  )).rows;
  for (const version of versions) {
    if (!version.local_relative_path) continue;
    try { await removeSyncedVersion(version.id); } catch (_error) {}
  }
  await db.transaction(async client => {
    await writeAudit(client, req, { clientId: before.client_id, entityType: "color_reference", entityId: before.id, action: "DELETE", before });
    await client.query("UPDATE color_references SET active_approved_version_id=NULL WHERE id=$1", [before.id]);
    await client.query("DELETE FROM reference_versions WHERE reference_id=$1", [before.id]);
    await client.query("DELETE FROM color_references WHERE id=$1", [before.id]);
  });
  for (const version of versions) {
    const relativePaths = [version.storage_path, ...( /^[0-9a-f-]{36}$/i.test(version.id) ? [`previews/${version.id}.jpg`, `previews/${version.id}.full.png`] : [])];
    for (const relativePath of relativePaths) {
      if (!relativePath) continue;
      try {
        const assetPath = path.resolve(config.storageRoot, relativePath);
        ensureInside(config.storageRoot, assetPath);
        await fs.unlink(assetPath);
      } catch (_error) {}
    }
  }
  res.json({ ok: true });
}));

app.patch("/api/client/versions/:id", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
  const before = (await db.query(
    `SELECT v.*,r.color_id,c.client_id FROM reference_versions v
     JOIN color_references r ON r.id=v.reference_id
     JOIN colors c ON c.id=r.color_id
     WHERE v.id=$1 AND c.archived_at IS NULL`,
    [req.params.id]
  )).rows[0];
  if (!before) return res.status(404).json({ error: "Version not found" });
  assertClientAccess(req, before.client_id);
  await assertLibraryEdit(req, before.color_id);
  const originalFilename = cleanString(req.body.originalFilename == null ? before.original_filename : req.body.originalFilename, 255);
  if (!originalFilename) return res.status(400).json({ error: "Version filename is required" });
  if (path.basename(originalFilename) !== originalFilename || /[\\/]/.test(originalFilename)) {
    return res.status(400).json({ error: "Version filename cannot contain a folder path" });
  }
  if (path.extname(originalFilename).toLowerCase() !== path.extname(before.original_filename).toLowerCase()) {
    return res.status(400).json({ error: "The filename must keep its original file extension" });
  }
  const result = await db.query(
    `UPDATE reference_versions SET original_filename=$1,upload_note=$2 WHERE id=$3 RETURNING *`,
    [originalFilename, req.body.uploadNote == null ? before.upload_note : cleanString(req.body.uploadNote), before.id]
  );
  await writeAudit(db, req, { clientId: before.client_id, entityType: "reference_version", entityId: before.id, action: "UPDATE", before, after: result.rows[0] });
  res.json({ version: result.rows[0] });
}));

app.post("/api/client/versions/:id/approve", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
  const approved = await db.transaction(async client => {
    const version = (await client.query(
      `SELECT v.*,r.color_id,r.active_approved_version_id,c.client_id FROM reference_versions v JOIN color_references r ON r.id=v.reference_id JOIN colors c ON c.id=r.color_id WHERE v.id=$1 FOR UPDATE`,
      [req.params.id]
    )).rows[0];
    if (!version) return null;
    assertClientAccess(req, version.client_id);
    await assertLibraryEdit(req, version.color_id);
    await client.query("UPDATE reference_versions SET status='UNAPPROVED' WHERE reference_id=$1 AND status='APPROVED' AND id<>$2", [version.reference_id, version.id]);
    const row = (await client.query("UPDATE reference_versions SET status='APPROVED',approved_by=$1,approved_at=now(),removed_at=NULL WHERE id=$2 RETURNING *", [req.user.id, version.id])).rows[0];
    await client.query("UPDATE color_references SET active_approved_version_id=$1,updated_at=now() WHERE id=$2", [version.id, version.reference_id]);
    await writeAudit(client, req, { clientId: version.client_id, entityType: "reference_version", entityId: version.id, action: "APPROVE", before: version, after: row });
    return { row, previousApprovedVersionId: version.active_approved_version_id };
  });
  if (!approved) return res.status(404).json({ error: "Version not found" });
  try {
    if (approved.previousApprovedVersionId && approved.previousApprovedVersionId !== approved.row.id) {
      await removeSyncedVersion(approved.previousApprovedVersionId);
    }
    const sync = await syncApprovedVersion(approved.row.id);
    res.json({ version: approved.row, sync: { status: "COMPLETE", ...sync } });
  } catch (error) {
    res.status(202).json({ version: approved.row, sync: { status: "FAILED", error: error.message } });
  }
}));

app.post("/api/client/versions/:id/unapprove", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
  const version = (await db.query(
    `SELECT v.*,r.color_id,c.client_id FROM reference_versions v JOIN color_references r ON r.id=v.reference_id JOIN colors c ON c.id=r.color_id WHERE v.id=$1`,
    [req.params.id]
  )).rows[0];
  if (!version) return res.status(404).json({ error: "Version not found" });
  assertClientAccess(req, version.client_id);
  await assertLibraryEdit(req, version.color_id);
  await db.transaction(async client => {
    await client.query("UPDATE reference_versions SET status='UNAPPROVED',approved_by=NULL,approved_at=NULL WHERE id=$1", [version.id]);
    await client.query("UPDATE color_references SET active_approved_version_id=NULL,updated_at=now() WHERE active_approved_version_id=$1", [version.id]);
    await writeAudit(client, req, { clientId: version.client_id, entityType: "reference_version", entityId: version.id, action: "UNAPPROVE", before: version });
  });
  await removeSyncedVersion(version.id);
  res.json({ ok: true });
}));

app.delete("/api/client/versions/:id", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
  const version = (await db.query(
    `SELECT v.*,r.color_id,c.client_id FROM reference_versions v JOIN color_references r ON r.id=v.reference_id JOIN colors c ON c.id=r.color_id WHERE v.id=$1`,
    [req.params.id]
  )).rows[0];
  if (!version) return res.status(404).json({ error: "Version not found" });
  assertClientAccess(req, version.client_id);
  await assertLibraryEdit(req, version.color_id);
  await removeSyncedVersion(version.id);
  await db.transaction(async client => {
    await client.query("UPDATE color_references SET active_approved_version_id=NULL WHERE active_approved_version_id=$1", [version.id]);
    await client.query("DELETE FROM reference_versions WHERE id=$1", [version.id]);
    const remaining = Number((await client.query("SELECT count(*)::int AS count FROM reference_versions WHERE reference_id=$1", [version.reference_id])).rows[0].count);
    if (!remaining) await client.query("DELETE FROM color_references WHERE id=$1", [version.reference_id]);
    else {
      await client.query("UPDATE reference_versions SET version_number=-version_number WHERE reference_id=$1", [version.reference_id]);
      await client.query(
        `WITH ranked AS (
           SELECT id,row_number() OVER (ORDER BY -version_number)::int AS serial
           FROM reference_versions WHERE reference_id=$1
         )
         UPDATE reference_versions v SET version_number=ranked.serial FROM ranked WHERE v.id=ranked.id`,
        [version.reference_id]
      );
    }
    await writeAudit(client, req, { clientId: version.client_id, entityType: "reference_version", entityId: version.id, action: "REMOVE", before: version });
  });
  const assetPath = path.resolve(config.storageRoot, version.storage_path);
  ensureInside(config.storageRoot, assetPath);
  await fs.unlink(assetPath).catch(() => {});
  if (/^[0-9a-f-]{36}$/i.test(version.id)) {
    for (const relativePath of [`previews/${version.id}.jpg`, `previews/${version.id}.full.png`]) {
      try {
        const previewPath = path.resolve(config.storageRoot, relativePath);
        ensureInside(config.storageRoot, previewPath);
        await fs.unlink(previewPath);
      } catch (_error) {}
    }
  }
  res.json({ ok: true });
}));

app.get("/api/assets/:versionId", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
  const version = (await db.query(
    `SELECT v.storage_path,v.original_filename,c.client_id FROM reference_versions v JOIN color_references r ON r.id=v.reference_id JOIN colors c ON c.id=r.color_id WHERE v.id=$1 AND v.status<>'REMOVED'`,
    [req.params.versionId]
  )).rows[0];
  if (!version) return res.status(404).json({ error: "Asset not found" });
  assertClientAccess(req, version.client_id);
  const assetPath = path.resolve(config.storageRoot, version.storage_path);
  ensureInside(config.storageRoot, assetPath);
  res.setHeader("Content-Disposition", `inline; filename="${version.original_filename.replace(/\"/g, "")}"`);
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.sendFile(assetPath);
}));

app.get("/api/display/:versionId", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
  const version = (await db.query(
    `SELECT v.storage_path,c.client_id FROM reference_versions v JOIN color_references r ON r.id=v.reference_id JOIN colors c ON c.id=r.color_id WHERE v.id=$1 AND v.status<>'REMOVED'`,
    [req.params.versionId]
  )).rows[0];
  if (!version) return res.status(404).end();
  assertClientAccess(req, version.client_id);
  const assetPath = path.resolve(config.storageRoot, version.storage_path);
  ensureInside(config.storageRoot, assetPath);
  const display = await displayImage(config.storageRoot, assetPath, req.params.versionId);
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.setHeader("Content-Type", display.contentType);
  res.sendFile(display.path);
}));

app.get("/api/previews/:versionId", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
  const version = (await db.query(
    `SELECT v.storage_path,c.client_id FROM reference_versions v JOIN color_references r ON r.id=v.reference_id JOIN colors c ON c.id=r.color_id WHERE v.id=$1 AND v.status<>'REMOVED'`,
    [req.params.versionId]
  )).rows[0];
  if (!version) return res.status(404).end();
  assertClientAccess(req, version.client_id);
  const assetPath = path.resolve(config.storageRoot, version.storage_path);
  ensureInside(config.storageRoot, assetPath);
  try {
    const previewPath = await cachedPreview(config.storageRoot, assetPath, req.params.versionId);
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.setHeader("Content-Type", "image/jpeg");
    res.sendFile(previewPath);
  } catch (error) {
    console.warn("Preview unavailable", req.params.versionId, error.message);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.type("image/svg+xml").send('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 720"><rect width="720" height="720" fill="#24282d"/><path d="M270 240h180v240H270z" fill="none" stroke="#7d8791" stroke-width="18"/><path d="M310 310h100M310 360h100M310 410h70" stroke="#7d8791" stroke-width="14"/><text x="360" y="540" text-anchor="middle" fill="#aeb5bd" font-family="Arial" font-size="28">Preview unavailable</text></svg>');
  }
}));

app.get("/api/plugin/clients", asyncRoute(async (req, res) => {
  console.log("Plugin clients", req.socket && req.socket.remoteAddress, req.headers.origin || "-");
  const result = await db.query(
    `SELECT id,code,name,local_folder_path AS "localFolderPath",updated_at AS "updatedAt"
     FROM clients WHERE active=true AND local_folder_path<>'' ORDER BY name`
  );
  res.json({ clients: result.rows });
}));

app.get("/api/plugin/clients/:id/catalog", asyncRoute(async (req, res) => {
  const catalog = await catalogForClient(req.params.id, false);
  if (!catalog || !catalog.client.active) return res.status(404).json({ error: "Approved colors not found" });
  res.json(catalog);
}));

async function approvedPluginAsset(versionId) {
  if (!RECORD_ID.test(versionId)) return null;
  const version = (await db.query(
    `SELECT v.storage_path, v.original_filename, v.checksum_sha256
     FROM reference_versions v
     JOIN color_references r ON r.id = v.reference_id
     JOIN colors c ON c.id = r.color_id
     JOIN clients cl ON cl.id = c.client_id
     WHERE v.id = $1
       AND v.status = 'APPROVED'
       AND r.active_approved_version_id = v.id
       AND c.archived_at IS NULL
       AND cl.active = true`,
    [versionId]
  )).rows[0];
  if (!version) return null;
  const assetPath = path.resolve(config.storageRoot, version.storage_path);
  ensureInside(config.storageRoot, assetPath);
  try {
    await fs.access(assetPath);
  } catch (_error) {
    return null;
  }
  return { version, assetPath };
}

app.get("/api/plugin/versions/:id/file", asyncRoute(async (req, res) => {
  const asset = await approvedPluginAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: "Approved file not found" });
  const filename = String(asset.version.original_filename || "reference").replace(/[\r\n"]/g, "");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  res.setHeader("Cache-Control", "private, max-age=86400");
  if (asset.version.checksum_sha256) res.setHeader("ETag", `"${asset.version.checksum_sha256}"`);
  res.sendFile(asset.assetPath);
}));

app.get("/api/plugin/versions/:id/preview", asyncRoute(async (req, res) => {
  const asset = await approvedPluginAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: "Preview unavailable" });
  try {
    const previewPath = await cachedPreview(config.storageRoot, asset.assetPath, req.params.id);
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=86400");
    if (asset.version.checksum_sha256) res.setHeader("ETag", `"${asset.version.checksum_sha256}"`);
    res.sendFile(previewPath);
  } catch (error) {
    console.warn("Plugin preview unavailable", req.params.id, error.message);
    res.status(404).json({ error: "Preview unavailable" });
  }
}));

registerPixofixLibrary(app, { asyncRoute });

registerColorRequests(app, {
  asyncRoute,
  upload,
  assertClientAccess,
  cleanString,
  normalizeKey,
  fileChecksum
});

registerClientProfile(app, { asyncRoute, cleanString });
registerNotifications(app, { asyncRoute });

app.use(express.static(config.publicRoot));
app.use((_req, res) => res.sendFile(path.join(config.publicRoot, "index.html")));

app.use((error, _req, res, _next) => {
  console.error(`[${_req.requestId || "no-request-id"}]`, error);
  if (_req.file && _req.file.path) fs.unlink(_req.file.path).catch(() => {});
  for (const file of _req.files || []) if (file?.path) fs.unlink(file.path).catch(() => {});
  if (error.code === "23505") return res.status(409).json({ error: "A record with this name or email already exists" });
  if (error.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "Reference images must be 100 MB or smaller" });
  if (error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE") return res.status(400).json({ error: "A request can include up to 12 images" });
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500 ? error.status : 500;
  res.status(status).json({ error: status === 500 ? "Unexpected server error" : (error.message || "Request failed") });
});

async function start() {
  config.validateRuntimeConfig();
  await fs.mkdir(config.storageRoot, { recursive: true });
  await db.query("DELETE FROM sessions WHERE expires_at<=now()");
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(listenOptions(config.host, config.port));
    listener.once("listening", () => resolve(listener));
    listener.once("error", reject);
  });
  if (!ensureLanFirewall(config.port)) {
    console.warn(`Allow inbound TCP ${config.port} in Windows Firewall so other computers can open the portal.`);
  }
  const urls = portalUrls(config.port);
  console.log(`Pixofix Color Library portal: ${urls.join("  ")}`);
  console.log("Keep this window open. Press Ctrl+C to stop the portal.");
  server.on("close", () => console.log("Pixofix Color Library portal stopped."));
  return server;
}

if (require.main === module) {
  start().catch(error => {
    if (error.code === "EADDRINUSE") {
      console.error(`Server failed to start: port ${config.port} is already being used by another portal process.`);
    } else {
      console.error("Server failed to start:", error.message);
    }
    process.exit(1);
  });
}

module.exports = { app, normalizeKey, catalogForClient };
