const db = require("./db");
const { requireRole } = require("./security");

function presentNotification(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    targetUrl: row.target_url,
    readAt: row.read_at,
    createdAt: row.created_at,
    actorName: row.actor_name || row.actor_email || "Color Library"
  };
}

function registerNotifications(app, { asyncRoute }) {
  app.get("/api/notifications", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 30)));
    const [items, unread] = await Promise.all([
      db.query(
        `SELECT n.*,u.display_name AS actor_name,u.email AS actor_email
         FROM notifications n
         JOIN activity_events e ON e.id=n.activity_event_id
         LEFT JOIN users u ON u.id=e.actor_user_id
         WHERE n.recipient_user_id=$1
         ORDER BY n.created_at DESC
         LIMIT $2`,
        [req.user.id, limit]
      ),
      db.query("SELECT count(*)::int AS count FROM notifications WHERE recipient_user_id=$1 AND read_at IS NULL", [req.user.id])
    ]);
    res.setHeader("Cache-Control", "no-store");
    res.json({ notifications: items.rows.map(presentNotification), unreadCount: Number(unread.rows[0].count) });
  }));

  app.post("/api/notifications/:id/read", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
    const notification = (await db.query(
      `UPDATE notifications SET read_at=coalesce(read_at,now())
       WHERE id=$1 AND recipient_user_id=$2
       RETURNING *`,
      [req.params.id, req.user.id]
    )).rows[0];
    if (!notification) return res.status(404).json({ error: "Notification not found" });
    res.json({ notification: presentNotification(notification) });
  }));

  app.post("/api/notifications/read-all", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
    const result = await db.query(
      "UPDATE notifications SET read_at=now() WHERE recipient_user_id=$1 AND read_at IS NULL",
      [req.user.id]
    );
    res.json({ ok: true, updated: result.rowCount });
  }));
}

module.exports = { registerNotifications, presentNotification };
