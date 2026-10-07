# Pixofix Color Library

A local-first approval and delivery system for client color references. It combines a PostgreSQL-backed web portal with the Photoshop UXP panel.

## Current system status

The portal includes Google-authorized company access, generated/uploaded/Explore-sourced color requests, versioned review and revision, actor-attributed activity, in-app notifications, Approved Colors publication, and the read-only Photoshop panel. The local database may also contain imported CBI library data.

## Start the portal

Double-click `Start Pixofix Color Library.cmd`, or run:

```powershell
npm start
```

Then open <http://127.0.0.1:8787>.

### Authentication

Production sign-in uses Google OpenID Connect. Copy `.env.example` to `.env`, configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and the exact `GOOGLE_REDIRECT_URI` registered in Google Cloud, then pre-authorize each person's Google email in the portal. Google Workspace addresses are supported.

In Google Cloud, create an **OAuth client ID** of type **Web application** and add the portal callback as an authorized redirect URI. The value must exactly match `GOOGLE_REDIRECT_URI` (including scheme, host, port, and `/api/auth/google/callback`). Configure the OAuth consent screen for the intended users; for an internal Workspace deployment, use the organization-only audience. Do not add JavaScript origins for this server-side flow.

After updating `.env`, run:

```powershell
npm run db:migrate
npm run auth:check
```

The check reports configuration, migration, and authorized-user readiness without printing secrets. `GOOGLE_ALLOWED_DOMAINS` can optionally add a Workspace-domain boundary; the pre-authorized user email list is always enforced.

`ALLOW_PASSWORD_LOGIN=true` is available only as a local-development fallback and is always disabled when `NODE_ENV=production`. Credentials and database settings live in `.env`, which is intentionally excluded from Git.

## Role boundaries

Last updated: 2026-09-30

### Client reviewer

- View their own colors, instructions, and approved references (locked Approved colors view).
- Personally save or unsave colors (`POST /api/client/colors/:id/save` with `{ saved: boolean }`). This does not require an edit unlock.
- Mark a color as Core or Seasonal (`POST /api/client/colors/:id/collection`). This does not require an edit unlock.
- Request an edit on an approved color; they do not unlock Approved colors or perform file/archive mutations themselves.
- Create color requests, review categorized deliveries, and approve or request changes.
- Cannot add library colors, upload library references, approve/unapprove/remove library versions, permanently delete colors, or archive/restore while locked.
- Cannot access another client or administrator screens.
- See all authorized and paused Representatives on their Company Profile, including Google connection and last sign-in state. They can request access for a colleague with a name, email, and optional note; the full pending/reviewed history stays visible.
- Receive in-app notifications and view the shared, actor-attributed timeline for every Color Request in their Client Company.
- View Explore swatches (`GET /api/pixofix/colors` and `GET /api/pixofix/colors/:id/swatch`) and personally save them (`POST /api/pixofix/colors/:id/save`). This catalog is not Approved colors. Clients cannot add or delete swatches.

### Administrator

