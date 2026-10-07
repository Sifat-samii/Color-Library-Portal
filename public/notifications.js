const notificationState = {
  items: [],
  unreadCount: 0,
  timer: null,
  loading: false,
  ready: false,
  error: "",
  filter: "all",
  markingAll: false
};
let notificationFetch = 0;

const NOTIFICATION_GLYPHS = {
  plus: '<path d="M12 6v12"/><path d="M6 12h12"/>',
  upload: '<path d="M12 16V7"/><path d="m8.5 10.5 3.5-3.5 3.5 3.5"/><path d="M6 18.5h12"/>',
  undo: '<path d="M8 8H4.5V11.5"/><path d="M5 11a7 7 0 1 0 1.8-5"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.2-5.6"/><path d="M20 4.5V10h-5.5"/>',
  check: '<path d="m6.5 12.5 3.5 3.5 7.5-8"/>',
  comment: '<path d="M7.2 17.2 5 20.2c2.3-.5 3.8-1.4 4.8-2.2h6.4A2.6 2.6 0 0 0 19 15.4V8.4A2.6 2.6 0 0 0 16.4 5.8H7.6A2.6 2.6 0 0 0 5 8.4v6.4a2.6 2.6 0 0 0 2.2 2.4Z"/>',
  user: '<path d="M12 12.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"/><path d="M6.2 18.4a6 6 0 0 1 11.6 0"/>',
  "user-check": '<path d="M9.5 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M4.4 18a5.2 5.2 0 0 1 7.8-2.3"/><path d="m15 16.2 1.6 1.6L20 14.4"/>',
  "user-x": '<path d="M9.5 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M4.4 18a5.2 5.2 0 0 1 7.2-2.5"/><path d="m16 14.5 4 4"/><path d="m20 14.5-4 4"/>',
  "user-plus": '<path d="M9.2 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M4.2 18a5.2 5.2 0 0 1 7.6-2.4"/><path d="M17 11.5v6"/><path d="M14 14.5h6"/>'
};

