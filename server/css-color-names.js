const { normalizeHex } = require("./hex-code");
const { labFromHex, deltaE00 } = require("./color-distance");
const { wikipediaColorEntries, wikipediaNameForHex } = require("./wikipedia-color-names");

// CSS Color Level 4 named colors. The first keyword for a shared hex is the stored name.
const CSS_NAMED_COLORS = [
  ["aliceblue", [240, 248, 255], "Alice Blue"],
  ["antiquewhite", [250, 235, 215], "Antique White"],
  ["aqua", [0, 255, 255], "Aqua"],
  ["aquamarine", [127, 255, 212], "Aquamarine"],
  ["azure", [240, 255, 255], "Azure"],
  ["beige", [245, 245, 220], "Beige"],
  ["bisque", [255, 228, 196], "Bisque"],
  ["black", [0, 0, 0], "Black"],
  ["blanchedalmond", [255, 235, 205], "Blanched Almond"],
  ["blue", [0, 0, 255], "Blue"],
  ["blueviolet", [138, 43, 226], "Blue Violet"],
  ["brown", [165, 42, 42], "Brown"],
  ["burlywood", [222, 184, 135], "Burlywood"],
  ["cadetblue", [95, 158, 160], "Cadet Blue"],
  ["chartreuse", [127, 255, 0], "Chartreuse"],
  ["chocolate", [210, 105, 30], "Chocolate"],
  ["coral", [255, 127, 80], "Coral"],
  ["cornflowerblue", [100, 149, 237], "Cornflower Blue"],
  ["cornsilk", [255, 248, 220], "Cornsilk"],
  ["crimson", [220, 20, 60], "Crimson"],
  ["cyan", [0, 255, 255], "Cyan"],
  ["darkblue", [0, 0, 139], "Dark Blue"],
  ["darkcyan", [0, 139, 139], "Dark Cyan"],
  ["darkgoldenrod", [184, 134, 11], "Dark Goldenrod"],
  ["darkgray", [169, 169, 169], "Dark Gray"],
  ["darkgreen", [0, 100, 0], "Dark Green"],
  ["darkgrey", [169, 169, 169], "Dark Grey"],
  ["darkkhaki", [189, 183, 107], "Dark Khaki"],
  ["darkmagenta", [139, 0, 139], "Dark Magenta"],
  ["darkolivegreen", [85, 107, 47], "Dark Olive Green"],
  ["darkorange", [255, 140, 0], "Dark Orange"],
  ["darkorchid", [153, 50, 204], "Dark Orchid"],
  ["darkred", [139, 0, 0], "Dark Red"],
  ["darksalmon", [233, 150, 122], "Dark Salmon"],
  ["darkseagreen", [143, 188, 143], "Dark Sea Green"],
  ["darkslateblue", [72, 61, 139], "Dark Slate Blue"],
  ["darkslategray", [47, 79, 79], "Dark Slate Gray"],
  ["darkslategrey", [47, 79, 79], "Dark Slate Grey"],
  ["darkturquoise", [0, 206, 209], "Dark Turquoise"],
  ["darkviolet", [148, 0, 211], "Dark Violet"],
  ["deeppink", [255, 20, 147], "Deep Pink"],
  ["deepskyblue", [0, 191, 255], "Deep Sky Blue"],
  ["dimgray", [105, 105, 105], "Dim Gray"],
  ["dimgrey", [105, 105, 105], "Dim Grey"],
  ["dodgerblue", [30, 144, 255], "Dodger Blue"],
  ["firebrick", [178, 34, 34], "Firebrick"],
  ["floralwhite", [255, 250, 240], "Floral White"],
  ["forestgreen", [34, 139, 34], "Forest Green"],
  ["fuchsia", [255, 0, 255], "Fuchsia"],
  ["gainsboro", [220, 220, 220], "Gainsboro"],
  ["ghostwhite", [248, 248, 255], "Ghost White"],
  ["gold", [255, 215, 0], "Gold"],
  ["goldenrod", [218, 165, 32], "Goldenrod"],
  ["gray", [128, 128, 128], "Gray"],
  ["green", [0, 128, 0], "Green"],
  ["greenyellow", [173, 255, 47], "Green Yellow"],
  ["grey", [128, 128, 128], "Grey"],
  ["honeydew", [240, 255, 240], "Honeydew"],
  ["hotpink", [255, 105, 180], "Hot Pink"],
  ["indianred", [205, 92, 92], "Indian Red"],
  ["indigo", [75, 0, 130], "Indigo"],
  ["ivory", [255, 255, 240], "Ivory"],
  ["khaki", [240, 230, 140], "Khaki"],
  ["lavender", [230, 230, 250], "Lavender"],
  ["lavenderblush", [255, 240, 245], "Lavender Blush"],
  ["lawngreen", [124, 252, 0], "Lawn Green"],
  ["lemonchiffon", [255, 250, 205], "Lemon Chiffon"],
  ["lightblue", [173, 216, 230], "Light Blue"],
  ["lightcoral", [240, 128, 128], "Light Coral"],
  ["lightcyan", [224, 255, 255], "Light Cyan"],
  ["lightgoldenrodyellow", [250, 250, 210], "Light Goldenrod Yellow"],
  ["lightgray", [211, 211, 211], "Light Gray"],
  ["lightgreen", [144, 238, 144], "Light Green"],
  ["lightgrey", [211, 211, 211], "Light Grey"],
  ["lightpink", [255, 182, 193], "Light Pink"],
  ["lightsalmon", [255, 160, 122], "Light Salmon"],
  ["lightseagreen", [32, 178, 170], "Light Sea Green"],
  ["lightskyblue", [135, 206, 250], "Light Sky Blue"],
  ["lightslategray", [119, 136, 153], "Light Slate Gray"],
  ["lightslategrey", [119, 136, 153], "Light Slate Grey"],
  ["lightsteelblue", [176, 196, 222], "Light Steel Blue"],
  ["lightyellow", [255, 255, 224], "Light Yellow"],
  ["lime", [0, 255, 0], "Lime"],
  ["limegreen", [50, 205, 50], "Lime Green"],
  ["linen", [250, 240, 230], "Linen"],
  ["magenta", [255, 0, 255], "Magenta"],
  ["maroon", [128, 0, 0], "Maroon"],
  ["mediumaquamarine", [102, 205, 170], "Medium Aquamarine"],
  ["mediumblue", [0, 0, 205], "Medium Blue"],
  ["mediumorchid", [186, 85, 211], "Medium Orchid"],
  ["mediumpurple", [147, 112, 219], "Medium Purple"],
  ["mediumseagreen", [60, 179, 113], "Medium Sea Green"],
  ["mediumslateblue", [123, 104, 238], "Medium Slate Blue"],
  ["mediumspringgreen", [0, 250, 154], "Medium Spring Green"],
  ["mediumturquoise", [72, 209, 204], "Medium Turquoise"],
  ["mediumvioletred", [199, 21, 133], "Medium Violet Red"],
  ["midnightblue", [25, 25, 112], "Midnight Blue"],
  ["mintcream", [245, 255, 250], "Mint Cream"],
  ["mistyrose", [255, 228, 225], "Misty Rose"],
  ["moccasin", [255, 228, 181], "Moccasin"],
  ["navajowhite", [255, 222, 173], "Navajo White"],
  ["navy", [0, 0, 128], "Navy"],
  ["oldlace", [253, 245, 230], "Old Lace"],
  ["olive", [128, 128, 0], "Olive"],
  ["olivedrab", [107, 142, 35], "Olive Drab"],
  ["orange", [255, 165, 0], "Orange"],
  ["orangered", [255, 69, 0], "Orange Red"],
  ["orchid", [218, 112, 214], "Orchid"],
  ["palegoldenrod", [238, 232, 170], "Pale Goldenrod"],
  ["palegreen", [152, 251, 152], "Pale Green"],
  ["paleturquoise", [175, 238, 238], "Pale Turquoise"],
  ["palevioletred", [219, 112, 147], "Pale Violet Red"],
  ["papayawhip", [255, 239, 213], "Papaya Whip"],
  ["peachpuff", [255, 218, 185], "Peach Puff"],
  ["peru", [205, 133, 63], "Peru"],
  ["pink", [255, 192, 203], "Pink"],
  ["plum", [221, 160, 221], "Plum"],
  ["powderblue", [176, 224, 230], "Powder Blue"],
  ["purple", [128, 0, 128], "Purple"],
  ["rebeccapurple", [102, 51, 153], "Rebecca Purple"],
  ["red", [255, 0, 0], "Red"],
  ["rosybrown", [188, 143, 143], "Rosy Brown"],
  ["royalblue", [65, 105, 225], "Royal Blue"],
  ["saddlebrown", [139, 69, 19], "Saddle Brown"],
  ["salmon", [250, 128, 114], "Salmon"],
  ["sandybrown", [244, 164, 96], "Sandy Brown"],
  ["seagreen", [46, 139, 87], "Sea Green"],
  ["seashell", [255, 245, 238], "Seashell"],
  ["sienna", [160, 82, 45], "Sienna"],
  ["silver", [192, 192, 192], "Silver"],
  ["skyblue", [135, 206, 235], "Sky Blue"],
  ["slateblue", [106, 90, 205], "Slate Blue"],
  ["slategray", [112, 128, 144], "Slate Gray"],
  ["slategrey", [112, 128, 144], "Slate Grey"],
  ["snow", [255, 250, 250], "Snow"],
  ["springgreen", [0, 255, 127], "Spring Green"],
  ["steelblue", [70, 130, 180], "Steel Blue"],
  ["tan", [210, 180, 140], "Tan"],
  ["teal", [0, 128, 128], "Teal"],
  ["thistle", [216, 191, 216], "Thistle"],
  ["tomato", [255, 99, 71], "Tomato"],
  ["turquoise", [64, 224, 208], "Turquoise"],
  ["violet", [238, 130, 238], "Violet"],
  ["wheat", [245, 222, 179], "Wheat"],
  ["white", [255, 255, 255], "White"],
  ["whitesmoke", [245, 245, 245], "White Smoke"],
  ["yellow", [255, 255, 0], "Yellow"],
  ["yellowgreen", [154, 205, 50], "Yellow Green"]
];