- Create and update Client Companies, including multiple pre-authorized Representative emails during registration.
- Permanently delete a Client Library from Edit client library (`POST /api/admin/clients/:id/delete` with `{ confirmation: "delete" }`). ADMIN only; the Delete library control appears only on that modal. Uses the same type-`delete` confirmation as color delete. Revokes that company's sessions, clears user foreign keys that do not cascade, deletes the client row (colors, people, and requests cascade), removes stored reference and request files (and synced production copies), and writes a `DELETE` audit event. No schema migration. Distinct from pausing a library (`PATCH` `active: false`).
- Manage Representatives from Company Profile: add, edit, pause, and restore access. Email changes disconnect the previous Google subject; pausing access ends that person's sessions. Disabling a company ends all company sessions and blocks new client sign-ins.
- Review colleague access requests and resolve them as `AUTHORIZED` or `DISMISSED`. Authorization atomically creates or reactivates the requested Representative, and reviewed history remains visible.
- Receive notifications for company/request activity and see the same actor-attributed request timeline as the Client Company.
- Select each client's dedicated local production folder from the server filesystem.
- Enable or pause a library in the Photoshop client selector.
- Add library colors (ADMIN only). New colors are locked immediately; there is no automatic edit grant. New colors default to Seasonal.
- Personally save colors and mark colors Core or Seasonal without an `IN_EDIT` lock (same save and collection endpoints as clients).
- Permanently delete a color (`POST /api/client/colors/:id/delete` with `{ confirmation: "delete" }`). ADMIN only; does not require `IN_EDIT` and does not call `assertLibraryEdit`. Removes linked color requests first, then cascades the color’s references, versions, aliases, and saves. Also removes synced production copies and deletes stored files and previews. Distinct from archive (`DELETE /api/client/colors/:id`), which still requires `IN_EDIT`.
- Permanently delete one reference (`POST /api/client/references/:id/delete` with `{ confirmation: "delete" }`). ADMIN only, from the color details page; does not require `IN_EDIT` and does not call `assertLibraryEdit`. Removes that reference’s versions, synced production copies, stored files, and previews. The color and its other references stay.
- Accept, reject, or complete client edit requests (`PENDING` → `IN_EDIT` / `REJECTED`; `IN_EDIT` → `COMPLETED`). File edits, archive/restore, uploads, and approval mutations require status `IN_EDIT`; personal saves, collection changes, reference downloads (`GET /api/assets/:versionId`), permanent color delete, and permanent reference delete do not.
- Start an edit without a client request (`POST /api/client/colors/:id/edit-requests/start`). ADMIN only, from the color details Edit button. It creates an `IN_EDIT` request and unlocks the same controls as accepting a client request. A pending client request must still be accepted or rejected first. Saving details and uploading a reference ask for confirmation before they are applied. Edit details is where the administrator changes the color, its hex code (labeled Adobe RGB (1998)), instructions, reference instructions, and version notes. Approve, unapprove, remove, archive, and delete already confirm.
- While that color’s edit request is `IN_EDIT`, the administrator cannot leave the color details page until the edit is marked complete (`openEditColor` / `confirmLeaveOpenEdit` in `public/app.js`). Sidebar `[data-view]` navigation, the Approved colors back button (`returnToLibrary`), browser back/forward (`openFromLocation` / `popstate`), and logout all show the existing confirm dialog (eyebrow `EDIT IN PROGRESS`, title `Mark edit complete`, confirm label `Mark edit complete`). Cancel or close stays on the page and leaves the edit `IN_EDIT`. Confirm posts the existing complete endpoint (`POST /api/client/colors/:id/edit-requests/:editId/complete`), sets local status `COMPLETED`, toasts `Color locked again`, then continues. Tab close/reload uses `beforeunload`. Staying on the same color (reference switch, `refreshOpenColor`, Mark edit complete button) is not blocked. Successful permanent color delete passes `allowOpenEdit: true` so it does not also ask to complete the edit. No API or schema change.
- Upload categorized request deliveries (`FULL` / `QUICK` / `OTHER`) that must be Adobe RGB (1998) images (`server/color-profile.js`), and withdraw them while in review. Preview thumbnails of those deliveries are not re-encoded for Adobe RGB.
- Manage Client Libraries: summary stats are Total clients, Active libraries, and People (sum of representative counts); each card shows Colors, People, Active/Paused, the folder path, and View colors / Edit library / People. Edit library is also where an administrator permanently deletes the library (see delete endpoint above). Inspect all client colors. The Clients page does not show a Sync issues counter or Healthy/issue badges; `GET /api/admin/clients` returns `user_count` and `color_count` only (not `failed_sync_count`).
- Open Change history at `/activity` (nav label Activity). ADMIN only. Day-grouped, filterable trail of operational `audit_events` (party, record type, search) with loading, empty, filtered-empty, and error states. Pixofix/admin events use orange; client events use blue; system events are neutral — the same party colors as request activity. Each row is a link: color requests open `/requests/:id?client=…#activity` (request activity panel); colors and references open the color page (`#references` for reference entities; archived/deleted colors open `/archived`); sign-ins and representatives open the company profile person; access requests open the profile access card; client library events open the profile; swatches open Explore. `GET /api/admin/audit` returns presented events via `presentAuditEvent` in `server/audit-history.js` (party, title, subject, href, destination, recordGroup, actor name/role) plus action, entity type, client code, actor email, and created time. Raw before/after payloads and IP addresses are not included in the response.
- View Explore swatches and add a hex (`POST /api/pixofix/colors`). The Add color form fills Color name from `GET /api/pixofix/color-name` (exact CSS name, otherwise the exact Wikipedia color name, otherwise the closest name from those lists) and stores the editable text. Omitting `name` still uses the CSS keyword when the hex matches, otherwise the hex. A blank name returns 400. The swatch file is a flat Adobe RGB (1998) PNG of that hex. While a hex is typed, a notice under the hex field says “This color already exists.” when that hex is already in Explore swatches, and Add color stays disabled while that notice, a catalog check, or a failed catalog check is showing. Adding a duplicate hex returns 409. An invalid hex returns 400. Save a swatch for the signed-in person (`POST /api/pixofix/colors/:id/save`). Permanently delete one (`POST /api/pixofix/colors/:id/delete` with `{ confirmation: "delete" }`). ADMIN only.

