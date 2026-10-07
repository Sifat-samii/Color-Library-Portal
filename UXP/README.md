# Pixofix Color Library — Photoshop UXP panel v0.5.11

Last updated: 2026-10-07

The panel is the read-only designer surface for Pixofix Color Library. Client access, folders, approvals, versions, and instructions are controlled by the shared web portal. Floor computers install this panel and do not run the portal. Catalog colors may include `collection` (`CORE` / `SEASONAL`) and `editRequest` from `GET /api/plugin/clients/:id/catalog`; the panel ignores both and does not unlock or surface edit-request state. Personal portal saves (`saved` on `GET /api/client/colors`) are not included on the plugin catalog route. The shared Explore swatch library is a separate Swatches view from `GET /api/plugin/swatches`; it does not include personal saves. Panel star favorites are local to the plugin only.

## What changed

- Sync keeps the full-panel spinner visible until the live catalog paints. Cards then show a per-card `.is-loading` spinner instead of letters until each preview lands. `start`, `refresh`, and `selectClient` skip the disk scan; `attachLocal` runs after the overlay hides. Client list and catalog fetch in parallel when a selected client is already known. Webview waits are 4s on the first remote, 1s on later remotes, and 0.8s on loopback. JSON and preview webview fetches wait 8s. Previews load eight at a time.
- Card and detail thumbnails load `GET /api/plugin/versions/:id/preview` through the plugin bridge (`preview-data.js` / `portal.getBytes`), write a temp JPEG, and show that local file so Photoshop 2023 floor machines show approved pictures. Fetch waits until a portal host is connected; a failed load is not cached.
- Saves the last working portal host and tries it first. LAN is tried before loopback unless that last host was loopback.
- Added the shared swatch library as a Swatches view. Search, shade filters, hex, and Open use `GET /api/plugin/swatches` and `GET /api/plugin/swatches/:id/image`.
- Added an administrator-managed client selector.
- Rebuilt search, sort, and tabs as a stable compact control group for narrow UXP panels.
- Removed folder selection and management from the designer panel.
- Shows only versions currently approved by the portal.
- Keeps favorites and local-change snapshots separate for every client.
- Opens an approved crop, full-size, PSD, PSB, TIFF, PNG, or JPEG reference in Photoshop. A file on this computer opens directly. A file without a local copy downloads through `GET /api/plugin/versions/:id/file` and is cached in the temp folder by version id and checksum. Card and detail pictures load `GET /api/plugin/versions/:id/preview` through the same webview bridge as the catalog, write a temp JPEG, and show that local file (Photoshop 2023 cannot load LAN image URLs in `<img src>`).
- Displays portal instructions in the color detail view.
- Uses portal color and reference IDs as the source of truth instead of rebuilding identity from filenames.
- Shows color codes, alias-aware search, reference labels and instructions, approved version numbers, and approval dates.
- Loads the catalog when the client folder is not on this computer. Approved files without a local copy stay in the catalog as remote references and download on open. References that are not the current approved version are omitted. Saved colors stay on this computer.
- Adds clearable search and a refined card/detail experience for docked Photoshop panels.

## Floor install

On each floor computer with Photoshop 2021 (22.5+) or later, install the packaged `.ccx` once with UnifiedPluginInstallerAgent.exe /install:

```text
"C:\Program Files\Common Files\Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe" /install "C:\path\com.pixofix.color-library_PS.ccx"
```

Install this package only when its version is newer than the one already in Photoshop. Reinstalling the same version can leave the previous panel in place. This package is `0.5.11`. On launch a spinner covers the panel until the live catalog is ready. Each card then shows a spinner instead of a letter until its preview lands. Client list and catalog fetch together when a selected client is already known; the client folder is scanned after that overlay hides. Approved card and detail pictures load eight at a time through the plugin bridge, write a temp JPEG, and show that local file, not as LAN `<img src>` URLs. Fetch waits until a portal host is connected; a failed load is not cached. It retries the last working host first, tries LAN before loopback unless that last host was loopback, and waits 4s on the first remote, 1s on later remotes, and 0.8s on loopback. JSON and preview fetches wait 8s. Late webview replies from a previous try are ignored. The panel loads `/plugin-bridge.html` in a hidden webview (`network.domains` and `webview.domains` are string `all`, no host allowlist, `minVersion` `22.5.0`) and GET `/api/plugin/*` through that same-origin page. If that is unavailable it copies `lan-bridge.cmd`, `lan-bridge.ps1`, and `lan-bridge.vbs` to the temp folder and launches the helper. Quit Photoshop completely after install, then open Plugins → Pixofix Color Library. Designers do not run the portal. Keep the portal running on `TUDB01`. Other computers open `http://192.168.0.112:8787` in a browser. Allow inbound TCP `8787` on this computer (Windows Firewall on a Public network needs an elevated rule; `Start Pixofix Color Library.cmd` prompts). A local approved file opens directly. An approved file without a local copy downloads on open and is cached in the temp folder by version id and checksum.

## Development load

From the project root, `npm run plugin:package` writes `UXP/com.pixofix.color-library_PS.ccx`. Adobe UXP Developer Tool Package also works. Do not zip this folder by hand.

1. Start the portal from this project with `npm start` or `Start Pixofix Color Library.cmd`.
2. Open Adobe UXP Developer Tool.
3. Remove the previous development entry if it is still registered.
4. Choose Add Plugin, then select this folder's `manifest.json`.
5. Choose Load, then open Plugins → Pixofix Color Library in Photoshop.

The panel does not ask for a plugin key or server. On launch a spinner covers the panel until the live catalog is ready, then opens `/plugin-bridge.html` on the last working host, then other LAN hosts, then loopback (loopback first only if that last host was loopback). The first remote waits up to 4s; later remotes 1s; loopback 0.8s. JSON and preview fetches wait 8s. Late webview replies from a previous try are ignored. Client list and catalog fetch together when a selected client is already known; the client folder is scanned after the overlay hides. Each card shows a spinner instead of a letter until its preview lands (eight at a time). If that fails it falls back to XMLHttpRequest and the loopback helper. It does not send `X-Plugin-Key`. Designers cannot select or change production folders in this panel.

After one successful synchronization, the panel caches the active client list
and approved catalog metadata (`pixofix-color-library-v1`). Swatches caches the
Explore list under `pixofix-color-library-v1:swatches`. If the client folder is not on this computer, the catalog still loads. If the portal is later
unavailable, Approved opens the last synchronized catalog from the cache and
continues using approved files already on this computer; Swatches can
reuse the last cached swatch list. The connection status reads **Offline cache**
until the portal becomes available and Refresh succeeds.

## Development check

From the project root, run:

```powershell
npm test
```

The panel never uploads, edits, renames, or deletes reference files.
