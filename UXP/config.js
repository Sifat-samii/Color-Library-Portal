module.exports = {
  storageNamespace: "pixofix-color-library-v1",
  supportedExtensions: ["jpg", "jpeg", "png", "tif", "tiff", "psd", "psb"],
  lanBridge: {
    listenHost: "127.0.0.1",
    listenPort: 18787,
    targetHost: "192.168.0.112",
    targetPort: 8787,
    starter: "lan-bridge.cmd",
    files: ["lan-bridge.ps1", "lan-bridge.vbs", "lan-bridge.cmd"]
  },
  portalHosts: [
    "http://192.168.0.112:8787",
    "http://tudb01:8787",
    "http://127.0.0.1:8787",
    "http://localhost:8787",
    "http://127.0.0.1:18787",
    "http://localhost:18787"
  ]
};