There is deliberately no designer portal role. Designers use the read-only Photoshop panel (Approved | Swatches). It ignores edit-request state and does not receive personal `saved` flags; it may also ignore `collection`.

## Color Requests

Last updated: 2026-09-28

A Representative can start a request from a required Adobe RGB (1998) hex value, optionally add Pantone and notes, and choose Generate from hex or Upload images. Explore Swatch detail also offers **Request this color**, which pre-fills the request composer. Every create (`POST /api/color-requests`) always stores a system-generated Adobe RGB (1998) PNG in `color_request_sources` as `{HEX}-swatch.png` (profile `Adobe RGB (1998)`, storage `source-{uuid}.png`) after any uploaded images. `sourceType` is unchanged (`UPLOADED` when images are attached; `GENERATED` or `EXPLORE` otherwise). Source inserts use `clock_timestamp()` so the generated swatch sorts last and the first upload remains the card thumbnail. The detail file list labels that row **Generated swatch** (filenames ending in `-swatch.png`); older hex-only requests without a stored swatch still show a virtual `/api/color-requests/:id/swatch` entry. The new-request form keeps the generated hex preview visible when Upload images is selected.

While a hex is typed, `GET /api/color-requests/hex-match` returns `{ match, swatch }`. An active Approved-colors hit (`match`) is a blocking conflict (submit stays disabled; create returns 409). A shared Explore / swatch-library hit alone (`swatch` from `pixofix_colors`) shows a non-blocking notice — `This color already exists in the swatch library as "<name>"` — and submission stays allowed. Approved-colors takes precedence when both are present.

Administrators upload categorized, immutable reference versions (`FULL`, `QUICK`, or `OTHER`). Representatives can approve the current review set or request changes with a required comment. A change request marks the reviewed deliveries `NEEDS_CHANGES` and the request `CHANGES_REQUESTED`; the next Administrator upload returns it to review. Approval publishes the Approved Color into the Client Library using the client-provided name (`color_requests.proposed_name`), then inserts the hex into Explore swatches with `INSERT … ON CONFLICT(hex_code) DO NOTHING` so an existing swatch is not duplicated and its name is not replaced. Approved requests remain readable and commentable. A comment can also be placed on a point in the preview: `pin_x` and `pin_y` store that point as a percentage of the image, on the delivery version or the swatch it belongs to.

The request detail workroom reuses the Approved colors zoomable preview stage (`requestPreviewMarkup` in `public/requests.js`, `bindColorPreview` in `public/app.js`): viewport, zoom controls, navigator, Open full size, and a caption with file status. The stage is a `div`, not a download link—clicking the image does not download. The Download link in the preview caption (`#requestDownload`) uses the original file URL; Open full size opens the display image (`…/display`, or the generated swatch URL). Selecting a version updates the display image, navigator thumb, open-full link, caption, and status pill without resetting into a download. The `.page` shell also carries `data-view` for layout styling; the global `[data-view]` click handler ignores `.page` so clicks inside a request (or color) page do not clear the open record—nav buttons with `data-view` still switch views.

`activity_events` provides a shared chronological history of requester, uploader, reviewer, approver, and commenter. `notifications` stores a per-recipient unread/read record derived from those events. Both are created in the same transaction as the business action.

## Explore swatches

Explore swatches is a shared catalog in `pixofix_colors` (migration `database/010_pixofix_colors.sql`). It is not scoped to a client and does not use approval, references, or Core/Seasonal. `npm run db:migrate` seeds the CSS color keywords as one row per distinct hex. Administrators can add further hexes with duplicate prevention and automatic editable name suggestions from the CSS/Wikipedia color data.

Every hex is treated as Adobe RGB (1998). Shared browser encoding lives in `public/adobe-rgb.js`; server-side naming/distance and generated PNG handling live in `server/color-distance.js` and `server/adobe-rgb-swatch.js`. Generated flat swatches embed the Adobe RGB (1998) ICC profile and are cached under `storage/pixofix-swatches/adobe-rgb-1998/`.

