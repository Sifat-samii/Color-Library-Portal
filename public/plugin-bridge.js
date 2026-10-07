function allowedPluginPath(path) {
  return /^\/api\/plugin\//.test(String(path || ""));
}

function sendPluginBridge(message) {
  var payload = typeof message === "string" ? message : JSON.stringify(message);
  if (window.uxpHost && typeof window.uxpHost.postMessage === "function") {
    window.uxpHost.postMessage(payload);
    return;
  }
  if (window.parent && window.parent !== window && typeof window.parent.postMessage === "function") {
    window.parent.postMessage(payload, "*");
  }
}

function bytesToBase64(buffer) {
  var bytes = new Uint8Array(buffer || []);
  var binary = "";
  var chunk = 0x8000;
  for (var index = 0; index < bytes.length; index += chunk) {
    var slice = bytes.subarray(index, Math.min(index + chunk, bytes.length));
    var chars = [];
    for (var offset = 0; offset < slice.length; offset += 1) chars.push(slice[offset]);
    binary += String.fromCharCode.apply(null, chars);
  }
  return typeof btoa === "function" ? btoa(binary) : Buffer.from(binary, "binary").toString("base64");
}

async function handlePluginBridgeMessage(event) {
  var data = event && event.data;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch (error) { return; }
  }
  if (!data || data.type === "ready") return;
  if (data.type === "ping") {
    sendPluginBridge({ id: data.id, type: "pong" });
    return;
  }
  if (data.type !== "get" || !allowedPluginPath(data.path)) {
    sendPluginBridge({ id: data.id, type: "error", error: "Blocked" });
    return;
  }
  try {
    var headers = {};
    if (data.accept) headers.Accept = data.accept;
    var response = await fetch(data.path, { method: "GET", headers: headers });
    var accept = String(data.accept || "");
    if (!accept || accept.indexOf("json") !== -1) {
      var json = await response.json();
      sendPluginBridge({ id: data.id, type: "response", ok: response.ok, status: response.status, json: json });
      return;
    }
    var buffer = await response.arrayBuffer();
    sendPluginBridge({ id: data.id, type: "response", ok: response.ok, status: response.status, base64: bytesToBase64(buffer) });
  } catch (error) {
    sendPluginBridge({ id: data.id, type: "error", error: error && error.message ? error.message : "Failed to fetch" });
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("message", handlePluginBridgeMessage);
  if (window.uxpHost && typeof window.uxpHost.addEventListener === "function") {
    window.uxpHost.addEventListener("message", handlePluginBridgeMessage);
  }
  sendPluginBridge({ type: "ready" });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { allowedPluginPath: allowedPluginPath, bytesToBase64: bytesToBase64 };
}