function notificationGlyph(kind) {
  const icons = {
    REQUEST_CREATED: "plus",
    REFERENCE_UPLOADED: "upload",
    REFERENCE_WITHDRAWN: "undo",
    CHANGES_REQUESTED: "refresh",
    REQUEST_APPROVED: "check",
    COMMENT_ADDED: "comment",
    ACCESS_REQUESTED: "user",
    ACCESS_AUTHORIZED: "user-check",
    ACCESS_DISMISSED: "user-x",
    REPRESENTATIVE_ADDED: "user-plus",
    REPRESENTATIVE_UPDATED: "user"
  };
  const name = icons[kind] || (String(kind || "").startsWith("ACCESS_") || String(kind || "").startsWith("REPRESENTATIVE_") ? "user" : "plus");
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${NOTIFICATION_GLYPHS[name]}</svg>`;
}

function notificationGoIcon() {
  return '<svg class="notification-go" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
}

function notificationBucket(value) {
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return "Earlier";
  const start = dateValue => {
    const copy = new Date(dateValue);
    copy.setHours(0, 0, 0, 0);
    return copy.getTime();
  };
  const days = Math.round((start(new Date()) - start(when)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "This week";
  return "Earlier";
}

function groupNotifications(items) {
  const order = ["Today", "Yesterday", "This week", "Earlier"];
  const groups = new Map();
  [...items].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).forEach(item => {
    const key = notificationBucket(item.createdAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  return order.filter(key => groups.has(key)).map(key => ({ label: key, items: groups.get(key) }));
}

function notificationWhen(label) {
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : label;
}

function notificationMarkup(item, compact = false) {
  const unread = !item.readAt;
  const when = notificationWhen(relativeDate(item.createdAt));
  const label = `${unread ? "Unread. " : ""}${item.title}. ${item.body}. ${when}`;
  return `<button class="notification-item${unread ? " is-unread" : ""}${compact ? " is-compact" : ""}" type="button" data-kind="${esc(item.kind)}" data-notification-id="${esc(item.id)}" data-notification-target="${esc(item.targetUrl)}" aria-label="${esc(label)}"><span class="notification-kind">${notificationGlyph(item.kind)}</span><span class="notification-copy"><span class="notification-line"><strong>${esc(item.title)}</strong><time datetime="${esc(item.createdAt)}" title="${esc(date(item.createdAt))}">${esc(when)}</time></span><span class="notification-body">${esc(item.body)}</span></span>${notificationGoIcon()}</button>`;
}

function notificationGroups(items, compact = false) {
  return groupNotifications(items).map(group => `<section class="notification-group"><h3>${esc(group.label)}</h3><div class="notification-group-list">${group.items.map(item => notificationMarkup(item, compact)).join("")}</div></section>`).join("");
}

function notificationSkeleton(count) {
  const rows = Array.from({ length: count }, () => '<span class="notification-skeleton-row"><i></i><span><b></b><b></b></span></span>').join("");
  return `<div class="notification-skeleton" aria-hidden="true">${rows}</div><p class="sr-only">Loading notifications</p>`;
}

function notificationEmpty(title, { panel = false } = {}) {
  const icon = `<span class="notification-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M10.3 21a2 2 0 0 0 3.4 0"/><path d="M3.3 15.3A1 1 0 0 0 4 17h16a1 1 0 0 0 .7-1.7C19.4 14 18 12.5 18 8a6 6 0 0 0-12 0c0 4.5-1.4 6-2.7 7.3"/></svg></span>`;
  if (!panel) return `<div class="notification-empty">${icon}<strong>${esc(title)}</strong></div>`;
  return `<section class="panel workflow-empty notification-zero">${icon.replace("notification-empty-icon", "workflow-empty-icon")}<h3>${esc(title)}</h3></section>`;
}

function notificationError() {
  return `<div class="notification-empty is-alert" role="alert"><strong>Could not load notifications</strong><button class="secondary" type="button" data-notification-retry>Try again</button></div>`;
}

function paintNotificationBadge() {
  const badge = $("#notificationBadge");
  const button = $("#notificationButton");
  if (!badge) return;
  const count = notificationState.unreadCount;
  badge.hidden = count === 0;
  badge.textContent = count > 99 ? "99+" : String(count);
  button?.classList.toggle("has-unread", count > 0);
  button?.setAttribute("aria-label", count ? `${count} unread notifications` : "Notifications");
}

function popoverBody() {
  if (notificationState.error && !notificationState.items.length) return notificationError();
  if (!notificationState.ready && !notificationState.items.length) return notificationSkeleton(3);
  if (!notificationState.items.length) return notificationEmpty("No notifications yet");
  return notificationGroups([...notificationState.items].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 8), true);
}

function notificationSnapshot(scope) {
  const rows = notificationState.items.map(item => `${item.id}:${item.readAt ? 1 : 0}`).join(",");
  return `${scope}|${notificationState.filter}|${notificationState.unreadCount}|${notificationState.ready}|${notificationState.error}|${rows}`;
}

function notificationFocusMarker(root) {
  const active = document.activeElement;
  if (!active || !root?.contains(active)) return null;
  if (active.dataset.notificationId) return { type: "item", id: active.dataset.notificationId };
  if (active.dataset.notificationFilter) return { type: "filter", id: active.dataset.notificationFilter };
  if (active.hasAttribute("data-read-all")) return { type: "read-all" };
  if (active.hasAttribute("data-view-notifications")) return { type: "view" };
  if (active.hasAttribute("data-notification-retry")) return { type: "retry" };
  return null;
}

function restoreNotificationFocus(root, marker) {
  if (!root || !marker) return;
  const selector = {
    item: `[data-notification-id="${CSS.escape(marker.id)}"]`,
    filter: `[data-notification-filter="${CSS.escape(marker.id)}"]`,
    "read-all": "[data-read-all]",
    view: "[data-view-notifications]",
    retry: "[data-notification-retry]"
  }[marker.type];
  root.querySelector(selector)?.focus({ preventScroll: true });
}

function paintNotificationPopover() {
  const popover = $("#notificationPopover");
  if (!popover || popover.hidden) return;
  const snapshot = notificationSnapshot("popover");
  const marker = notificationFocusMarker(popover);
  if (popover.dataset.snapshot === snapshot && popover.querySelector(".notification-popover-list")) {
    return;
  }
  const count = notificationState.unreadCount;
  popover.innerHTML = `<header><div class="notification-popover-title"><h3>Notifications</h3>${count ? `<span class="notification-count">${count > 99 ? "99+" : count}</span>` : ""}</div>${count ? '<button class="notification-read-all" type="button" data-read-all>Mark all read</button>' : ""}</header><div class="notification-popover-list">${popoverBody()}</div><footer><button type="button" data-view-notifications>View all</button></footer>`;
  popover.dataset.snapshot = snapshot;
  bindNotificationItems(popover);
  restoreNotificationFocus(popover, marker);
}

function visibleNotifications() {
  if (notificationState.filter === "unread") return notificationState.items.filter(item => !item.readAt);
  return notificationState.items;
}

function pageBody() {
  if (notificationState.error && !notificationState.items.length) return notificationError();
  if (!notificationState.ready) return notificationSkeleton(4);
  if (!notificationState.items.length) return notificationEmpty("No notifications yet", { panel: true });
  const items = visibleNotifications();
  if (!items.length) return notificationEmpty("All caught up", { panel: true });
  const status = notificationState.filter === "all" && !notificationState.unreadCount
    ? '<p class="notification-status">All caught up</p>'
    : "";
  return `${status}<div class="notification-page-list">${notificationGroups(items)}</div>`;
}

function paintNotificationsPage() {
  if (state.view !== "notifications") return;
  const content = $("#content");
  if (!content) return;
  const snapshot = notificationSnapshot("page");
  const marker = notificationFocusMarker(content);
  if (content.dataset.notificationSnapshot === snapshot && content.querySelector(".notification-page")) return;
  const unread = notificationState.unreadCount;
  const unreadLabel = unread ? `<span>${unread > 99 ? "99+" : unread}</span>` : "";
  content.innerHTML = `<section class="notification-page" aria-busy="${notificationState.loading && !notificationState.ready ? "true" : "false"}"><header class="notification-toolbar"><div class="notification-filters" role="group" aria-label="Filter"><button type="button" data-notification-filter="all" aria-pressed="${notificationState.filter !== "unread"}">All</button><button type="button" data-notification-filter="unread" aria-pressed="${notificationState.filter === "unread"}">Unread${unreadLabel}</button></div>${unread ? '<button class="secondary" type="button" data-read-all>Mark all read</button>' : ""}</header>${pageBody()}</section>`;
  content.dataset.notificationSnapshot = snapshot;
  bindNotificationItems(content);
  restoreNotificationFocus(content, marker);
}

async function refreshNotifications({ quiet = false } = {}) {
  if (notificationState.loading || notificationState.markingAll || !state.user) return;
  const fetchId = ++notificationFetch;
  notificationState.loading = true;
  if (!notificationState.ready) {
    notificationState.error = "";
    paintNotificationPopover();
    if (state.view === "notifications") paintNotificationsPage();
  }
  try {
    const result = await api("/api/notifications?limit=100");
    if (fetchId !== notificationFetch || notificationState.markingAll) return;
    notificationState.items = result.notifications || [];
    notificationState.unreadCount = Number(result.unreadCount || 0);
    notificationState.error = "";
    notificationState.ready = true;
    paintNotificationBadge();
    paintNotificationPopover();
    if (state.view === "notifications") paintNotificationsPage();
  } catch (error) {
    if (fetchId !== notificationFetch || notificationState.markingAll) return;
    notificationState.error = error.message || "Could not load notifications";
    if (!notificationState.ready) {
      paintNotificationPopover();
      if (state.view === "notifications") paintNotificationsPage();
    }
    if (!quiet) toast(notificationState.error);
  } finally {
    if (fetchId === notificationFetch) notificationState.loading = false;
  }
}

async function markNotificationRead(item) {
  if (!item || item.readAt) return;
  await api(`/api/notifications/${encodeURIComponent(item.id)}/read`, { method: "POST", body: "{}" });
  item.readAt = new Date().toISOString();
  notificationState.unreadCount = Math.max(0, notificationState.unreadCount - 1);
  paintNotificationBadge();
}

async function openNotification(id, target) {
  const item = notificationState.items.find(candidate => candidate.id === id);
  try {
    if (item) await markNotificationRead(item);
  } catch (error) {
    toast(error.message || "Could not update this notification");
  }
  closeNotificationPopover();
  history.pushState(null, "", target || "/");
  await openFromLocation("silent");
}

async function markAllNotificationsRead() {
  if (notificationState.markingAll || !notificationState.unreadCount) return;
  notificationState.markingAll = true;
  notificationFetch += 1;
  notificationState.loading = false;
  const buttons = [...document.querySelectorAll("[data-read-all]")];
  buttons.forEach(button => {
    button.disabled = true;
    button.dataset.label = button.textContent;
    button.textContent = "Marking…";
  });
  try {
    await api("/api/notifications/read-all", { method: "POST", body: "{}" });
    const now = new Date().toISOString();
    notificationState.items.forEach(item => { item.readAt ||= now; });
    notificationState.unreadCount = 0;
    paintNotificationBadge();
    paintNotificationPopover();
    if (state.view === "notifications") paintNotificationsPage();
  } catch (error) {
    buttons.forEach(button => {
      button.disabled = false;
      if (button.dataset.label) button.textContent = button.dataset.label;
    });
    toast(error.message || "Could not mark notifications read");
  } finally {
    notificationState.markingAll = false;
  }
}

function bindNotificationItems(root = document) {
  root.querySelectorAll("[data-notification-id]").forEach(button => {
    button.onclick = () => openNotification(button.dataset.notificationId, button.dataset.notificationTarget);
  });
  root.querySelectorAll("[data-read-all]").forEach(button => {
    button.onclick = () => markAllNotificationsRead();
  });
  root.querySelectorAll("[data-view-notifications]").forEach(button => {
    button.onclick = () => {
      closeNotificationPopover();
      state.view = "notifications";
      renderNotifications();
    };
  });
  root.querySelectorAll("[data-notification-retry]").forEach(button => {
    button.onclick = () => refreshNotifications();
  });
  root.querySelectorAll("[data-notification-filter]").forEach(button => {
    button.onclick = () => {
      const next = button.dataset.notificationFilter === "unread" ? "unread" : "all";
      if (notificationState.filter === next) return;
      notificationState.filter = next;
      paintNotificationsPage();
    };
  });
}

function placeNotificationPopover() {
  const popover = $("#notificationPopover");
  const button = $("#notificationButton");
  if (!popover || !button || popover.hidden) return;
  if (window.innerWidth > 820) {
    popover.style.removeProperty("--notification-top");
    return;
  }
  const box = button.getBoundingClientRect();
  const origin = button.closest(".page-header")?.getBoundingClientRect() || { top: 0 };
  const top = Math.max(8, Math.round(box.bottom - origin.top + 8));
  popover.style.setProperty("--notification-top", `${top}px`);
}

function closeNotificationPopover({ restoreFocus = false } = {}) {
  const popover = $("#notificationPopover");
  const button = $("#notificationButton");
  const wasOpen = Boolean(popover && !popover.hidden);
  const restore = wasOpen && (restoreFocus || popover.contains(document.activeElement));
  if (popover) popover.hidden = true;
  button?.setAttribute("aria-expanded", "false");
  if (restore) button?.focus({ preventScroll: true });
}

function toggleNotificationPopover() {
  const popover = $("#notificationPopover");
  const button = $("#notificationButton");
  if (!popover || !button) return;
  const opening = popover.hidden;
  popover.hidden = !opening;
  button.setAttribute("aria-expanded", String(opening));
  if (opening) {
    placeNotificationPopover();
    paintNotificationPopover();
    refreshNotifications({ quiet: true });
    popover.focus({ preventScroll: true });
  }
}

async function renderNotifications() {
  state.view = "notifications";
  syncAppRoute();
  nav(workspaceNav());
  page("NOTIFICATIONS", "Notifications", "Updates for you.", "");
  paintNotificationsPage();
  await refreshNotifications();
}

function startNotifications() {
  stopNotifications();
  const button = $("#notificationButton");
  if (button) button.onclick = toggleNotificationPopover;
  refreshNotifications({ quiet: true });
  notificationState.timer = setInterval(() => {
    if (document.visibilityState === "visible") refreshNotifications({ quiet: true });
  }, 30000);
}

function stopNotifications() {
  clearInterval(notificationState.timer);
  notificationState.timer = null;
  notificationState.loading = false;
  notificationState.ready = false;
  notificationState.error = "";
  notificationState.items = [];
  notificationState.unreadCount = 0;
  notificationState.filter = "all";
  closeNotificationPopover();
  paintNotificationBadge();
}

document.addEventListener("click", event => {
  if (!event.target.closest(".notification-center")) closeNotificationPopover();
});
document.addEventListener("keydown", event => {
  const popover = $("#notificationPopover");
  if (event.key === "Escape" && popover && !popover.hidden) closeNotificationPopover({ restoreFocus: true });
});
window.addEventListener("resize", () => placeNotificationPopover());

Object.assign(globalThis, { startNotifications, stopNotifications, renderNotifications, refreshNotifications });
