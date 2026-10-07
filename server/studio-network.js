const os = require("os");
const { spawnSync } = require("child_process");

function lanIPv4Addresses() {
  const found = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      const ipv4 = entry.family === "IPv4" || entry.family === 4;
      if (ipv4 && !entry.internal) found.push(entry.address);
    }
  }
  return found;
}

function portalUrls(port) {
  const urls = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  for (const ip of lanIPv4Addresses()) urls.push(`http://${ip}:${port}`);
  const name = String(os.hostname() || "").trim();
  if (name) urls.push(`http://${name}:${port}`);
  return [...new Set(urls)];
}

function listenOptions(host, port) {
  if (host === "0.0.0.0" || host === "::") {
    return { port, host: "::", ipv6Only: false };
  }
  return { port, host };
}

function ensureLanFirewall(port) {
  if (process.platform !== "win32") return false;
  const name = `Pixofix Color Library ${port}`;
  try {
    const show = spawnSync("netsh", ["advfirewall", "firewall", "show", "rule", `name=${name}`], { encoding: "utf8", windowsHide: true });
    if (show.status === 0 && /Enabled:\s*Yes/i.test(String(show.stdout || ""))) return true;
    const add = spawnSync("netsh", [
      "advfirewall", "firewall", "add", "rule",
      `name=${name}`, "dir=in", "action=allow", "protocol=TCP", `localport=${port}`, "profile=any"
    ], { encoding: "utf8", windowsHide: true });
    return add.status === 0;
  } catch (_error) {
    return false;
  }
}

module.exports = { lanIPv4Addresses, portalUrls, listenOptions, ensureLanFirewall };