Explore supports search, shade filters, personal saves, copying, download, related-color ranking, and Administrator deletion. The detail page can seed a client-scoped Color Request without directly inserting the swatch into a Client Library. The Photoshop panel reads the same catalog as Swatches from `GET /api/plugin/swatches` (shared portal, read-only, no sign-in, no personal saves). `GET /api/plugin/swatches/:id/image` returns the Adobe RGB PNG.

## Personal saves

Per-user favorites live in `color_saves(user_id, color_id)` (migration `database/009_color_saves.sql`). `POST /api/client/colors/:id/save` accepts `{ saved: boolean }` for `CLIENT` and `ADMIN`, does not require `IN_EDIT`, and does not write into the shared catalog cache. `GET /api/client/colors` overlays `saved: true/false` for the signed-in user via `withSavedColors`. The Photoshop plugin catalog (`GET /api/plugin/clients/:id/catalog`) does not include saves. Library cards show a heart control at the bottom right next to the options menu (hover label Save, or Saved when selected; gold fill when `aria-pressed="true"`); saved colors sort first in `drawColors`. The Approved colors view shows a live filtered result count (`#colorResultSummary`); empty search or Core/Seasonal filters use specific copy and a Clear filters control. Approved colors does not show shade filters, and `?shade=` on `/library` or `/colors/:id` is ignored.

## Core and seasonal collection

Each active color has `colors.collection` of `CORE` or `SEASONAL` (migration `database/008_color_collection.sql`; default `SEASONAL`). Catalog responses expose `collection` as `"CORE"` or `"SEASONAL"` (any other stored value is returned as `SEASONAL`). On library cards, Core appears as a top-right `core-banner` on the card preview (Seasonal colors have no banner). On the color details page, the same Core tag sits beside the color name when `collection` is `CORE`. The three-dot menu is a dark translucent circle with light dots. Menu contents: Download opens a side list of approved reference types (via `GET /api/assets/:versionId`); Collection is a labeled radio group (Core = stays every season, Seasonal = current season) with short descriptions; Copy hex shows the hex code; Archive remains the locked soft-delete (`DELETE /api/client/colors/:id`, requires `IN_EDIT`); Delete appears for ADMIN only and permanently removes the color after a GitHub-style confirmation that requires typing exact text `delete` (`POST /api/client/colors/:id/delete`). Clients do not see Delete. Closing the menu without choosing an action leaves the color unchanged. Request cards are unchanged. Library cards use a responsive up-to-five-column grid, stay keyboard-activatable without `role="button"` (so nested save/menu buttons remain valid), and scale name, Core tag, save/menu controls, and the orange hover ring with the card.

On the color details page, Hex / Pantone / Profile identifiers appear when present; Profile is `Adobe RGB (1998)` when a hex exists. The large inspection stage is a `div` (not a download link) and uses `GET /api/display/:versionId` for the zoomable image (CLIENT/ADMIN, same client access check as assets/previews): JPEG/PNG/GIF/WebP are served unchanged; TIFF/PSD/PSB are converted once to a full-resolution PNG cached as `previews/<id>.full.png` (`displayImage` in `server/previews.js`). Cards, the zoom navigator, and reference-list thumbnails still use the 720 px JPEG from `GET /api/previews/:versionId` (`cachedPreview`). Open full size currently opens `GET /api/assets/:versionId` (original file). Each reference row that has a version includes a Download button. It uses `GET /api/assets/:versionId` and suggests a filename of `{color name} {reference label}.{original extension}` (`referenceDownloadName` in `public/app.js`). Clients and administrators can download. The button remains available when Approved colors are locked; approve, unapprove, remove, upload, and edit-details controls still disappear unless an administrator has `IN_EDIT`.

## Approval and local-folder behavior

