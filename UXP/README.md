# Pixofix Color Library — Photoshop UXP panel v0.5.0

Last updated: 2026-10-06

The panel is the read-only designer surface for Pixofix Color Library. Client access, folders, approvals, versions, and instructions are controlled by the shared web portal. Floor computers install this panel and do not run the portal. Catalog colors may include `collection` (`CORE` / `SEASONAL`) and `editRequest` from `GET /api/plugin/clients/:id/catalog`; the panel ignores both and does not unlock or surface edit-request state. Personal portal saves (`saved` on `GET /api/client/colors`) are not included on the plugin catalog route. The shared Explore swatch library is a separate Swatches view from `GET /api/plugin/swatches`; it does not include personal saves. Panel star favorites are local to the plugin only.

## What changed

- Added the shared swatch library as a Swatches view. Search, shade filters, hex, and Open use `GET /api/plugin/swatches` and `GET /api/plugin/swatches/:id/image`.
- Added an administrator-managed client selector.
- Rebuilt search, sort, and tabs as a stable compact control group for narrow UXP panels.
- Removed folder selection and management from the designer panel.
- Shows only versions currently approved by the portal.
- Keeps favorites and local-change snapshots separate for every client.
- Opens an approved crop, full-size, PSD, PSB, TIFF, PNG, or JPEG reference in Photoshop. A file on this computer opens directly. A file without a local copy downloads through `GET /api/plugin/versions/:id/file` and is cached in the temp folder by version id and checksum. Card and detail pictures use the small JPEG from `GET /api/plugin/versions/:id/preview`.
- Displays portal instructions in the color detail view.
- Uses portal color and reference IDs as the source of truth instead of rebuilding identity from filenames.
- Shows color codes, alias-aware search, reference labels and instructions, approved version numbers, and approval dates.
- Loads the catalog when the client folder is not on this computer. Approved files without a local copy stay in the catalog as remote references. Files with no approved version still show as unavailable. Saved colors stay on this computer.
- Adds clearable search and a refined card/detail experience for docked Photoshop panels.

## Floor install

On each floor computer with Photoshop 2024 (25.x), install the packaged `.ccx` once with UnifiedPluginInstallerAgent.exe /install:

```text
"C:\Program Files\Common Files\Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe" /install "C:\path\com.pixofix.color-library_ps.ccx"
```

Restart Photoshop. Designers open Plugins → Pixofix Color Library. They do not run the portal. The portal runs on one computer, currently `TUDB01` (`192.168.0.112`) at port `8787`. The same panel also calls `http://127.0.0.1:8787`, `http://localhost:8787`, `http://tudb01:8787`, `http://192.168.0.112:8787`, `http://pixofix-library:8787`, and `https://pixofix-library`. Point the name `pixofix-library` at that computer now, and at the VPS later, then stop the portal on `TUDB01`. Allow inbound TCP `8787` on the computer that runs the portal. A local approved file opens directly. An approved file without a local copy downloads on open and is cached in the temp folder by version id and checksum.

## Development load

Build the installer once. Open Adobe UXP Developer Tool. Add this folder, select `manifest.json`, and choose Package. Keep the `.ccx` file that tool writes. Do not zip this folder by hand.

1. Start the portal from this project with `npm start` or `Start Pixofix Color Library.cmd`.
2. Open Adobe UXP Developer Tool.
3. Remove the previous development entry if it is still registered.
4. Choose Add Plugin, then select this folder's `manifest.json`.
5. Choose Load, then open Plugins → Pixofix Color Library in Photoshop.

The panel does not ask for a plugin key or server. On launch it tries the saved server list, then the hosts in `config.js`, with a 2.5 second timeout per host. It does not send `X-Plugin-Key`. A saved host must also be listed under `network.domains` in `manifest.json`. Designers cannot select or change production folders in this panel.

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
