// Adobe RGB (1998) hex codes to CIE Lab, then CIEDE2000.
// The encoding lives in public/adobe-rgb.js so the portal and the swatch page share it.

const { labFromHex, colorValuesFromHex, deltaE00 } = require("../public/adobe-rgb");

module.exports = { labFromHex, colorValuesFromHex, deltaE00 };
