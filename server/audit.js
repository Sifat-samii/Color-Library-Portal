async function writeAudit(db, req, event) {
  await db.query(
    `INSERT INTO audit_events(actor_user_id, client_id, entity_type, entity_id, action, before_data, after_data, ip_address)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      req.user ? req.user.id : null,
      event.clientId || (req.user && req.user.client_id) || null,
      event.entityType,
      String(event.entityId),
      event.action,
      event.before || null,
      event.after || null,
      req.ip
    ]
  );
}

module.exports = { writeAudit };
