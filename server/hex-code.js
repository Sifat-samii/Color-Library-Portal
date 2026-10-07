function normalizeHex(value) {
  const match = String(value || "").trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return "";
  let hex = match[1].toUpperCase();
  if (hex.length === 3) hex = hex.split("").map(char => char + char).join("");
  return `#${hex}`;
}

module.exports = { normalizeHex };
