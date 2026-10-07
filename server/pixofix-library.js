const fs = require("fs/promises");
const path = require("path");
const config = require("./config");
const db = require("./db");
const { writeAudit } = require("./audit");
const { requireRole } = require("./security");
const { shadeIdForColor } = require("../public/color-shades");
const { normalizeHex } = require("./hex-code");
const { nameForHex, suggestedNameForHex } = require("./css-color-names");
const { ADOBE_RGB_NAME } = require("../public/adobe-rgb");
const { swatchPng } = require("./adobe-rgb-swatch");
const COLOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const inFlight = new Map();

function isColorId(value) {
  return COLOR_ID.test(String(value || ""));
}

function pluginSwatchJson(row) {
  const hexCode = row.hex_code || row.hexCode || "";
  const name = row.name || "";
  return {
    id: row.id,
    hexCode,
    name,
    shade: shadeIdForColor({ hexCode, name })
  };
}

function colorJson(row) {
  return {
    id: row.id,
    hexCode: row.hex_code,
    name: row.name,
    saved: Boolean(row.saved),
    profile: ADOBE_RGB_NAME,
    swatchUrl: `/api/pixofix/colors/${row.id}/swatch?profile=adobe-rgb-1998`
  };
}

function swatchPath(hexCode) {
  const normalized = normalizeHex(hexCode);
  if (!normalized) {
    const error = new Error("Enter a valid hex code");
    error.status = 400;
    throw error;
  }
  return path.join(config.storageRoot, "pixofix-swatches", "adobe-rgb-1998", `${normalized.slice(1)}.png`);
}

function legacySwatchPath(hexCode) {
  const normalized = normalizeHex(hexCode);
  if (!normalized) return "";
  return path.join(config.storageRoot, "pixofix-swatches", `${normalized.slice(1)}.jpg`);
}

async function ensureSwatch(hexCode) {
  const filePath = swatchPath(hexCode);
  try {
    await fs.access(filePath);
    return filePath;
  } catch (_error) {
    // Generate below.
  }
  if (inFlight.has(filePath)) return inFlight.get(filePath);
  const pending = (async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}-${Date.now()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, await swatchPng(hexCode));
      await fs.rename(temporaryPath, filePath);
      return filePath;
    } catch (error) {
      await fs.unlink(temporaryPath).catch(() => {});
      throw error;
    }
  })().finally(() => inFlight.delete(filePath));
  inFlight.set(filePath, pending);
  return pending;
}

function registerPixofixLibrary(app, { asyncRoute }) {
  app.get("/api/plugin/swatches", asyncRoute(async (_req, res) => {
    const result = await db.query("SELECT id, hex_code, name FROM pixofix_colors ORDER BY name, hex_code");
    res.json({ colors: result.rows.map(pluginSwatchJson) });
  }));

  app.get("/api/plugin/swatches/:id/image", asyncRoute(async (req, res) => {
    if (!isColorId(req.params.id)) return res.status(404).json({ error: "Color not found" });
    const color = (await db.query("SELECT id, hex_code FROM pixofix_colors WHERE id=$1", [req.params.id])).rows[0];
    if (!color) return res.status(404).json({ error: "Color not found" });
    const filePath = await ensureSwatch(color.hex_code);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.sendFile(filePath);
  }));

  app.get("/api/pixofix/colors", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
    const result = await db.query(
      `SELECT c.id, c.hex_code, c.name,
              EXISTS(SELECT 1 FROM pixofix_saves s WHERE s.color_id = c.id AND s.user_id = $1) AS saved
       FROM pixofix_colors c
       ORDER BY c.name, c.hex_code`,
      [req.user.id]
    );
    res.json({ colors: result.rows.map(colorJson) });
  }));

  app.get("/api/pixofix/colors/:id/swatch", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
    if (!isColorId(req.params.id)) {
      return res.status(404).json({ error: "Color not found" });
    }
    const color = (await db.query("SELECT id, hex_code FROM pixofix_colors WHERE id=$1", [req.params.id])).rows[0];
    if (!color) return res.status(404).json({ error: "Color not found" });
    const filePath = await ensureSwatch(color.hex_code);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.sendFile(filePath);
  }));

  app.get("/api/pixofix/color-name", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
    const name = suggestedNameForHex(req.query.hexCode);
    if (!name) return res.status(400).json({ error: "Enter a valid hex code" });
    res.json({ name, profile: ADOBE_RGB_NAME });
  }));

  app.post("/api/pixofix/colors", requireRole("ADMIN"), asyncRoute(async (req, res) => {
    const hexCode = normalizeHex(req.body.hexCode);
    if (!hexCode) return res.status(400).json({ error: "Enter a valid hex code" });
    const name = colorNameFromBody(req.body.name, hexCode);
    if (!name) return res.status(400).json({ error: "Color name is required" });
    try {
      const inserted = await db.query(
        "INSERT INTO pixofix_colors(hex_code, name, created_by) VALUES($1, $2, $3) RETURNING id, hex_code, name",
        [hexCode, name, req.user.id]
      );
      const color = inserted.rows[0];
      await writeAudit(db, req, {
        clientId: null,
        entityType: "pixofix_color",
        entityId: color.id,
        action: "CREATE",
        after: { hexCode: color.hex_code, name: color.name }
      });
      res.status(201).json(colorJson(color));
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ error: "This hex is already in Explore swatches" });
      throw error;
    }
  }));

  app.post("/api/pixofix/colors/:id/save", requireRole("CLIENT", "ADMIN"), asyncRoute(async (req, res) => {
    if (!isColorId(req.params.id)) return res.status(404).json({ error: "Color not found" });
    if (typeof req.body.saved !== "boolean") return res.status(400).json({ error: "Choose whether to save this swatch" });
    const color = (await db.query("SELECT id FROM pixofix_colors WHERE id=$1", [req.params.id])).rows[0];
    if (!color) return res.status(404).json({ error: "Color not found" });
    if (req.body.saved) await db.query("INSERT INTO pixofix_saves(user_id, color_id) VALUES($1, $2) ON CONFLICT DO NOTHING", [req.user.id, color.id]);
    else await db.query("DELETE FROM pixofix_saves WHERE user_id=$1 AND color_id=$2", [req.user.id, color.id]);
    res.json({ saved: req.body.saved });
  }));

  app.post("/api/pixofix/colors/:id/delete", requireRole("ADMIN"), asyncRoute(async (req, res) => {
    if (req.body.confirmation !== "delete") return res.status(400).json({ error: "Type delete to confirm" });
    if (!isColorId(req.params.id)) return res.status(404).json({ error: "Color not found" });
    const color = (await db.query("SELECT id, hex_code, name FROM pixofix_colors WHERE id=$1", [req.params.id])).rows[0];
    if (!color) return res.status(404).json({ error: "Color not found" });
    await db.query("DELETE FROM pixofix_colors WHERE id=$1", [color.id]);
    await writeAudit(db, req, {
      clientId: null,
      entityType: "pixofix_color",
      entityId: color.id,
      action: "DELETE",
      before: { hexCode: color.hex_code, name: color.name }
    });
    await fs.unlink(swatchPath(color.hex_code)).catch(() => {});
    const legacyPath = legacySwatchPath(color.hex_code);
    if (legacyPath) await fs.unlink(legacyPath).catch(() => {});
    res.json({ ok: true });
  }));
}

function colorNameFromBody(value, hexCode) {
  if (value == null) return nameForHex(hexCode);
  return String(value).trim().slice(0, 120);
}

module.exports = { registerPixofixLibrary, nameForHex, ensureSwatch, colorNameFromBody, pluginSwatchJson };
