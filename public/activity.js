const auditFilters = { party: "all", record: "all", query: "" };

const auditParties = [
  { id: "all", label: "All" },
  { id: "admin", label: "Pixofix" },
  { id: "client", label: "Client" },
  { id: "system", label: "System" }
];

const auditRecords = [
  { id: "all", label: "All records" },
  { id: "requests", label: "Requests" },
  { id: "colors", label: "Colors" },
  { id: "access", label: "Access" },
  { id: "libraries", label: "Libraries" },
  { id: "swatches", label: "Swatches" }
];

function auditPartyLabel(party) {
  if (party === "admin") return "Pixofix";
  if (party === "client") return "Client";
  return "System";
}

function auditInitial(event) {
  const source = event.actorName || event.actorEmail || "System";
  const parts = source.split(/[\s@._+-]+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : source.slice(0, 1);
  return letters.toUpperCase();
}

function auditDayKey(value) {
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return "unknown";
  return `${when.getFullYear()}-${when.getMonth()}-${when.getDate()}`;
}

function auditDayLabel(value) {
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return "Undated";
  const today = new Date();
  const start = date => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diff = Math.round((start(today) - start(when)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return when.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function auditClock(value) {
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return "—";
  return when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function auditMatches(event) {
  if (auditFilters.party !== "all" && event.party !== auditFilters.party) return false;
  if (auditFilters.record !== "all" && event.recordGroup !== auditFilters.record) return false;
  const query = auditFilters.query.trim().toLowerCase();
  if (!query) return true;
  return [event.title, event.subject, event.actorName, event.actorEmail, event.clientCode, event.clientName, event.action, auditPartyLabel(event.party)]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function auditStatus(title, message, action = "") {
  return `<section class="panel audit-status" role="status"><strong>${esc(title)}</strong><p class="muted">${esc(message)}</p>${action}</section>`;
}

function auditEmpty(filtered) {
  if (!filtered) {
    return `<section class="panel workflow-empty"><span class="workflow-empty-icon" aria-hidden="true">◇</span><h3>No activity yet</h3><p>Approvals, uploads, comments, and sign-ins will appear here.</p></section>`;
  }
  return `<section class="panel workflow-empty"><span class="workflow-empty-icon" aria-hidden="true">◇</span><h3>No matching events</h3><p>Nothing in this view.</p><button class="secondary" type="button" data-audit-reset>Clear filters</button></section>`;
}

function auditRow(event) {
  const actor = event.actorName || event.actorEmail || "System";
  const email = event.actorName && event.actorEmail ? event.actorEmail : "";
  const client = event.clientCode || "System";
  const label = `${event.title}. ${event.subject}. ${event.destination}.`;
  return `<a class="audit-row" data-party="${esc(event.party)}" href="${esc(event.href)}" aria-label="${esc(label)}"><span class="audit-avatar" aria-hidden="true">${esc(auditInitial(event))}</span><span class="audit-main"><span class="audit-kicker"><span class="audit-party">${esc(auditPartyLabel(event.party))}</span><span class="audit-client">${esc(client)}</span></span><strong>${esc(event.title)}</strong><span class="audit-subject">${esc(event.subject || "Record")}</span></span><span class="audit-actor"><span>${esc(actor)}</span>${email ? `<small>${esc(email)}</small>` : ""}</span><time datetime="${esc(event.createdAt || "")}" title="${esc(date(event.createdAt))}"><span>${esc(auditClock(event.createdAt))}</span><small>${esc(relativeDate(event.createdAt))}</small></time><span class="audit-destination">${esc(event.destination)} <b aria-hidden="true">↗</b></span></a>`;
}

function auditGroups(events) {
  const groups = [];
  for (const event of events) {
    const key = auditDayKey(event.createdAt);
    const current = groups[groups.length - 1];
    if (!current || current.key !== key) groups.push({ key, label: auditDayLabel(event.createdAt), events: [event] });
    else current.events.push(event);
  }
  return groups.map(group => `<section class="audit-day"><h2>${esc(group.label)} <span>${group.events.length}</span></h2><div class="audit-list">${group.events.map(auditRow).join("")}</div></section>`).join("");
}

function auditShell(events) {
  const counts = { all: events.length, admin: 0, client: 0, system: 0 };
  for (const event of events) counts[event.party] = (counts[event.party] || 0) + 1;
  const parties = auditParties.map(party => `<button type="button" data-audit-party="${party.id}" aria-pressed="${auditFilters.party === party.id ? "true" : "false"}"><strong>${counts[party.id] || 0}</strong><span>${esc(party.label)}</span></button>`).join("");
  const records = auditRecords.map(record => `<button type="button" data-audit-record="${record.id}" aria-pressed="${auditFilters.record === record.id ? "true" : "false"}">${esc(record.label)}</button>`).join("");
  return `<section class="audit-page"><div class="audit-parties" role="group" aria-label="Who made the change">${parties}</div><div class="audit-toolbar"><label class="audit-search"><span>Search</span><input id="auditSearch" type="search" value="${esc(auditFilters.query)}" autocomplete="off"></label><div class="audit-records" role="group" aria-label="Record type">${records}</div></div><p id="auditResultSummary" class="audit-summary" aria-live="polite"></p><div id="auditList"></div></section>`;
}

function paintAuditList() {
  const events = state.audit || [];
  const visible = events.filter(auditMatches);
  const summary = $("#auditResultSummary");
  const list = $("#auditList");
  if (!summary || !list) return;
  const filtered = auditFilters.party !== "all" || auditFilters.record !== "all" || auditFilters.query.trim();
  summary.textContent = visible.length === events.length
    ? `${events.length} event${events.length === 1 ? "" : "s"}`
    : `Showing ${visible.length} of ${events.length}`;
  list.innerHTML = visible.length ? auditGroups(visible) : auditEmpty(filtered || events.length > 0);
  document.querySelectorAll("[data-audit-party]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.auditParty === auditFilters.party));
  });
  document.querySelectorAll("[data-audit-record]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.auditRecord === auditFilters.record));
  });
  list.querySelector("[data-audit-reset]")?.addEventListener("click", () => {
    auditFilters.party = "all";
    auditFilters.record = "all";
    auditFilters.query = "";
    const search = $("#auditSearch");
    if (search) search.value = "";
    paintAuditList();
  });
}

function bindAuditPage() {
  const root = $(".audit-page");
  if (!root || root.dataset.bound === "true") return;
  root.dataset.bound = "true";
  root.addEventListener("click", async event => {
    const party = event.target.closest("[data-audit-party]");
    const record = event.target.closest("[data-audit-record]");
    if (party) {
      auditFilters.party = party.dataset.auditParty;
      paintAuditList();
      return;
    }
    if (record) {
      auditFilters.record = record.dataset.auditRecord;
      paintAuditList();
      return;
    }
    const link = event.target.closest("a.audit-row");
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    if (!(await confirmLeaveOpenEdit())) return;
    history.pushState(null, "", link.getAttribute("href"));
    await openFromLocation("silent");
  });
  const search = $("#auditSearch");
  if (search) {
    search.addEventListener("input", debounce(() => {
      auditFilters.query = search.value;
      paintAuditList();
    }, 120));
  }
}

function showAudit(events) {
  $("#content").innerHTML = auditShell(events);
  bindAuditPage();
  paintAuditList();
}

async function renderActivity() {
  state.view = "activity";
  syncAppRoute();
  nav(workspaceNav());
  page("AUDIT TRAIL", "Change history", "Approvals, uploads, comments, and sign-ins.");
  $("#content").setAttribute("aria-busy", "true");
  $("#content").innerHTML = auditStatus("Loading change history", "Fetching recent activity.");
  try {
    const result = await api("/api/admin/audit?limit=250");
    state.audit = result.events || [];
    showAudit(state.audit);
  } catch (error) {
    page("AUDIT TRAIL", "Change history", "The history could not be loaded.");
    $("#content").innerHTML = auditStatus("Could not load change history", error.message || "Try again.", '<button id="retryActivity" class="secondary" type="button">Try again</button>');
    $("#retryActivity").onclick = () => renderActivity();
  } finally {
    $("#content").removeAttribute("aria-busy");
  }
}