function rgbToHex(rgb) {
  return `#${rgb.map(channel => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

if (CSS_NAMED_COLORS.length !== 148) {
  throw new Error(`Expected 148 CSS color keywords, found ${CSS_NAMED_COLORS.length}`);
}

const namesByHex = new Map();
const keywords = CSS_NAMED_COLORS.map(([keyword, rgb, label]) => {
  const hexCode = rgbToHex(rgb);
  if (!namesByHex.has(hexCode)) namesByHex.set(hexCode, label);
  return { keyword, hexCode };
});

function cssColorKeywords() {
  return keywords.map(item => ({ ...item, name: namesByHex.get(item.hexCode) }));
}

function cssColorEntries() {
  return [...namesByHex.entries()].map(([hexCode, name]) => ({ hexCode, name }));
}

function nameForHex(value) {
  const hexCode = normalizeHex(value);
  if (!hexCode) return "";
  return namesByHex.get(hexCode) || hexCode;
}

const suggestionCandidates = [...namesByHex.entries()].map(([hexCode, name]) => ({
  hexCode,
  name,
  lab: labFromHex(hexCode)
}));
for (const entry of wikipediaColorEntries()) {
  if (namesByHex.has(entry.hexCode)) continue;
  suggestionCandidates.push({ hexCode: entry.hexCode, name: entry.name, lab: labFromHex(entry.hexCode) });
}

function suggestedNameForHex(value) {
  const hexCode = normalizeHex(value);
  if (!hexCode) return "";
  const cssName = namesByHex.get(hexCode);
  if (cssName) return cssName;
  const wikipediaName = wikipediaNameForHex(hexCode);
  if (wikipediaName) return wikipediaName;
  const lab = labFromHex(hexCode);
  let bestName = "";
  let bestDistance = Infinity;
  for (const candidate of suggestionCandidates) {
    const distance = deltaE00(lab, candidate.lab);
    if (distance < bestDistance || (distance === bestDistance && candidate.name.localeCompare(bestName) < 0)) {
      bestDistance = distance;
      bestName = candidate.name;
    }
  }
  return bestName;
}

module.exports = { cssColorKeywords, cssColorEntries, nameForHex, suggestedNameForHex };
