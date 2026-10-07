const fs = require("fs");
const vm = require("vm");

const requests = fs.readFileSync("public/requests.js", "utf8");
const context = {
  state: { activeColorRequest: { id: "req-1" }, user: { role: "ADMIN", selectedClientId: "c" } },
  esc: value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])),
  date: value => String(value),
  relativeDate: () => "3 days ago"
};
vm.createContext(context);
vm.runInContext(requests, context);

function file(kind, label, number, createdAt, status, statusClass, filename) {
  return {
    key: `${kind}-${number}`,
    group: "Deliveries",
    kind: "x",
    title: `Version ${number}`,
    status,
    statusClass,
    filename,
    profile: "",
    note: "",
    createdAt,
    preview: "/icons/show-activity.png",
    display: "/icons/show-activity.png",
    download: "#",
    delivery: { number, referenceKind: kind, referenceLabel: label, status, createdAt }
  };
}

const html = context.deliverySections([
  file("OTHER", "Side view", 2, "2026-09-28T00:00:00.000Z", "In review", "in_review", "WW115_SIDE_02.jpg"),
  file("OTHER", "Side view", 1, "2026-09-21T00:00:00.000Z", "Approved", "approved", "WW115_SIDE_01.jpg"),
  file("FULL", "", 2, "2026-09-26T00:00:00.000Z", "Needs changes", "needs_changes", "WW115_WIN_02.jpg"),
  file("FULL", "", 1, "2026-09-20T00:00:00.000Z", "Approved", "approved", "WW115_WIN_01.jpg"),
  file("QUICK", "", 2, "2026-09-25T00:00:00.000Z", "In review", "in_progress", "WW115_CROP_02.jpg"),
  file("QUICK", "", 1, "2026-09-18T00:00:00.000Z", "Approved", "approved", "WW115_CROP_01.jpg")
], "FULL-2");

const behavior = `function setReferenceGroupOpen(tree, open) {
  const button = tree.querySelector(".reference-tree-toggle");
  const panel = tree.querySelector(".reference-tree-panel");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  button.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    panel.hidden = false;
    if (reduce || tree.classList.contains("is-open")) { tree.classList.add("is-open"); return; }
    requestAnimationFrame(() => tree.classList.add("is-open"));
    return;
  }
  tree.classList.remove("is-open");
  const hide = () => { if (!tree.classList.contains("is-open")) panel.hidden = true; };
  if (reduce) { hide(); return; }
  const timer = window.setTimeout(hide, 280);
  panel.addEventListener("transitionend", event => {
    if (event.target !== panel || event.propertyName !== "grid-template-rows") return;
    window.clearTimeout(timer);
    hide();
  }, { once: true });
}
document.querySelectorAll(".reference-tree-toggle").forEach(button => {
  button.onclick = () => {
    const tree = button.closest(".reference-version-tree");
    setReferenceGroupOpen(tree, button.getAttribute("aria-expanded") !== "true");
  };
});`;

const page = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="/styles.css">
<link rel="stylesheet" href="/color-details.css">
<link rel="stylesheet" href="/tokens.css">
<link rel="stylesheet" href="/brand.css">
<link rel="stylesheet" href="/workflow-ui.css">
<style>body{margin:0;background:#f4f4f4}.stage{width:440px;min-height:100vh;margin:24px;background:#fff;border:1px solid #e8e8e8;border-radius:16px;overflow:hidden}</style>
</head>
<body>
<div class="page is-full-page"><article class="color-page request-room"><aside class="color-page-info request-rail stage">${html}</aside></article></div>
<script>${behavior}</script>
</body>
</html>`;

fs.writeFileSync("public/_reference-preview.html", page);
console.log("wrote preview");
