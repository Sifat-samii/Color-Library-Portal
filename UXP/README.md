# Pixofix Color Library — Photoshop UXP panel v0.5.15

Last updated: 2026-10-08

The panel is the read-only designer surface for Pixofix Color Library. Client access, folders, approvals, versions, and instructions are controlled by the shared web portal. Floor computers install this panel and do not run the portal. Catalog colors may include `collection` (`CORE` / `SEASONAL`) and `editRequest` from `GET /api/plugin/clients/:id/catalog`; the panel ignores both and does not unlock or surface edit-request state. Personal portal saves (`saved` on `GET /api/client/colors`) are not included on the plugin catalog route. The shared Explore swatch library is a separate Swatches view from `GET /api/plugin/swatches`; it does not include personal saves. Panel star favorites are local to the plugin only.

## What changed

- A library already saved on this computer opens before the server round trip, and card pictures already saved in the plugin data folder show with that catalog. The connecting screen stays hidden when a saved catalog is already on this computer. On launch the saved catalog is requested from the last working host, the same request as Sync. Missing pictures start with that request. Loopback, the helper, and the hidden webview run only if that request fails. `start`, `refresh`, and `selectClient` skip the disk scan; `attachLocal` runs after the overlay hides. Client list and catalog fetch in parallel when a selected client is already known. The hidden webview is created only when loopback cannot reach the portal. Webview waits are 4s on the first remote, 1s on later remotes, and 0.8s on loopback. JSON and single-preview webview fetches wait 8s. Card and detail previews load in two batches of 24. The webview batch waits 20s.
- Card and detail thumbnails reuse a plugin data JPEG (`pixofix-pv-<versionId>.jpg`) when one is already on this computer. Otherwise XMLHttpRequest loads `GET /api/plugin/previews?w=360&ids=` (response `{ previews: [{ id, jpeg }] }`, 360 px JPEG, `jpeg` base64, up to 24 at a time, two requests at once). The bytes are written to the plugin data folder and the card uses that file URL. A later Photoshop launch reuses the file from one data-folder listing. Cards keep the letter or hex placeholder, with a spinner over the placeholder, while a missing picture loads (2s safety). A failed batch falls back to `GET /api/plugin/versions/:id/preview?w=360`. The single preview route still defaults to 720 px. Fetch uses the last working host first, then loopback or the loopback helper before any webview; a failed load is not cached. The webview batch waits 20s.
- Saves the last working portal host. On launch the saved catalog is requested from that host, the same request as Sync. Startup probes `127.0.0.1:8787`, then the loopback helper on `127.0.0.1:18787`, only if that request fails, and before any webview. The hidden webview, only if both fail, still tries the saved host first and tries LAN before loopback unless that saved host was loopback.
- Added the shared swatch library as a Swatches view. Search, shade filters, hex, and Open use `GET /api/plugin/swatches` and `GET /api/plugin/swatches/:id/image`.
- Added an administrator-managed client selector.
- Rebuilt search, sort, and tabs as a stable compact control group for narrow UXP panels.
- Removed folder selection and management from the designer panel.
- Shows only versions currently approved by the portal.
- Keeps favorites and local-change snapshots separate for every client.
- Opens an approved crop, full-size, PSD, PSB, TIFF, PNG, or JPEG reference in Photoshop. A file on this computer opens directly. A file without a local copy downloads through `GET /api/plugin/versions/:id/file` and is cached in the temp folder by version id and checksum. Card and detail pictures load `GET /api/plugin/previews?w=360&ids=` through XMLHttpRequest on the last working host. Loopback and the loopback helper are used only if that request does not come back online. A successful batch is saved as `pixofix-pv-<versionId>.jpg` in the plugin data folder and the card uses that file URL (Photoshop cannot show LAN URLs in `<img src>`). A data-folder JPEG already on this computer is shown without downloading it again.
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

Install this package only when its version is newer than the one already in Photoshop. Reinstalling the same version can leave the previous panel in place. This package is `0.5.15`. On launch a saved catalog opens immediately, with card pictures that are already in the plugin data folder. The connecting screen stays hidden when a saved catalog is already on this computer. Client list and catalog fetch together when a selected client is already known; the client folder is scanned after that overlay hides. Approved card and detail pictures reuse `pixofix-pv-<versionId>.jpg` from the plugin data folder when one is already saved, otherwise load `GET /api/plugin/previews?w=360&ids=` (360 px, `{ previews: [{ id, jpeg }] }`) in two batches of 24 through XMLHttpRequest, write that JPEG in the plugin data folder, and show that file URL. A failed batch falls back to `GET /api/plugin/versions/:id/preview?w=360`. On launch it requests the saved catalog from the last working host, the same request as Sync. Fetch tries `127.0.0.1:8787`, then the loopback helper on `127.0.0.1:18787`, only if that request fails, and creates the hidden webview only if both of those fail. A failed load is not cached. Webview waits stay 4s on the first remote, 1s on later remotes, and 0.8s on loopback. JSON and preview fetches wait 8s. The webview batch waits 20s. Late webview replies from a previous try are ignored. The webview, when needed, loads `/plugin-bridge.html` (`network.domains` and `webview.domains` are string `all`, no host allowlist, `minVersion` `22.5.0`). The loopback helper copies `lan-bridge.cmd`, `lan-bridge.ps1`, and `lan-bridge.vbs` to the temp folder and launches them before that webview. Quit Photoshop completely after install, then open Plugins → Pixofix Color Library. Designers do not run the portal. Keep the portal running on `TUDB01`. Other computers open `http://192.168.0.112:8787` in a browser. Allow inbound TCP `8787` on this computer (Windows Firewall on a Public network needs an elevated rule; `Start Pixofix Color Library.cmd` prompts). A local approved file opens directly. An approved file without a local copy downloads on open and is cached in the temp folder by version id and checksum.

## Development load

From the project root, `npm run plugin:package` writes `UXP/com.pixofix.color-library_PS.ccx`. Adobe UXP Developer Tool Package also works. Do not zip this folder by hand.

1. Start the portal from this project with `npm start` or `Start Pixofix Color Library.cmd`.
2. Open Adobe UXP Developer Tool.
3. Remove the previous development entry if it is still registered.
4. Choose Add Plugin, then select this folder's `manifest.json`.
5. Choose Load, then open Plugins → Pixofix Color Library in Photoshop.

The panel does not ask for a plugin key or server. On launch a saved catalog opens immediately, with card pictures that are already in the plugin data folder. On launch it requests the saved catalog from the last working host, the same request as Sync. It reaches the portal with XMLHttpRequest on `127.0.0.1:8787`, then the loopback helper on `127.0.0.1:18787`, only if that request fails, and creates the hidden webview only if both of those fail. The first remote webview waits up to 4s; later remotes 1s; loopback 0.8s. JSON and preview fetches wait 8s. The webview batch waits 20s. Late webview replies from a previous try are ignored. Client list and catalog fetch together when a selected client is already known; the client folder is scanned after the overlay hides. Approved cards show as soon as the catalog is ready. Missing pictures load in two batches of 24 from `GET /api/plugin/previews?w=360`; a successful batch is saved as `pixofix-pv-<versionId>.jpg` in the plugin data folder and the card uses that file URL; a later Photoshop launch reuses that file from one data-folder listing; 2s safety. It does not send `X-Plugin-Key`. Designers cannot select or change production folders in this panel.

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
