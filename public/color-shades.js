const COLOR_SHADES = [
  { id: "red", label: "Red", dot: "#E53935" },
  { id: "orange", label: "Orange", dot: "#FB8C00" },
  { id: "brown", label: "Brown", dot: "#8D6E63" },
  { id: "yellow", label: "Yellow", dot: "#FDD835" },
  { id: "green", label: "Green", dot: "#43A047" },
  { id: "turquoise", label: "Turquoise", dot: "#26C6DA" },
  { id: "blue", label: "Blue", dot: "#1E88E5" },
  { id: "violet", label: "Violet", dot: "#8E24AA" },
  { id: "pink", label: "Pink", dot: "#EC407A" },
  { id: "white", label: "White", dot: "#FFFFFF" },
  { id: "gray", label: "Gray", dot: "#9E9E9E" },
  { id: "black", label: "Black", dot: "#212121" }
];

const shadeIds = COLOR_SHADES.map(shade => shade.id);

function colorShadeIds() {
  return shadeIds.slice();
}

function normalizeShadeId(value) {
  const shade = String(value || "").trim().toLowerCase();
  return shadeIds.includes(shade) ? shade : "";
}

function shadeLabel(value) {
  const shade = COLOR_SHADES.find(item => item.id === normalizeShadeId(value));
  return shade ? shade.label : "";
}

function hexChannels(value) {
  const match = String(value || "").trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) hex = hex.split("").map(char => char + char).join("");
  return [0, 2, 4].map(index => Number.parseInt(hex.slice(index, index + 2), 16));
}

function rgbToHsl(r, g, b) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l: lightness };
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (max === red) hue = ((green - blue) / delta) % 6;
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return { h: hue, s: saturation, l: lightness };
}

function shadeIdForHex(value) {
  const channels = hexChannels(value);
  if (!channels) return "";
  const [red, green, blue] = channels;
  const { h, s, l } = rgbToHsl(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = Math.max(red, green, blue) - min;
  if (l <= 0.08 || (l <= 0.14 && delta <= 28)) return "black";
  if (min >= 228 && delta <= 36) return "white";
  if (l >= 0.88 && delta <= 62 && (h < 48 || h > 72)) return "white";
  if (l >= 0.94 && delta <= 20) return "white";
  if (delta <= 16) return l >= 0.9 ? "white" : l <= 0.12 ? "black" : "gray";
  if (s <= 0.16 && delta <= 40 && l >= 0.16 && l <= 0.92) return "gray";
  const warm = h >= 8 && h <= 42;
  if (warm && l >= 0.16 && l <= 0.62 && s <= 0.8 && s >= 0.28) return "brown";
  if (h <= 16 && l >= 0.2 && l <= 0.46 && s >= 0.35 && s <= 0.65) return "brown";
  if (warm && l > 0.55 && l < 0.78 && s <= 0.62) return "brown";
  if ((h >= 330 || h <= 12) && l >= 0.72 && s >= 0.2) return "pink";
  if (h >= 316 && h < 345 && l >= 0.55 && s >= 0.28) return "pink";
  if (h < 15 || h >= 345) return "red";
  if (h < 42) return "orange";
  if (h < 70) return "yellow";
  if (h < 165) return "green";
  if (h < 195) return "turquoise";
  if (h < 252) return "blue";
  if (h < 316) return "violet";
  return "pink";
}

const NAME_CUES = [
  ["red", ["red", "cherry", "tomato", "cranberry", "garnet", "carmine", "wine", "paprika", "picante"]],
  ["orange", ["orange", "coral", "peach", "papaya", "tangerine", "butterscotch", "ginger", "sunrise", "solar"]],
  ["brown", ["brown", "chocolate", "mocha", "truffle", "taupe", "taup", "khaki", "tan", "sand", "carmel", "caramel", "cafe", "roast", "walnut", "redwood"]],
  ["yellow", ["yellow", "gold", "maize", "saffron", "buttercream", "starfruit", "lemon"]],
  ["green", ["green", "olive", "lime", "mint", "sage", "pine", "fern", "apple", "kiwi", "wasabi", "melon", "moss", "forest", "hunter"]],
  ["turquoise", ["turquoise", "aquamarine", "aqumarine", "aqua", "teal", "cyan"]],
  ["blue", ["blue", "navy", "periwinkle", "ceil", "marine", "oceanus", "midnight", "royal"]],
  ["violet", ["violet", "purple", "amethyst", "lavender", "lilac", "plum", "orchid", "mauve", "grape", "indigo", "eggplant", "elderberry", "mulberry"]],
  ["pink", ["pink", "pinkerton", "fuchsia", "hibiscus", "rose", "carnation", "salt"]],
  ["white", ["white", "cloud"]],
  ["gray", ["gray", "grey", "silver", "pewter", "slate", "fog"]],
  ["black", ["black"]]
];

function shadeIdForName(value) {
  const words = String(value || "").toLowerCase().match(/[a-z]+/g) || [];
  const hits = [];
  words.forEach((word, index) => {
    for (const [shade, cues] of NAME_CUES) {
      if (cues.includes(word)) hits.push({ shade, index });
    }
  });
  if (!hits.length) return "";
  const shades = new Set(hits.map(hit => hit.shade));
  if (shades.has("turquoise") && shades.has("blue")) return "turquoise";
  if (shades.has("violet") && shades.has("blue")) return "violet";
  if (shades.has("brown") && shades.has("pink")) return "brown";
  if (shades.has("green") && shades.has("pink")) return "pink";
  hits.sort((a, b) => b.index - a.index);
  return hits[0].shade;
}

function shadeIdForColor(color) {
  const fromHex = shadeIdForHex(color && color.hexCode);
  return fromHex || shadeIdForName(color && color.name);
}

function shadeDotStyle(hex) {
  const fallback = String(hex || "#ccc");
  const a98 = typeof globalThis.adobeRgbCss === "function" ? globalThis.adobeRgbCss(fallback) : "";
  return `--shade-dot:${fallback}${a98 ? `;--shade-dot-a98:${a98}` : ""}`;
}

function shadeFiltersMarkup(selected) {
  const current = normalizeShadeId(selected);
  const buttons = COLOR_SHADES.map((shade, index) => {
    const pressed = shade.id === current;
    return `<button class="shade-filter${pressed ? " is-selected" : ""}" type="button" data-shade="${shade.id}" aria-pressed="${pressed ? "true" : "false"}" style="--shade-i:${index}"><span class="shade-dot" style="${shadeDotStyle(shade.dot)}"></span>${shade.label}</button>`;
  }).join("");
  return `<div class="shade-filters" role="group" aria-label="Shade filters">${buttons}</div>`;
}

function paintShadeFilters(selected) {
  const current = normalizeShadeId(selected);
  document.querySelectorAll(".shade-filters [data-shade]").forEach(button => {
    const pressed = button.dataset.shade === current;
    button.classList.toggle("is-selected", pressed);
    button.setAttribute("aria-pressed", pressed ? "true" : "false");
  });
}

Object.assign(globalThis, {
  COLOR_SHADES,
  colorShadeIds,
  normalizeShadeId,
  shadeLabel,
  shadeIdForHex,
  shadeIdForName,
  shadeIdForColor,
  shadeDotStyle,
  shadeFiltersMarkup,
  paintShadeFilters
});

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    COLOR_SHADES,
    colorShadeIds,
    normalizeShadeId,
    shadeLabel,
    shadeIdForHex,
    shadeIdForName,
    shadeIdForColor,
    shadeDotStyle,
    shadeFiltersMarkup,
    paintShadeFilters
  };
}
