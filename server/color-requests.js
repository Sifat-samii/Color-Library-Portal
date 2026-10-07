const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const config = require("./config");
const db = require("./db");
const { writeAudit } = require("./audit");
const { requireRole } = require("./security");
const { syncApprovedVersion, removeSyncedVersion, ensureInside } = require("./sync");
const { cachedPreview, displayImage } = require("./previews");
const { inspectImageFile } = require("./color-profile");
const { uploadDelivery, requestChanges, approveRequest, withdrawDelivery, referenceCategory, commentPlacement } = require("./color-request-flow");
const { normalizeHex } = require("./hex-code");
const { swatchPng } = require("./adobe-rgb-swatch");
const { recordActivity, requestActivity } = require("./activity");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isUuid(value) {
  return UUID.test(String(value || ""));
}

function originalName(file) {
  const base = path.basename(String(file?.originalname || "upload"));
  if (!base || base === "." || base === "..") return "upload";
  return base.slice(0, 255);
}

function contentDisposition(filename) {
  const safe = String(filename || "download").replace(/[\r\n"]/g, "");
  return `attachment; filename="${safe}"`;
}

function presentSummary(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    colorId: row.color_id,
    proposedName: row.proposed_name,
    colorName: row.color_name,
    displayName: row.color_name || row.proposed_name,
    pantone: row.pantone,
    hexCode: row.hex_code || "",
    note: row.note,
    status: row.status,
    sourceType: row.source_type || (row.source_profile ? "UPLOADED" : "GENERATED"),
    sourcePixofixColorId: row.source_pixofix_color_id || null,
    publishedVersionId: row.published_version_id,
    sourceProfile: row.source_profile || null,
    deliveryCount: Number(row.delivery_count || 0),
    requestedBy: row.created_by_name || row.created_by_email || "",
    requestedByEmail: row.created_by_email || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function presentSource(row) {
  if (!row) return null;
  return {
    id: row.id,
    originalFilename: row.original_filename,
    profileLabel: row.profile_label,
    sizeBytes: Number(row.size_bytes),
    uploadedBy: row.uploaded_by_name || row.uploaded_by_email || "",
    createdAt: row.created_at
  };
}

function presentDelivery(row) {
  return {
    id: row.id,
    number: row.version_number,
    status: row.status,
    originalFilename: row.original_filename,
    profileLabel: row.profile_label,
    uploadNote: row.upload_note,
    referenceKind: row.reference_kind || "FULL",
    referenceLabel: row.reference_label || "",
    sizeBytes: Number(row.size_bytes),
    uploadedBy: row.uploaded_by_name || row.uploaded_by_email || "",
    createdAt: row.created_at
  };
}

function presentComment(row) {
  return {
    id: row.id,
    body: row.body,
    deliveryId: row.delivery_id,
    sourceId: row.source_id || null,
    pinX: row.pin_x == null ? null : Number(row.pin_x),
    pinY: row.pin_y == null ? null : Number(row.pin_y),
    authorName: row.author_name || row.author_email || "Unknown",
    authorRole: row.author_role || "",
    createdAt: row.created_at
  };
}

async function swatchByHex(executor, hexCode) {
  const row = (await executor.query(
    "SELECT id, name, hex_code FROM pixofix_colors WHERE hex_code=$1 LIMIT 1",
    [hexCode]
  )).rows[0];
  if (!row) return null;
  return { id: row.id, name: row.name, hexCode: row.hex_code };
}

async function libraryColorByHex(executor, clientId, hexCode) {
  const color = (await executor.query(
    `SELECT id, name, hex_code
     FROM colors
     WHERE client_id=$1 AND hex_code=$2 AND archived_at IS NULL
     LIMIT 1`,
    [clientId, hexCode]
  )).rows[0];
  if (!color) return null;
  const images = (await executor.query(
    `SELECT v.id, r.kind, r.label
     FROM color_references r
     JOIN reference_versions v ON v.id=r.active_approved_version_id
     WHERE r.color_id=$1 AND v.status='APPROVED'
     ORDER BY CASE r.kind WHEN 'FULL' THEN 0 WHEN 'QUICK' THEN 1 ELSE 2 END, r.created_at`,
    [color.id]
  )).rows;
  return {
    id: color.id,
    name: color.name,
    hexCode: color.hex_code,
    images: images.map(image => ({
      id: image.id,
      kind: image.kind,
      label: image.label || ""
    }))
  };
}

async function requestDetail(id) {
  const request = (await db.query(
    `SELECT r.*, c.name AS color_name, cl.code AS client_code,
            creator.display_name AS created_by_name,creator.email AS created_by_email
     FROM color_requests r
     JOIN clients cl ON cl.id=r.client_id
     LEFT JOIN colors c ON c.id=r.color_id
     LEFT JOIN users creator ON creator.id=r.created_by
     WHERE r.id=$1`,
    [id]
  )).rows[0];
  if (!request) return null;
  const [source, deliveries, comments, activity] = await Promise.all([
    db.query("SELECT * FROM color_request_sources WHERE request_id=$1 ORDER BY created_at", [id]),
    db.query(
      `SELECT d.*,u.display_name AS uploaded_by_name,u.email AS uploaded_by_email
       FROM color_request_deliveries d LEFT JOIN users u ON u.id=d.uploaded_by
       WHERE d.request_id=$1 ORDER BY d.reference_kind,d.reference_label,d.version_number DESC`,
      [id]
    ),
    db.query(
      `SELECT c.*, u.display_name AS author_name, u.email AS author_email, u.role AS author_role
       FROM color_request_comments c
       LEFT JOIN users u ON u.id=c.author_id
       WHERE c.request_id=$1
       ORDER BY c.created_at`,
      [id]
    ),
    requestActivity(id)
  ]);
  return {
    ...presentSummary({ ...request, source_profile: source.rows[0]?.profile_label, delivery_count: deliveries.rows.length }),
    clientCode: request.client_code,
    source: presentSource(source.rows[0]),
    sources: source.rows.map(presentSource),
    deliveries: deliveries.rows.map(presentDelivery),
    comments: comments.rows.map(presentComment),
    activity
  };
}

async function findRequest(id) {
  if (!isUuid(id)) return null;
  return (await db.query(
    `SELECT r.*, c.name AS color_name, cl.code AS client_code,
            creator.display_name AS created_by_name,creator.email AS created_by_email
     FROM color_requests r
     JOIN clients cl ON cl.id=r.client_id
     LEFT JOIN colors c ON c.id=r.color_id
     LEFT JOIN users creator ON creator.id=r.created_by
     WHERE r.id=$1`,
    [id]
  )).rows[0] || null;
}

function storedPath(clientCode, requestId, filename) {
  return path.join("assets", clientCode, "requests", requestId, filename);
}

async function moveUpload(file, relativePath) {
  const destination = path.join(config.storageRoot, relativePath);
  ensureInside(config.storageRoot, destination);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.rename(file.path, destination);
  return destination;
}

function registerColorRequests(app, deps) {
  const { asyncRoute, upload, assertClientAccess, cleanString, normalizeKey, fileChecksum } = deps;

  async function accessibleRequest(req, id) {
    const request = await findRequest(id);
    if (!request) throw httpError(404, "Color request not found");
    assertClientAccess(req, request.client_id);
    return request;
  }

  app.get("/api/color-requests", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
    const clientId = req.user.role === "ADMIN" ? cleanString(req.query.clientId, 80) : req.user.client_id;
    if (!clientId || !isUuid(clientId)) throw httpError(400, "Client is required");
    if (req.user.role === "ADMIN") {
      const client = (await db.query("SELECT id FROM clients WHERE id=$1", [clientId])).rows[0];
      if (!client) throw httpError(404, "Client not found");
    }
    assertClientAccess(req, clientId);
    const status = cleanString(req.query.status, 40);
    const allowed = ["AWAITING_DELIVERY", "IN_PROGRESS", "CHANGES_REQUESTED", "APPROVED"];
    if (status && !allowed.includes(status)) throw httpError(400, "Unknown request status");
    const result = await db.query(
      `SELECT r.*, c.name AS color_name, s.profile_label AS source_profile,
              creator.display_name AS created_by_name,creator.email AS created_by_email,
              (SELECT count(*)::int FROM color_request_deliveries d WHERE d.request_id=r.id) AS delivery_count
       FROM color_requests r
       LEFT JOIN colors c ON c.id=r.color_id
       LEFT JOIN users creator ON creator.id=r.created_by
       LEFT JOIN LATERAL (
         SELECT profile_label FROM color_request_sources
         WHERE request_id=r.id
         ORDER BY created_at
         LIMIT 1
       ) s ON true
       WHERE r.client_id=$1 AND ($2::text='' OR r.status=$2)
       ORDER BY r.updated_at DESC`,
      [clientId, status]
    );
    res.json({ requests: result.rows.map(presentSummary) });
  }));

  app.get("/api/color-requests/hex-match", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
    const clientId = req.user.role === "ADMIN" ? cleanString(req.query.clientId, 80) : req.user.client_id;
    if (!clientId || !isUuid(clientId)) throw httpError(400, "Client is required");
    if (req.user.role === "ADMIN") {
      const client = (await db.query("SELECT id FROM clients WHERE id=$1", [clientId])).rows[0];
      if (!client) throw httpError(404, "Client not found");
    }
    assertClientAccess(req, clientId);
    const hexCode = normalizeHex(req.query.hex);
    const [match, swatch] = hexCode
      ? await Promise.all([libraryColorByHex(db, clientId, hexCode), swatchByHex(db, hexCode)])
      : [null, null];
    res.json({ match, swatch });
  }));

  app.post("/api/color-requests", requireRole("CLIENT", "ADMIN"), upload.array("files", 12), asyncRoute(async (req, res) => {
    const uploads = req.files || [];
    const destinations = [];
    let committed = false;
    try {
      const clientId = req.user.role === "ADMIN" ? cleanString(req.body.clientId, 80) : req.user.client_id;
      if (req.user.role === "ADMIN" && !isUuid(clientId)) throw httpError(400, "Client is required");
      if (!clientId) throw httpError(400, "Client is required");
      const client = (await db.query("SELECT id, code FROM clients WHERE id=$1", [clientId])).rows[0];
      if (!client) throw httpError(404, "Client not found");
      assertClientAccess(req, client.id);
      const pantone = cleanString(req.body.pantone, 120);
      let hexCode = normalizeHex(req.body.hexCode);
      const note = cleanString(req.body.note, 5000);
      let name = cleanString(req.body.name, 200);
      let sourceType = cleanString(req.body.sourceType, 20).toUpperCase() || (uploads.length ? "UPLOADED" : "GENERATED");
      if (!["GENERATED", "UPLOADED", "EXPLORE"].includes(sourceType)) throw httpError(400, "Choose a valid swatch source");
      if (uploads.length && sourceType === "GENERATED") sourceType = "UPLOADED";
      if (sourceType === "UPLOADED" && !uploads.length) throw httpError(400, "Upload at least one JPG, PNG, TIFF, PSD, or PSB swatch image");
      let sourcePixofixColorId = null;
      if (sourceType === "EXPLORE") {
        sourcePixofixColorId = cleanString(req.body.sourcePixofixColorId, 80);
        if (!isUuid(sourcePixofixColorId)) throw httpError(400, "Choose a swatch from Explore");
        const explored = (await db.query("SELECT id,hex_code,name FROM pixofix_colors WHERE id=$1", [sourcePixofixColorId])).rows[0];
        if (!explored) throw httpError(404, "The selected Explore swatch is no longer available");
        hexCode = explored.hex_code;
        if (!name) name = explored.name;
      }
      if (cleanString(req.body.colorId, 80)) throw httpError(400, "Requests can only be for a new color");
      if (!hexCode) throw httpError(400, "A hex code is required, such as #E76223");
      const key = normalizeKey(name);
      if (!key) throw httpError(400, "A color name is required");
      const existing = (await db.query("SELECT archived_at FROM colors WHERE client_id=$1 AND normalized_key=$2", [client.id, key])).rows[0];
      if (existing?.archived_at) throw httpError(409, "This name belongs to an archived color. Restore it or choose another name.");
      if (existing) throw httpError(409, "A color with this name is already in Approved colors. Choose another name.");
      const hexMatch = await libraryColorByHex(db, client.id, hexCode);
      if (hexMatch) throw httpError(409, `Hex code ${hexCode} already exists in Approved colors on ${hexMatch.name}.`);

      const requestId = crypto.randomUUID();
      const stored = [];
      for (const file of uploads) {
        const profile = await inspectImageFile(file.path);
        const sourceId = crypto.randomUUID();
        const extension = path.extname(originalName(file)).toLowerCase() || ".bin";
        const relativePath = storedPath(client.code, requestId, `source-${sourceId}${extension}`).replace(/\\/g, "/");
        const destination = await moveUpload(file, relativePath);
        destinations.push(destination);
        stored.push({
          sourceId,
          filename: originalName(file),
          storagePath: relativePath.replace(/\\/g, "/"),
          mimeType: file.mimetype || "application/octet-stream",
          size: file.size,
          checksum: await fileChecksum(destination),
          profile: profile.label
        });
      }
      const swatchId = crypto.randomUUID();
      const swatchName = `${hexCode.slice(1)}-swatch.png`;
      const swatchRelative = storedPath(client.code, requestId, `source-${swatchId}.png`).replace(/\\/g, "/");
      const swatchDestination = path.join(config.storageRoot, swatchRelative);
      ensureInside(config.storageRoot, swatchDestination);
      await fs.mkdir(path.dirname(swatchDestination), { recursive: true });
      const swatchBytes = await swatchPng(hexCode);
      await fs.writeFile(swatchDestination, swatchBytes);
      destinations.push(swatchDestination);
      stored.push({
        sourceId: swatchId,
        filename: swatchName,
        storagePath: swatchRelative,
        mimeType: "image/png",
        size: swatchBytes.length,
        checksum: await fileChecksum(swatchDestination),
        profile: "Adobe RGB (1998)"
      });
      await db.transaction(async clientDb => {
        await clientDb.query(
          `INSERT INTO color_requests(id,client_id,color_id,proposed_name,pantone,hex_code,note,created_by,source_type,source_pixofix_color_id)
           VALUES($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9)`,
          [requestId, client.id, name, pantone, hexCode, note, req.user.id, sourceType, sourcePixofixColorId]
        );
        for (const file of stored) {
          await clientDb.query(
            `INSERT INTO color_request_sources(id, request_id, original_filename, storage_path, mime_type, size_bytes, checksum_sha256, profile_label, created_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp())`,
            [file.sourceId, requestId, file.filename, file.storagePath, file.mimeType, file.size, file.checksum, file.profile]
          );
        }
        await writeAudit(clientDb, req, {
          clientId: client.id,
          entityType: "color_request",
          entityId: requestId,
          action: "CREATE",
          after: { pantone, hexCode, proposedName: name, attachments: stored.length, sourceType }
        });
        await recordActivity(clientDb, {
          actor: req.user,
          clientId: client.id,
          requestId,
          eventType: "REQUEST_CREATED",
          subjectType: "color_request",
          subjectId: requestId,
          metadata: { colorName: name, hexCode, sourceType },
          targetUrl: `/requests/${requestId}?client=${client.id}`
        });
      });
      committed = true;
      res.status(201).json({ request: await requestDetail(requestId) });
    } catch (error) {
      if (!committed) {
        await Promise.all(uploads.map(file => fs.unlink(file.path).catch(() => {})));
        await Promise.all(destinations.map(destination => fs.unlink(destination).catch(() => {})));
      }
      throw error;
    }
  }));

  app.get("/api/color-requests/:id", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
    await accessibleRequest(req, req.params.id);
    res.json({ request: await requestDetail(req.params.id) });
  }));

  app.get("/api/color-requests/:id/swatch", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
    const request = await accessibleRequest(req, req.params.id);
    if (!request.hex_code) throw httpError(404, "This request has no generated swatch");
    const png = await swatchPng(request.hex_code);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    if (req.query.download === "1") res.setHeader("Content-Disposition", contentDisposition(`${request.hex_code.slice(1)}-swatch.png`));
    res.send(png);
  }));

  app.post("/api/color-requests/:id/deliveries", requireRole("ADMIN"), upload.single("file"), asyncRoute(async (req, res) => {
    if (!req.file) throw httpError(400, "Upload a JPG, PNG, TIFF, PSD, or PSB delivery");
    let destination = null;
    let committed = false;
    try {
      const request = await accessibleRequest(req, req.params.id);
      const category = referenceCategory(req.body.kind, req.body.label);
      if (!category) throw httpError(400, req.body.kind === "OTHER" ? "Enter a name for the new reference type" : "Choose a reference type");
      const profile = await inspectImageFile(req.file.path);
      if (!profile.accepted) throw httpError(400, profile.reason);
      const deliveryId = crypto.randomUUID();
      const extension = path.extname(originalName(req.file)).toLowerCase() || ".bin";
      await db.transaction(async client => {
        const locked = (await client.query("SELECT * FROM color_requests WHERE id=$1 FOR UPDATE", [request.id])).rows[0];
        const existing = (await client.query(
          "SELECT id, status, reference_kind, reference_label FROM color_request_deliveries WHERE request_id=$1",
          [request.id]
        )).rows;
        uploadDelivery(locked, existing, category.key);
        const next = Number((await client.query(
          `SELECT coalesce(max(version_number),0)+1 AS next
           FROM color_request_deliveries
           WHERE request_id=$1 AND reference_kind=$2 AND reference_label=$3`,
          [request.id, category.kind, category.label]
        )).rows[0].next);
        const relativePath = storedPath(request.client_code, request.id, `v${next}-${deliveryId}${extension}`).replace(/\\/g, "/");
        destination = await moveUpload(req.file, relativePath);
        const checksum = await fileChecksum(destination);
        const note = cleanString(req.body.uploadNote || req.body.note, 5000);
        await client.query(
          `INSERT INTO color_request_deliveries(
             id, request_id, version_number, status, reference_kind, reference_label, original_filename, storage_path, mime_type, size_bytes, checksum_sha256, profile_label, upload_note, uploaded_by
           ) VALUES($1,$2,$3,'IN_REVIEW',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [deliveryId, request.id, next, category.kind, category.label, originalName(req.file), relativePath, req.file.mimetype || "application/octet-stream", req.file.size, checksum, profile.label, note, req.user.id]
        );
        await client.query("UPDATE color_requests SET status='IN_PROGRESS', updated_at=now() WHERE id=$1", [request.id]);
        await writeAudit(client, req, {
          clientId: request.client_id,
          entityType: "color_request",
          entityId: request.id,
          action: "UPLOAD",
          after: { deliveryId, version: next, profile: profile.label, referenceKind: category.kind, referenceLabel: category.label }
        });
        await recordActivity(client, {
          actor: req.user,
          clientId: request.client_id,
          requestId: request.id,
          eventType: "REFERENCE_UPLOADED",
          subjectType: "color_request_delivery",
          subjectId: deliveryId,
          metadata: { filename: originalName(req.file), version: next, referenceKind: category.kind, referenceLabel: category.label },
          targetUrl: `/requests/${request.id}?client=${request.client_id}`
        });
      });
      committed = true;
      cachedPreview(config.storageRoot, destination, deliveryId).catch(error => {
        console.warn("Delivery preview could not be prepared", deliveryId, error.message);
      });
      res.status(201).json({ request: await requestDetail(request.id) });
    } catch (error) {
      if (!committed) {
        if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
        if (destination) await fs.unlink(destination).catch(() => {});
      }
      throw error;
    }
  }));

  app.post("/api/color-requests/:id/deliveries/:versionId/withdraw", requireRole("ADMIN"), asyncRoute(async (req, res) => {
    const request = await accessibleRequest(req, req.params.id);
    if (!isUuid(req.params.versionId)) throw httpError(404, "Delivery not found");
    await db.transaction(async client => {
      const locked = (await client.query("SELECT * FROM color_requests WHERE id=$1 FOR UPDATE", [request.id])).rows[0];
      const deliveries = (await client.query("SELECT id, status FROM color_request_deliveries WHERE request_id=$1", [request.id])).rows;
      const decision = withdrawDelivery(locked, deliveries, req.params.versionId);
      await client.query("UPDATE color_request_deliveries SET status='WITHDRAWN' WHERE id=$1", [decision.deliveryId]);
      await client.query("UPDATE color_requests SET status=$1, updated_at=now() WHERE id=$2", [decision.status, request.id]);
      await writeAudit(client, req, {
        clientId: request.client_id,
        entityType: "color_request",
        entityId: request.id,
        action: "WITHDRAW",
        after: { deliveryId: decision.deliveryId }
      });
      await recordActivity(client, {
        actor: req.user,
        clientId: request.client_id,
        requestId: request.id,
        eventType: "REFERENCE_WITHDRAWN",
        subjectType: "color_request_delivery",
        subjectId: decision.deliveryId,
        metadata: { colorName: request.color_name || request.proposed_name },
        targetUrl: `/requests/${request.id}?client=${request.client_id}`
      });
    });
    res.json({ request: await requestDetail(request.id) });
  }));

  app.post("/api/color-requests/:id/changes", requireRole("CLIENT"), asyncRoute(async (req, res) => {
    const request = await accessibleRequest(req, req.params.id);
    const commentBody = cleanString(req.body.comment, 5000);
    if (!commentBody) throw httpError(400, "Describe the changes needed so the administrator can prepare the next version");
    await db.transaction(async client => {
      const locked = (await client.query("SELECT * FROM color_requests WHERE id=$1 FOR UPDATE", [request.id])).rows[0];
      const deliveries = (await client.query("SELECT id, status FROM color_request_deliveries WHERE request_id=$1 ORDER BY version_number", [request.id])).rows;
      const decision = requestChanges(locked, deliveries);
      await client.query("UPDATE color_request_deliveries SET status='NEEDS_CHANGES' WHERE request_id=$1 AND id = ANY($2::uuid[])", [request.id, decision.deliveryIds]);
      await client.query("UPDATE color_requests SET status=$1, updated_at=now() WHERE id=$2", [decision.status, request.id]);
      const comment = (await client.query(
        `INSERT INTO color_request_comments(request_id,delivery_id,author_id,body)
         VALUES($1,NULL,$2,$3) RETURNING id`,
        [request.id, req.user.id, commentBody]
      )).rows[0];
      await writeAudit(client, req, {
        clientId: request.client_id,
        entityType: "color_request",
        entityId: request.id,
        action: "REQUEST_CHANGES",
        before: { status: locked.status },
        after: { status: decision.status, deliveryId: decision.deliveryId, commentId: comment.id }
      });
      await recordActivity(client, {
        actor: req.user,
        clientId: request.client_id,
        requestId: request.id,
        eventType: "CHANGES_REQUESTED",
        subjectType: "color_request",
        subjectId: request.id,
        metadata: { colorName: request.color_name || request.proposed_name, comment: commentBody, deliveryIds: decision.deliveryIds },
        targetUrl: `/requests/${request.id}?client=${request.client_id}`
      });
    });
    res.json({ request: await requestDetail(request.id) });
  }));

  app.post("/api/color-requests/:id/approve", requireRole("CLIENT"), asyncRoute(async (req, res) => {
    const request = await accessibleRequest(req, req.params.id);
    const copiedPaths = [];
    let published;
    try {
      published = await db.transaction(async client => {
        const locked = (await client.query(
          `SELECT r.*, cl.code AS client_code
           FROM color_requests r JOIN clients cl ON cl.id=r.client_id
           WHERE r.id=$1 FOR UPDATE`,
          [request.id]
        )).rows[0];
        const deliveries = (await client.query("SELECT * FROM color_request_deliveries WHERE request_id=$1 ORDER BY version_number", [request.id])).rows;
        const decision = approveRequest(locked, deliveries);
        const publishing = deliveries.filter(item => decision.deliveryIds.includes(item.id));
        let colorId = locked.color_id;
        let colorName;
        if (!colorId) {
          try {
            colorId = (await client.query(
              `INSERT INTO colors(client_id, name, normalized_key, color_code, hex_code, instructions, created_by)
               VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
              [locked.client_id, locked.proposed_name, normalizeKey(locked.proposed_name), locked.pantone || null, locked.hex_code || "", locked.note, locked.created_by]
            )).rows[0].id;
          } catch (error) {
            if (error.code === "23505") {
              throw httpError(409, error.constraint === "colors_client_hex_active"
                ? `Hex code ${locked.hex_code} already exists in Approved colors.`
                : "A color with this name is already in Approved colors. Choose another name.");
            }
            throw error;
          }
          colorName = locked.proposed_name;
        } else {
          const color = (await client.query("SELECT id, name, archived_at FROM colors WHERE id=$1 AND client_id=$2 FOR UPDATE", [colorId, locked.client_id])).rows[0];
          if (!color) throw httpError(404, "Approved color not found");
          if (color.archived_at) throw httpError(409, "Restore this color before approving a new version of it");
          colorName = color.name;
        }
        if (locked.hex_code) {
          const taken = await libraryColorByHex(client, locked.client_id, locked.hex_code);
          if (taken && taken.id !== colorId) throw httpError(409, `Hex code ${locked.hex_code} already exists in Approved colors on ${taken.name}.`);
          await client.query("UPDATE colors SET hex_code=$1, updated_at=now() WHERE id=$2 AND hex_code=''", [locked.hex_code, colorId]);
        }
        const versions = [];
        for (const delivery of publishing) {
          const kind = delivery.reference_kind || "FULL";
          const label = delivery.reference_label || "";
          let reference = (await client.query(
            "SELECT id, active_approved_version_id FROM color_references WHERE color_id=$1 AND kind=$2 AND label=$3 FOR UPDATE",
            [colorId, kind, label]
          )).rows[0];
          if (!reference) {
            reference = (await client.query(
              "INSERT INTO color_references(color_id, kind, label) VALUES($1,$2,$3) RETURNING id, active_approved_version_id",
              [colorId, kind, label]
            )).rows[0];
          }
          const nextVersion = Number((await client.query(
            `SELECT coalesce(min(candidate),1) AS next
             FROM generate_series(1,(SELECT coalesce(max(version_number),0)+1 FROM reference_versions WHERE reference_id=$1)) candidate
             LEFT JOIN reference_versions v ON v.reference_id=$1 AND v.version_number=candidate
             WHERE v.id IS NULL`,
            [reference.id]
          )).rows[0].next);
          const versionId = crypto.randomUUID();
          const extension = path.extname(delivery.original_filename).toLowerCase() || ".bin";
          const relativeStorage = path.join("assets", locked.client_code, colorId, reference.id, `v${nextVersion}-${versionId}${extension}`).replace(/\\/g, "/");
          const destination = path.join(config.storageRoot, relativeStorage);
          ensureInside(config.storageRoot, destination);
          const source = path.resolve(config.storageRoot, delivery.storage_path);
          ensureInside(config.storageRoot, source);
          await fs.mkdir(path.dirname(destination), { recursive: true });
          copiedPaths.push(destination);
          await fs.copyFile(source, destination);
          await client.query(
            `INSERT INTO reference_versions(
               id, reference_id, version_number, status, original_filename, storage_path, mime_type, size_bytes, checksum_sha256, upload_note, uploaded_by, approved_by, approved_at
             ) VALUES($1,$2,$3,'APPROVED',$4,$5,$6,$7,$8,$9,$10,$11,now())`,
            [versionId, reference.id, nextVersion, delivery.original_filename, relativeStorage, delivery.mime_type, delivery.size_bytes, delivery.checksum_sha256, delivery.upload_note, delivery.uploaded_by, req.user.id]
          );
          await client.query("UPDATE reference_versions SET status='UNAPPROVED' WHERE reference_id=$1 AND status='APPROVED' AND id<>$2", [reference.id, versionId]);
          await client.query("UPDATE color_references SET active_approved_version_id=$1, updated_at=now() WHERE id=$2", [versionId, reference.id]);
          versions.push({
            versionId,
            deliveryId: delivery.id,
            previousApprovedVersionId: reference.active_approved_version_id
          });
        }
        await client.query("UPDATE color_request_deliveries SET status='APPROVED' WHERE request_id=$1 AND id = ANY($2::uuid[])", [locked.id, decision.deliveryIds]);
        await client.query(
          "UPDATE color_requests SET status='APPROVED', color_id=$1, proposed_name=NULL, published_version_id=$2, updated_at=now() WHERE id=$3",
          [colorId, versions[0].versionId, locked.id]
        );
        await writeAudit(client, req, {
          clientId: locked.client_id,
          entityType: "color_request",
          entityId: locked.id,
          action: "APPROVE",
          after: { colorId, colorName, versions }
        });
        await client.query(
          `INSERT INTO pixofix_colors(hex_code,name,created_by)
           VALUES($1,$2,$3) ON CONFLICT(hex_code) DO NOTHING`,
          [locked.hex_code, colorName, req.user.id]
        );
        await recordActivity(client, {
          actor: req.user,
          clientId: locked.client_id,
          requestId: locked.id,
          eventType: "REQUEST_APPROVED",
          subjectType: "color_request",
          subjectId: locked.id,
          metadata: { colorName, hexCode: locked.hex_code, colorId },
          targetUrl: `/requests/${locked.id}?client=${locked.client_id}`
        });
        return { colorId, versions };
      });
    } catch (error) {
      for (const copiedPath of copiedPaths) await fs.unlink(copiedPath).catch(() => {});
      throw error;
    }
    let sync = { status: "COMPLETE" };
    try {
      for (const item of published.versions) {
        if (item.previousApprovedVersionId && item.previousApprovedVersionId !== item.versionId) {
          await removeSyncedVersion(item.previousApprovedVersionId);
        }
        await syncApprovedVersion(item.versionId);
      }
    } catch (error) {
      sync = { status: "FAILED", error: error.message };
    }
    const payload = { request: await requestDetail(request.id), sync };
    if (sync.status === "FAILED") return res.status(202).json(payload);
    res.json(payload);
  }));

  app.post("/api/color-requests/:id/comments", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
    const request = await accessibleRequest(req, req.params.id);
    const body = cleanString(req.body.body, 5000);
    if (!body) throw httpError(400, "A comment is required");
    const placement = commentPlacement(req.body);
    const deliveryId = cleanString(req.body.deliveryId, 80);
    let sourceId = cleanString(req.body.sourceId, 80);
    if (deliveryId && sourceId) throw httpError(400, "Choose one image for this comment");
    if (deliveryId) {
      if (!isUuid(deliveryId)) throw httpError(400, "Choose a delivery version for this comment");
      const delivery = (await db.query("SELECT id FROM color_request_deliveries WHERE id=$1 AND request_id=$2", [deliveryId, request.id])).rows[0];
      if (!delivery) throw httpError(404, "Delivery not found");
    }
    if (sourceId) {
      if (!isUuid(sourceId)) throw httpError(400, "Choose an image for this comment");
      const source = (await db.query("SELECT id FROM color_request_sources WHERE id=$1 AND request_id=$2", [sourceId, request.id])).rows[0];
      if (!source) throw httpError(404, "Swatch not found");
    } else sourceId = "";
    const comment = await db.transaction(async client => {
      const row = (await client.query(
        `INSERT INTO color_request_comments(request_id, delivery_id, source_id, author_id, body, pin_x, pin_y)
         VALUES($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, body, delivery_id, source_id, pin_x, pin_y, created_at`,
        [request.id, deliveryId || null, sourceId || null, req.user.id, body, placement.pinX, placement.pinY]
      )).rows[0];
      await writeAudit(client, req, {
        clientId: request.client_id,
        entityType: "color_request",
        entityId: request.id,
        action: "COMMENT",
        after: { commentId: row.id, deliveryId: deliveryId || null, sourceId: sourceId || null, pinX: placement.pinX, pinY: placement.pinY }
      });
      await recordActivity(client, {
        actor: req.user,
        clientId: request.client_id,
        requestId: request.id,
        eventType: "COMMENT_ADDED",
        subjectType: "color_request_comment",
        subjectId: row.id,
        metadata: { colorName: request.color_name || request.proposed_name, body, deliveryId: deliveryId || null, sourceId: sourceId || null, pinX: placement.pinX, pinY: placement.pinY },
        targetUrl: `/requests/${request.id}?client=${request.client_id}`
      });
      return row;
    });
    res.status(201).json({
      comment: presentComment({ ...comment, author_name: req.user.display_name, author_email: req.user.email, author_role: req.user.role })
    });
  }));

  async function sourceFile(req, sourceId) {
    const request = await accessibleRequest(req, req.params.id);
    const params = [request.id];
    let sql = "SELECT * FROM color_request_sources WHERE request_id=$1";
    if (sourceId) {
      if (!isUuid(sourceId)) throw httpError(404, "Swatch not found");
      params.push(sourceId);
      sql += " AND id=$2";
    }
    sql += " ORDER BY created_at LIMIT 1";
    const source = (await db.query(sql, params)).rows[0];
    if (!source) throw httpError(404, "Swatch not found");
    return source;
  }

  async function deliveryFile(req) {
    await accessibleRequest(req, req.params.id);
    if (!isUuid(req.params.versionId)) throw httpError(404, "Delivery not found");
    const delivery = (await db.query(
      "SELECT * FROM color_request_deliveries WHERE id=$1 AND request_id=$2",
      [req.params.versionId, req.params.id]
    )).rows[0];
    if (!delivery) throw httpError(404, "Delivery not found");
    return delivery;
  }

  function sendDownload(res, record) {
    const assetPath = path.resolve(config.storageRoot, record.storage_path);
    ensureInside(config.storageRoot, assetPath);
    res.setHeader("Content-Disposition", contentDisposition(record.original_filename));
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.sendFile(assetPath);
  }

  app.get("/api/color-requests/:id/source", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
    sendDownload(res, await sourceFile(req));
  }));

  app.get("/api/color-requests/:id/sources/:sourceId", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
    sendDownload(res, await sourceFile(req, req.params.sourceId));
  }));

  app.get("/api/color-requests/:id/deliveries/:versionId", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
    sendDownload(res, await deliveryFile(req));
  }));

  async function sendPreview(res, record) {
    const assetPath = path.resolve(config.storageRoot, record.storage_path);
    ensureInside(config.storageRoot, assetPath);
    try {
      const previewPath = await cachedPreview(config.storageRoot, assetPath, record.id);
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.setHeader("Content-Type", "image/jpeg");
      res.sendFile(previewPath);
    } catch (error) {
      console.warn("Request preview unavailable", record.id, error.message);
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.type("image/svg+xml").send('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 720"><rect width="720" height="720" fill="#24282d"/><text x="360" y="360" text-anchor="middle" fill="#aeb5bd" font-family="Arial" font-size="28">Preview unavailable</text></svg>');
    }
  }

  async function sendDisplay(res, record) {
    const assetPath = path.resolve(config.storageRoot, record.storage_path);
    ensureInside(config.storageRoot, assetPath);
    const display = await displayImage(config.storageRoot, assetPath, record.id);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("Content-Type", display.contentType);
    res.sendFile(display.path);
  }

  app.get("/api/color-requests/:id/source/preview", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
    await sendPreview(res, await sourceFile(req));
  }));

  app.get("/api/color-requests/:id/sources/:sourceId/preview", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
    await sendPreview(res, await sourceFile(req, req.params.sourceId));
  }));

  app.get("/api/color-requests/:id/deliveries/:versionId/preview", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
    await sendPreview(res, await deliveryFile(req));
  }));

  app.get("/api/color-requests/:id/source/display", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
    await sendDisplay(res, await sourceFile(req));
  }));

  app.get("/api/color-requests/:id/sources/:sourceId/display", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
    await sendDisplay(res, await sourceFile(req, req.params.sourceId));
  }));

  app.get("/api/color-requests/:id/deliveries/:versionId/display", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
    await sendDisplay(res, await deliveryFile(req));
  }));
}

module.exports = { registerColorRequests };
