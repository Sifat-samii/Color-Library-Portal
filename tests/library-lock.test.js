const assert = require("assert");
const { libraryEditBlock } = require("../server/library-lock");
const { referenceCategory } = require("../server/color-request-flow");

assert.equal(libraryEditBlock("CLIENT", ""), "Approved colors can only be changed after an administrator accepts an edit request.");
assert.equal(libraryEditBlock("CLIENT", "IN_EDIT"), "Approved colors can only be changed after an administrator accepts an edit request.");
assert.equal(libraryEditBlock("ADMIN", "PENDING"), "This color is locked. Accept an edit request before changing it.");
assert.equal(libraryEditBlock("ADMIN", ""), "This color is locked. Accept an edit request before changing it.");
assert.equal(libraryEditBlock("ADMIN", "IN_EDIT"), "");

assert.deepEqual(referenceCategory("full", "ignored"), { kind: "FULL", label: "", key: "FULL:" });
assert.deepEqual(referenceCategory("OTHER", "Detail crop reference"), { kind: "OTHER", label: "DETAIL CROP", key: "OTHER:DETAIL CROP" });
assert.equal(referenceCategory("OTHER", "   "), null);
assert.equal(referenceCategory("CMYK", ""), null);

const portal = require("fs").readFileSync(require("path").join(__dirname, "../public/app.js"), "utf8");
assert.match(portal, /Request edit/);
assert.match(portal, /id="startAdminEdit"/);
assert.match(portal, /\$\("#editRequestBottom"\)/);
assert.doesNotMatch(portal, /Edit this color|Unlock the same controls/);
assert.match(portal, /edit-requests\/start/);
assert.match(portal, /eyebrow:"SAVE EDITS"/);
assert.match(portal, /eyebrow:"UPLOAD REFERENCE"/);
assert.match(portal, /error\.silent/);
const server = require("fs").readFileSync(require("path").join(__dirname, "../server/index.js"), "utf8");
const startEdit = server.slice(server.indexOf('app.post("/api/client/colors/:id/edit-requests/start"'), server.indexOf('app.post("/api/client/colors/:id/edit-requests/:editId/:decision"'));
assert.match(startEdit, /requireRole\("ADMIN"\)/);
assert.match(startEdit, /'IN_EDIT'/);
assert.match(startEdit, /Accept the client's edit request to unlock this color/);
assert.doesNotMatch(startEdit, /requireRole\("CLIENT"\)/);
assert.doesNotMatch(portal, /data-edit-color=/);
assert.match(portal, /function openEditColor\(\)/);
assert.match(portal, /title:"Mark edit complete"/);
assert.match(portal, /Mark the edit complete before leaving this page/);
assert.match(portal, /if\(!allowOpenEdit&&!\(await confirmLeaveOpenEdit\(\)\)\)return/);
assert.match(portal, /if\(state\.detailColorId&&!\(await confirmLeaveOpenEdit\(\)\)\)return/);
assert.match(portal, /if\(!routeKeepsOpenEdit\(next\)\)/);
assert.match(portal, /allowOpenEdit:true/);
assert.match(portal, /if\(!\(await confirmLeaveOpenEdit\(\)\)\)return;.*await api\("\/api\/auth\/logout"/);
const requests = require("fs").readFileSync(require("path").join(__dirname, "../public/requests.js"), "utf8");
assert.match(requests, /reference-version-tree/);
assert.match(requests, /Choose destination/);

console.log("Library lock tests passed.");
