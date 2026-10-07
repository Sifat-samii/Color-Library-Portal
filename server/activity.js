const db = require("./db");

const EVENT_COPY = {
  REQUEST_CREATED: metadata => ({
    title: "New color request",
    body: `${metadata.actorName} requested ${metadata.colorName || metadata.hexCode || "a color"}.`
  }),
  REFERENCE_UPLOADED: metadata => ({
    title: "Reference ready for review",
    body: `${metadata.actorName} uploaded ${metadata.filename || "a new reference version"}.`
  }),
  REFERENCE_WITHDRAWN: metadata => ({
    title: "Reference withdrawn",
    body: `${metadata.actorName} withdrew a reference version from review.`
  }),
  CHANGES_REQUESTED: metadata => ({
    title: "Changes requested",
    body: `${metadata.actorName} requested changes${metadata.colorName ? ` for ${metadata.colorName}` : ""}.`
  }),
  REQUEST_APPROVED: metadata => ({
    title: "Color approved",
    body: `${metadata.actorName} approved ${metadata.colorName || "the color reference"}.`
  }),
  COMMENT_ADDED: metadata => ({
    title: "New request comment",
    body: `${metadata.actorName} commented on ${metadata.colorName || "a color request"}.`
  }),
  ACCESS_REQUESTED: metadata => ({
    title: "Representative access requested",
    body: `${metadata.actorName} requested access for ${metadata.displayName || metadata.email}.`
  }),
  ACCESS_AUTHORIZED: metadata => ({
    title: "Representative authorized",
    body: `${metadata.actorName} authorized ${metadata.displayName || metadata.email}.`
  }),
  ACCESS_DISMISSED: metadata => ({
    title: "Access request dismissed",
    body: `${metadata.actorName} dismissed the request for ${metadata.displayName || metadata.email}.`
  }),
  REPRESENTATIVE_ADDED: metadata => ({
    title: "Representative added",
    body: `${metadata.actorName} added ${metadata.displayName || metadata.email}.`
  }),
  REPRESENTATIVE_UPDATED: metadata => ({
    title: "Representative access updated",
    body: `${metadata.actorName} updated access for ${metadata.displayName || metadata.email}.`
  })
};

function cleanPath(path) {
  const value = String(path || "/");
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function eventCopy(eventType, metadata = {}) {
  const builder = EVENT_COPY[eventType];
  return builder ? builder(metadata) : {
    title: "Color Library update",
    body: `${metadata.actorName || "Someone"} updated the Color Library.`
  };
}

async function recordActivity(executor, event) {
  const actorId = event.actor?.id || event.actorUserId || null;
  const actorName = event.actor?.display_name || event.actor?.displayName || event.actor?.email || "Someone";
  const metadata = { ...(event.metadata || {}), actorName };
  const row = (await executor.query(
    `INSERT INTO activity_events(client_id, request_id, actor_user_id, event_type, subject_type, subject_id, metadata)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [event.clientId || null, event.requestId || null, actorId, event.eventType, event.subjectType, String(event.subjectId), metadata]
  )).rows[0];

  if (event.notify === false) return row;
  const recipients = (await executor.query(
    `SELECT id FROM users
     WHERE active=true
       AND (role='ADMIN' OR ($1::uuid IS NOT NULL AND client_id=$1))
       AND ($2::uuid IS NULL OR id<>$2)`,
    [event.clientId || null, actorId]
  )).rows;
  if (!recipients.length) return row;

  const copy = eventCopy(event.eventType, metadata);
  const targetUrl = cleanPath(event.targetUrl || (event.requestId
    ? `/requests/${event.requestId}${event.clientId ? `?client=${event.clientId}` : ""}`
    : event.clientId ? `/profile?client=${event.clientId}` : "/"));
  await executor.query(
    `INSERT INTO notifications(recipient_user_id, activity_event_id, kind, title, body, target_url)
     SELECT unnest($1::uuid[]),$2,$3,$4,$5,$6
     ON CONFLICT (recipient_user_id, activity_event_id) DO NOTHING`,
    [recipients.map(recipient => recipient.id), row.id, event.eventType, copy.title, copy.body, targetUrl]
  );
  return row;
}

async function requestActivity(requestId) {
  const result = await db.query(
    `SELECT e.id,e.event_type,e.subject_type,e.subject_id,e.metadata,e.created_at,
            u.id AS actor_id,u.display_name AS actor_name,u.email AS actor_email,u.role AS actor_role
     FROM activity_events e
     LEFT JOIN users u ON u.id=e.actor_user_id
     WHERE e.request_id=$1
     ORDER BY e.created_at,e.id`,
    [requestId]
  );
  return result.rows.map(row => ({
    id: row.id,
    type: row.event_type,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    actor: {
      id: row.actor_id,
      name: row.actor_name || row.actor_email || row.metadata?.actorName || "Former user",
      email: row.actor_email || "",
      role: row.actor_role || ""
    }
  }));
}

module.exports = { recordActivity, requestActivity, eventCopy, cleanPath };
