const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

const html = read("public/index.html");
const app = read("public/app.js");
const activity = read("public/activity.js");
const activityStyles = read("public/activity.css");
const requests = read("public/requests.js");
const profile = read("public/client-profile.js");
const notifications = read("public/notifications.js");
const workflowStyles = read("public/workflow-ui.css");
const colorDetails = read("public/color-details.css");

assert.doesNotMatch(app, /Sync issues|failed_sync_count/);
assert.match(app, /<span>People<\/span>/);
assert.match(app, /class="client-card-metrics"/);
assert.match(app, /class="client-card-folder"/);
assert.match(app, /Could not load client libraries/);
assert.match(app, /No client libraries yet/);
assert.doesNotMatch(read("server/index.js"), /failed_sync_count/);
assert.match(colorDetails, /\.client-card-folder \{/);
assert.match(colorDetails, /prefers-reduced-motion:\s*reduce/);
assert.match(read("server/sync.js"), /async function replaceApprovedFile/);
assert.match(read("database/016_clear_resolved_sync_failures.sql"), /version\.synced_at IS NOT NULL/);
assert.match(profile, /class="primary profile-add"/);
assert.match(profile, /Representatives<\/h3><\/div>\$\{addRepresentative\}/);
assert.doesNotMatch(profile, /pageActions|id="addPerson" class="primary" type="button">Add representative<\/button>' : ""/);
assert.doesNotMatch(profile, /\$\{pendingStat\}\$\{addRepresentative\}/);
assert.match(workflowStyles, /#pageActions:empty/);
assert.match(workflowStyles, /#profilePeople \.profile-section-heading \{[\s\S]*align-items: center/);
assert.match(workflowStyles, /#profilePeople \.profile-add \{[\s\S]*margin-left: auto/);

// Core navigation and feedback remain usable with a keyboard or screen reader.
assert.match(html, /class="skip-link" href="#mainContent"/);
assert.match(html, /<main id="mainContent"[^>]*tabindex="-1"/);
assert.match(html, /id="toast"[^>]*role="status"[^>]*aria-live="polite"/);
assert.match(html, /href="\/workflow-ui\.css"/);
assert.match(html, /<dialog id="modal" aria-labelledby="modalTitle"/);
assert.match(html, /<dialog id="folderModal" aria-labelledby="folderModalTitle"/);
assert.match(html, /id="loginDescription"/);
assert.match(html, /id="loginSecurityNote"/);
assert.match(app, /Local password access is enabled for testing only/);
assert.match(html, /id="googleSignIn"[^>]*>[\s\S]*Continue with Google/);
assert.match(read("public/styles.css"), /\.google-sign-in span\{[^}]*white-space:nowrap/);
assert.doesNotMatch(read("public/styles.css"), /\.google-sign-in span\{[^}]*width:24px/);
assert.match(workflowStyles, /:focus-visible/);
assert.match(workflowStyles, /prefers-reduced-motion:\s*reduce/);

// Request discovery, filtering, and creation expose understandable state.
assert.match(requests, /data-request-filter=/);
assert.match(requests, /aria-pressed=/);
assert.match(requests, /id="requestSearch" type="search"/);
assert.match(requests, /id="requestResultSummary"[^>]*aria-live="polite"/);
assert.match(requests, /function syncRequestComposer/);
assert.match(requests, /class="request-visual"/);
assert.match(requests, /data-upload-source hidden/);
assert.match(requests, /class="request-drop-copy"/);
assert.match(requests, /class="request-drop-hint"/);
assert.match(workflowStyles, /\.request-drop \{[\s\S]*min-height: 320px/);
assert.match(workflowStyles, /\.request-visual \.request-generated-preview \{[\s\S]*position: static/);
assert.match(workflowStyles, /dialog:not\(\[open\]\) \{ display: none !important; \}/);
assert.match(workflowStyles, /#modal\[open\]:has\(\.request-composer\) \{[\s\S]*display: flex/);
assert.doesNotMatch(workflowStyles, /#modal:has\(\.request-composer\) \{[\s\S]*display: flex/);
assert.match(app, /\$\("#modal"\)\.addEventListener\("close"/);
assert.match(requests, /data-composer-status/);
assert.match(requests, /Hex code is required\./);
assert.match(requests, /optional-label">Optional/);
assert.match(workflowStyles, /\.request-attachments\.has-files \.request-attachments-count/);
assert.match(requests, /data-generated-preview/);
assert.match(requests, /function generatedSwatchSource/);
assert.match(requests, /request\.hexCode && !sources\.some\(generatedSwatchSource\)/);
assert.match(read("server/color-requests.js"), /const swatchBytes = await swatchPng\(hexCode\)/);
assert.match(read("server/color-requests.js"), /-swatch\.png/);
assert.match(requests, /data-open-explore>Explore swatches/);
assert.doesNotMatch(requests, /18-1664 TCX/);
assert.match(workflowStyles, /\.request-source-choice:has\(input:checked\)[\s\S]*--px-orange-500/);
assert.match(requests, /submit\.disabled = !valid/);
assert.match(requests, /<h2>\$\{esc\(request\.displayName\)\}<\/h2>/);
assert.match(requests, /class="color-page request-room"/);
assert.doesNotMatch(requests, /request-room-bar/);
assert.doesNotMatch(requests, /id="requestRoomNotificationSlot"/);
assert.match(requests, /restoreNotificationCenter\(\)/);
assert.match(requests, /class="request-rail-top"[\s\S]*request-activity-control/);
assert.match(requests, /function referenceTypeGroups/);
assert.match(requests, /class="reference-tree-label"/);
assert.match(requests, /class="reference-tree-latest"/);
assert.match(requests, /aria-label="Versions"/);
assert.doesNotMatch(requests, /earlier version/);
assert.match(workflowStyles, /clamp\(400px, 36vw, 520px\)/);
assert.match(requests, /function setReferenceGroupOpen/);
assert.match(requests, /latestReferenceFiles/);
assert.doesNotMatch(requests, /id="referenceTypeButton"/);
assert.doesNotMatch(requests, /reference-type-menu/);
assert.match(workflowStyles, /grid-template-rows: 0fr/);
assert.match(workflowStyles, /\.reference-tree-toggle\[aria-expanded="true"\] svg/);

const vm = require("vm");
const referenceContext = {
  state: { activeColorRequest: { id: "req-1" }, user: { role: "ADMIN", selectedClientId: "client" } },
  esc: value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])),
  date: value => String(value),
  relativeDate: () => "3 days ago"
};
vm.createContext(referenceContext);
vm.runInContext(requests, referenceContext);
function referenceFile(kind, label, number, createdAt, status) {
  const name = kind === "QUICK" ? "Crop reference" : (kind === "OTHER" ? label : "Full reference");
  return {
    key: `${kind}-${number}`,
    group: "Deliveries",
    kind: `${name} · Version ${number}`,
    title: `Version ${number}`,
    status,
    statusClass: status.toLowerCase(),
    filename: `${kind}-${number}.jpg`,
    profile: "",
    note: "",
    createdAt,
    preview: "/preview",
    display: "/display",
    download: "/download",
    delivery: { id: `${kind}-${number}`, number, referenceKind: kind, referenceLabel: label, status, createdAt }
  };
}
const referenceHtml = referenceContext.deliverySections([
  referenceFile("FULL", "", 1, "2026-09-20T00:00:00.000Z", "Needs changes"),
  referenceFile("FULL", "", 2, "2026-09-26T00:00:00.000Z", "In review"),
  referenceFile("QUICK", "", 1, "2026-09-18T00:00:00.000Z", "Approved"),
  referenceFile("QUICK", "", 2, "2026-09-25T00:00:00.000Z", "Approved"),
  referenceFile("OTHER", "Side view", 3, "2026-09-28T00:00:00.000Z", "In review")
], "FULL-2");
assert.equal((referenceHtml.match(/class="reference-tree-label"/g) || []).length, 3);
assert.equal((referenceHtml.match(/class="reference-tree-toggle"/g) || []).length, 2);
assert.doesNotMatch(referenceHtml, /reference-type-menu|referenceTypeButton/);
assert.doesNotMatch(referenceHtml, /<section class="reference-version-tree[^"]*" data-reference-type="[^"]*" hidden/);
const fullAt = referenceHtml.indexOf("Full reference");
const cropAt = referenceHtml.indexOf("Crop reference");
const sideAt = referenceHtml.indexOf("Side view");
assert.ok(sideAt < fullAt && fullAt < cropAt, "newer reference types stay above older ones");
const sideBlock = referenceHtml.slice(0, referenceHtml.indexOf('data-reference-type="FULL:"'));
assert.match(sideBlock, /Version 3/);
assert.doesNotMatch(sideBlock, /reference-tree-toggle/);
const fullBlock = referenceHtml.slice(referenceHtml.lastIndexOf("<section", fullAt), cropAt);
const fullPanelAt = fullBlock.indexOf("reference-tree-panel");
assert.ok(fullBlock.indexOf("Version 2") < fullPanelAt && fullPanelAt < fullBlock.indexOf("Version 1"), "latest version stays visible above earlier versions");
assert.match(fullBlock, /class="reference-version-tree has-selection"/);
assert.doesNotMatch(fullBlock, /is-open/);
assert.match(fullBlock, /aria-label="Versions"/);
assert.match(fullBlock, /class="reference-tree-count">1</);
assert.doesNotMatch(fullBlock, /earlier version/);
assert.match(fullBlock, /reference-tree-panel[^>]*hidden/);
assert.equal((referenceHtml.match(/aria-expanded="true"/g) || []).length, 0);
assert.equal((referenceHtml.match(/aria-expanded="false"/g) || []).length, 2);
const olderHtml = referenceContext.deliverySections([
  referenceFile("FULL", "", 1, "2026-09-20T00:00:00.000Z", "Needs changes"),
  referenceFile("FULL", "", 2, "2026-09-26T00:00:00.000Z", "In review"),
  referenceFile("QUICK", "", 1, "2026-09-18T00:00:00.000Z", "Approved"),
  referenceFile("QUICK", "", 2, "2026-09-25T00:00:00.000Z", "Approved"),
  referenceFile("OTHER", "Side view", 3, "2026-09-28T00:00:00.000Z", "In review")
], "FULL-1");
const olderFullAt = olderHtml.indexOf("Full reference");
const olderCropAt = olderHtml.indexOf("Crop reference");
const olderFull = olderHtml.slice(olderHtml.lastIndexOf("<section", olderFullAt), olderCropAt);
assert.match(olderFull, /class="reference-version-tree is-open has-selection"/);
assert.match(olderFull, /aria-expanded="true"/);
assert.ok(olderFull.indexOf("Version 2") < olderFull.indexOf("reference-tree-panel"), "latest version stays outside the earlier-version list");
assert.doesNotMatch(requests, /request-brief-card/);
assert.match(requests, /class="request-next" data-tone=/);
assert.match(requests, /id="requestReviewActions"/);
assert.match(requests, /function requestStepActions/);
assert.match(requests, /actions\.innerHTML = requestStepActions\(request, file\)/);
assert.match(requests, /id="requestDownload" class="preview-caption-download"/);
assert.match(requests, /data-copy-value=/);
assert.match(requests, /request-swatch-grid/);
assert.match(requests, /await refreshRequestDetail\(request\.id\)/);
assert.match(workflowStyles, /\.request-rail-top \{[\s\S]*position: sticky/);
assert.match(requests, />Post comment<\/button>/);
assert.match(requests, /function requestPreviewMarkup/);
assert.match(requests, /id="previewZoomIn"/);
assert.match(app, /Open full size/);
assert.match(app, /id="previewCompare"/);
assert.match(requests, /previewActionBar\(esc\(display\), true, true\)/);
assert.match(app, /id="previewComment"/);
assert.match(requests, /id="previewPins"/);
assert.match(requests, /animationDelay/);
assert.match(requests, /is-settled/);
assert.match(workflowStyles, /@keyframes preview-pin-in/);
assert.match(workflowStyles, /@keyframes preview-pin-pulse/);
assert.match(workflowStyles, /\.preview-pin\.is-current::after/);
const previewBind = app.slice(app.indexOf("function bindColorPreview"));
const fittedAt = previewBind.indexOf('classList.add("is-fitted")');
const pinSyncAt = previewBind.indexOf("stage._syncPreviewPins?.()", fittedAt);
const croppedReturnAt = previewBind.indexOf("if(!cropped)return");
assert.ok(fittedAt > 0 && pinSyncAt > fittedAt && pinSyncAt < croppedReturnAt, "comment markers sync as soon as the selected image is fitted");
assert.match(requests, /function commentOnFile/);
assert.match(requests, /function openPreviewCommentComposer/);
assert.match(requests, /pinX, pinY/);
assert.match(read("server/color-requests.js"), /pin_x, pin_y/);
assert.match(read("database/015_comment_pins.sql"), /color_request_comments_pin_range/);
assert.match(requests, /function compareChipLabel/);
assert.match(requests, /id="showRequestActivity"/);
assert.match(requests, /src="\/icons\/show-activity.png"/);
assert.match(requests, /aria-label="Show activity"/);
assert.match(requests, /id="requestActivityPanel"/);
assert.match(requests, /requestActivityMarkup\(request\?\.activity, request\)/);
assert.match(requests, /id="requestActivityInfo"/);
assert.match(requests, /COMMENT_ADDED: "added a comment"/);
assert.match(requests, /data-kind="\$\{esc\(requestActivityKind\(event\.type\)\)\}"/);
assert.match(requests, /data-party="admin">Pixofix/);
assert.match(requests, /data-party="client">Client/);
assert.match(workflowStyles, /data-kind="comment"/);
assert.match(workflowStyles, /data-party="client"/);
assert.match(workflowStyles, /data-party="admin"/);
assert.doesNotMatch(requests, /event\.type !== "COMMENT_ADDED"/);
assert.match(requests, /document\.body\.append\(panel\)/);
assert.match(requests, /preventScroll: true/);
assert.match(requests, /No history yet/);
assert.match(requests, /function bindRequestActivity/);
assert.match(requests, /data-compare-group="/);
assert.match(requests, /bindColorPreview\(\)/);
assert.doesNotMatch(requests, /id="requestPreviewLink"/);
assert.doesNotMatch(requests, /Download the selected file/);
assert.doesNotMatch(requests, /hint\.innerHTML = 'Download/);
assert.match(app, /target\.classList\.contains\("page"\)/);
assert.match(requests, /already exists in the swatch library as/);
assert.match(requests, /kind: "swatch"/);
assert.match(requests, /\["checking", "conflict", "error"\]\.includes\(checkState\)/);
assert.match(read("public/styles.css"), /\.hex-match\.is-swatch/);
assert.match(read("server/color-requests.js"), /function swatchByHex/);
assert.match(read("server/color-requests.js"), /ON CONFLICT\(hex_code\) DO NOTHING/);
assert.doesNotMatch(read("server/color-requests.js"), /ON CONFLICT\(hex_code\) DO UPDATE/);
assert.match(read("server/color-requests.js"), /locked\.proposed_name, normalizeKey\(locked\.proposed_name\)/);

// Identity and access copy clearly identifies the exact Google account.
assert.match(profile, /Google email address/);
assert.match(workflowStyles, /\.profile-section \+ \.profile-client-grid \{ margin-top: 28px; \}/);
assert.match(workflowStyles, /grid-template-columns: minmax\(0, 1fr\) minmax\(300px, 400px\)/);
assert.match(profile, /Use the exact address they use with Google/);
assert.match(profile, /Send access request/);
assert.match(profile, /No access requests yet/);
assert.match(app, /label:state\.user\.role==="ADMIN"\?"Profile":"Company profile"/);
assert.match(app, /Client initial/);
assert.match(app, /class="rep-pair"/);
assert.match(app, /id="addRep"/);
assert.doesNotMatch(app, /representativeLines/);
assert.match(read("public/styles.css"), /\.rep-pair\{/);
assert.match(read("public/index.html"), /<script src="\/client-representatives\.js"><\/script>/);

// Notifications use relative time, kind, filters, and useful zero states.
assert.match(notifications, /relativeDate\(item\.createdAt\)/);
assert.match(notifications, /All caught up/);
assert.match(notifications, /No notifications yet/);
assert.match(notifications, /Could not load notifications/);
assert.match(notifications, /data-notification-filter/);
assert.match(notifications, /data-kind=/);
assert.match(notifications, /Loading notifications/);
assert.match(html, /aria-controls="notificationPopover"/);
assert.match(workflowStyles, /data-kind="REQUEST_APPROVED"/);
assert.match(workflowStyles, /prefers-reduced-motion:\s*reduce/);

// Change history separates Pixofix and client activity and links each row.
assert.match(html, /href="\/activity\.css"/);
assert.match(html, /<script src="\/activity\.js"><\/script>/);
assert.match(activity, /data-party="/);
assert.match(activity, /class="audit-row"/);
assert.match(activity, /Loading change history/);
assert.match(activity, /No activity yet/);
assert.match(activity, /Could not load change history/);
assert.match(activity, /No matching events/);
assert.match(activity, /aria-live="polite"/);
assert.match(activity, /aria-pressed=/);
assert.match(activityStyles, /data-party="admin"/);
assert.match(activityStyles, /data-party="client"/);
assert.match(activityStyles, /--px-orange-500/);
assert.match(activityStyles, /#1e4d86/);
assert.match(activityStyles, /:focus-visible/);
assert.match(activityStyles, /prefers-reduced-motion:\s*reduce/);
assert.match(requests, /location\.hash === "#activity"/);
assert.match(app, /id="colorReferences"/);
assert.match(profile, /id="person-\$\{esc\(person\.id\)\}"/);
assert.match(read("server/index.js"), /presentAuditEvent/);

console.log("UI/UX accessibility and workflow tests passed.");
