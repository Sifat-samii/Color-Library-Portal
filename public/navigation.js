function knownShade(value) {
  const ids = globalThis.colorShadeIds
    ? globalThis.colorShadeIds()
    : require("./color-shades").colorShadeIds();
  const shade = String(value || "").trim().toLowerCase();
  return ids.includes(shade) ? shade : "";
}

function withShade(route, params) {
  const shade = knownShade(params.get("shade"));
  return shade ? { ...route, shade } : route;
}

function parseAppRoute(pathname, search) {
  const path = String(pathname || "/").replace(/\/+$/, "") || "/";
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  const clientId = params.get("client") || null;
  const value = pattern => {
    const match = path.match(pattern);
    return match ? decodeURIComponent(match[1]) : "";
  };
  const colorId = value(/^\/colors\/([^/]+)$/);
  if (colorId) return { view: "color", colorId, clientId };
  const pixofixColorId = value(/^\/pixofix\/([^/]+)$/);
  if (pixofixColorId) return withShade({ view: "pixofix", pixofixColorId }, params);
  if (path === "/pixofix") return withShade({ view: "pixofix" }, params);
  const requestId = value(/^\/requests\/([^/]+)$/);
  if (requestId) return { view: "request", requestId, clientId };
  if (path === "/requests") return { view: "requests", clientId };
  if (path === "/archived") return { view: "archived", clientId };
  if (path === "/library") return { view: "library", clientId };
  if (path === "/activity") return { view: "activity" };
  if (path === "/notifications") return { view: "notifications" };
  if (path === "/clients") return { view: "clients" };
  if (path === "/profile") return { view: "profile", clientId };
  return { view: "home" };
}

function appRouteUrl(route = {}) {
  const view = route.view || "home";
  let path = "/";
  if (view === "color" && route.colorId) path = `/colors/${encodeURIComponent(route.colorId)}`;
  else if (view === "pixofix" && route.pixofixColorId) path = `/pixofix/${encodeURIComponent(route.pixofixColorId)}`;
  else if (view === "pixofix") path = "/pixofix";
  else if (view === "request" && route.requestId) path = `/requests/${encodeURIComponent(route.requestId)}`;
  else if (view === "requests") path = "/requests";
  else if (view === "archived") path = "/archived";
  else if (view === "library") path = "/library";
  else if (view === "activity") path = "/activity";
  else if (view === "notifications") path = "/notifications";
  else if (view === "clients") path = "/clients";
  else if (view === "profile") path = "/profile";
  const params = [];
  if (["color", "library", "archived", "requests", "request", "profile"].includes(view) && route.clientId) {
    params.push(`client=${encodeURIComponent(route.clientId)}`);
  }
  if (view === "pixofix") {
    const shade = knownShade(route.shade);
    if (shade) params.push(`shade=${encodeURIComponent(shade)}`);
  }
  return params.length ? `${path}?${params.join("&")}` : path;
}

Object.assign(globalThis, { parseAppRoute, appRouteUrl, knownShade });
if (typeof module !== "undefined" && module.exports) module.exports = { parseAppRoute, appRouteUrl, knownShade };
