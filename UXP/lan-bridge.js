function bridgeOrigin(config) {
  var bridge = config && config.lanBridge;
  if (!bridge) return "";
  return "http://" + bridge.listenHost + ":" + bridge.listenPort;
}

function portalLoopbackOrigin(config) {
  var bridge = config && config.lanBridge;
  if (!bridge) return "http://127.0.0.1:8787";
  return "http://127.0.0.1:" + bridge.targetPort;
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function probeOrigin(fetchImpl, fetchWithTimeout, origin, ms) {
  if (!origin || typeof fetchImpl !== "function") return false;
  try {
    var response = await fetchWithTimeout(fetchImpl, origin + "/api/plugin/clients", {}, ms || 1500);
    return Boolean(response && response.ok);
  } catch (error) {
    return false;
  }
}

async function ensureLanBridge(options) {
  var config = options.config;
  var fetchImpl = options.fetchImpl;
  var fetchWithTimeout = options.fetchWithTimeout;
  var loopback = portalLoopbackOrigin(config);
  var origin = bridgeOrigin(config);
  if (await probeOrigin(fetchImpl, fetchWithTimeout, loopback, 1500)) {
    return { ready: loopback, started: false };
  }
  if (await probeOrigin(fetchImpl, fetchWithTimeout, origin, 1500)) {
    return { ready: origin, started: false };
  }
  if (typeof options.start === "function") {
    try { await options.start(); } catch (error) {}
  }
  for (var attempt = 0; attempt < 10; attempt += 1) {
    await sleep(200);
    if (await probeOrigin(fetchImpl, fetchWithTimeout, origin, 1500)) {
      return { ready: origin, started: true };
    }
  }
  return { ready: "", started: false };
}

module.exports = {
  bridgeOrigin: bridgeOrigin,
  ensureLanBridge: ensureLanBridge,
  portalLoopbackOrigin: portalLoopbackOrigin
};