Library reference uploads are stored as immutable versions in managed storage. Approving a library version makes it active and copies it into the client's dedicated local folder via `syncApprovedVersion` (`server/sync.js`), also used from `server/index.js` and `server/color-requests.js`. The file lands in a subfolder named for the portal reference type label: `QUICK` → `CROP Reference`, `FULL` → `FULL Reference`, and custom types such as `OTHER` / `SIDE VIEW` → `SIDE VIEW Reference` (same naming as `referenceType` in `public/app.js`). Matching is case-insensitive: an existing folder is reused as-is; otherwise the canonical name is created. The synced file is `{color name}.{original extension}` inside that folder. `replaceApprovedFile` copies into a temporary `*.syncing` file (retrying transient Windows `EPERM` / `EBUSY` / `EACCES` / `UNKNOWN`), then moves any previous file at that destination into the client folder's `.archive` directory (not inside the type subfolder), then renames the temp file into place so a locked copy cannot remove the current approved file. A successful sync deletes earlier `FAILED` `sync_jobs` for that version; migration `016_clear_resolved_sync_failures.sql` clears historical `FAILED` rows whose version already has `synced_at`. Unapproving or removing the active version archives via the stored `local_relative_path`; existing imported paths are not migrated. Database history is retained for complete jobs and for failures that are still unresolved. Those library mutations (and archive/restore) require an open edit request in `IN_EDIT` for administrators; clients remain blocked. Personal saves, Core/Seasonal collection changes, and ADMIN permanent deletes (`POST /api/client/colors/:id/delete` and `POST /api/client/references/:id/delete`) are the exceptions and do not call `assertLibraryEdit`.

Separately, Color Requests carry categorized deliveries. Delivery uploads must be Adobe RGB (1998) images (`inspectImageFile` in `server/color-profile.js`); preview thumbnails are unchanged (`…/preview` → `cachedPreview`), and the request workroom’s large review image (and Open full size) use the matching `…/display` routes (`displayImage`), while the preview caption's Download link uses the original delivery/source URL. Approval publishes every `IN_REVIEW` delivery into the matching library reference. **Request changes** requires feedback, marks those deliveries `NEEDS_CHANGES`, and sets the request to `CHANGES_REQUESTED`. One `IN_REVIEW` delivery is allowed per category (`request` + `reference_kind` + `reference_label`), not one per request overall.

The Photoshop panel switches between Approved and Swatches and opens the library as soon as it loads. Floor computers open it from Plugins → Pixofix Color Library after the one-time UPIA install in `UXP/README.md`. They do not run the portal. The panel calls the shared portal in `UXP/config.js`, including `http://tudb01:8787`, `http://192.168.0.112:8787`, `http://pixofix-library:8787`, and `https://pixofix-library`. Approved colors come from `GET /api/plugin/clients/:id/catalog`. A file on this computer opens directly; otherwise `GET /api/plugin/versions/:id/file` downloads the approved file. Swatches reads the shared Explore catalog from `GET /api/plugin/swatches` and opens Adobe RGB PNGs from `GET /api/plugin/swatches/:id/image` (no personal saves).

## Database and maintenance

PostgreSQL database: `color_library_portal`

The application connects with the `TUUO_ADMIN` PostgreSQL role configured in
`.env`. If this role was assigned after the tables were originally created,
changing only the database owner is not enough. Connect to `color_library_portal` in
pgAdmin as `postgres` (or another superuser) and execute
`database/000_repair_ownership.sql` once to transfer the existing application
tables, sequences, and schema without deleting their data.

Useful commands:

```powershell
npm run db:migrate
npm run db:seed-admin
npm run import:cbi
npm test
npm run test:workflow
npm run test:performance
npm run previews:warm
```

The migration and CBI import are repeatable. Re-running the import uses file checksums so unchanged files do not create duplicate versions.
See `PERFORMANCE_AUDIT.md` for measured live and synthetic results.

## Main folders

- `database/` — PostgreSQL schema and indexes
- `server/` — authenticated API, audit, and safe file synchronization
- `public/` — responsive administrator/client portal (`adobe-rgb.js` is the shared Adobe RGB encoding)
- `scripts/` — migration, administrator seed, and CBI import tools
- `storage/` — immutable uploaded assets and generated swatches (local runtime data; Explore PNGs under `pixofix-swatches/adobe-rgb-1998/`)

## Before production use

- Set `NODE_ENV=production` and configure all Google OAuth values.
- Plugin routes are read-only and do not require a sign-in. The portal listens on `0.0.0.0` port `8787` so floor computers can reach it. Floor computers open the panel from the Plugins menu after the UPIA install in `UXP/README.md`. Limit inbound TCP `8787` to the studio network.
- Put the portal behind HTTPS and enable secure cookies (`COOKIE_SECURE=true`, or `TRUST_PROXY=true` behind a trusted HTTPS reverse proxy).
- Run `npm run auth:check` after changing authentication or deployment settings.
- Back up PostgreSQL, `storage/`, and every client folder's `.archive` directory.
- Run the service under a dedicated Windows account with access only to managed folders.
- Add scheduled database backups and disk-capacity monitoring.
