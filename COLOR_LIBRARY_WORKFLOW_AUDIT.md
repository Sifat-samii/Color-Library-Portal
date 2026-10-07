# Color Library workflow audit

Audit date: 2026-09-29  
Last updated: 2026-10-07  
Scope: web portal, PostgreSQL schema and migrations, server API, browser UI, managed file storage, automated tests, and Photoshop UXP panel.

## Outcome

The portal now implements the intended shared workflow for a Client Company and its authorized Representatives. The established Approved Colors and Explore Swatches experiences remain the downstream library and discovery surfaces; the main changes are concentrated in authentication, Color Requests, Company Profile, activity attribution, and notifications.

The implemented lifecycle is:

```text
Representative submits a required hex color
  -> Administrator uploads one or more reference versions
  -> Representative approves or requests changes with feedback
     -> Changes requested: Administrator uploads the next version and review repeats
     -> Approved: color and approved references publish to the Client Library
  -> The request remains readable and commentable after approval
```

Every lifecycle action is attributed to its actor in a shared request timeline. Important actions also create transaction-backed, per-recipient notifications with unread state and a direct link to the affected record.

## Architecture

| Area | Current implementation |
|---|---|
| Web application | Express 5 JSON API and a responsive vanilla JavaScript single-page interface |
| Persistence | PostgreSQL migrations `001` through `016`; relational tenant, request, reference, activity, notification, session, audit, sync, and comment-pin records |
| Files | Managed immutable uploads with checksums, previews, Adobe RGB validation, versioning, and approved-file synchronization (`replaceApprovedFile` temp-copy + retries; resolved `FAILED` sync jobs cleared on success / migration `016`) |
| Authentication | Google OpenID Connect with authorization code, state, nonce, PKCE, signed ID-token verification, and server-side sessions |
| Authorization | Pre-authorized email records, `ADMIN`/`CLIENT` roles, active-user checks, active-company checks, and client-scoped API enforcement |
| Collaboration | Actor-attributed activity events plus per-user notifications created in the same database transaction as the business action |
| Photoshop UXP | Read-only Approved catalog plus shared Explore Swatches (`GET /api/plugin/swatches`, no personal saves). Floor computers open Plugins → Pixofix Color Library after the one-time UPIA install in `UXP/README.md` and do not run the portal. Packaged panel `0.5.11` is UXP (not CEP) for Photoshop 22.5+. On launch a spinner covers the panel until the live catalog is ready; each card then shows a spinner instead of a letter until its preview lands. It retries the last working host first, tries LAN before loopback unless that host was loopback, and uses 4s / 1s / 0.8s webview waits (JSON and preview fetches wait 8s; eight previews at a time). Client list and catalog fetch together when a selected client is already known; the client folder is scanned after the overlay hides. It loads `/plugin-bridge.html` in a hidden webview (`network.domains` and `webview.domains` are string `all`), then GET `/api/plugin` same-origin from that page. Approved card and detail pictures fetch `/api/plugin/versions/:id/preview` through that page, write a temp JPEG, and show that local file (not LAN `<img src>`). Fetch waits until a portal host is connected; a failed load is not cached. If the webview is unavailable it copies `lan-bridge.cmd`, `lan-bridge.ps1`, and `lan-bridge.vbs` to the temp folder and forwards `127.0.0.1:18787` to `192.168.0.112:8787`. A local approved file opens directly; otherwise `GET /api/plugin/versions/:id/file` downloads it. |

## Page and workflow coverage

### Sign in and access control

- The sign-in screen presents Google authentication when Google credentials are configured.
- A valid Google identity is not sufficient by itself: the normalized email must already belong to an active authorized user.
- Google issuer, audience, signature, expiration, nonce, and verified-email claims are checked before a session is created.
- The first successful sign-in binds the Google subject to the pre-authorized user record, preventing silent identity transfer by email alone.
- Password sign-in is a development-only fallback by default and is disabled in production.
- Pausing a Representative revokes all of that person's sessions. Disabling a Client Company revokes all company sessions and prevents new client sessions through either authentication path.

### Client Company registration and profile

- An Administrator can create a Client Company with multiple Representative names and email addresses in one operation.
- From Edit client library, an Administrator can permanently delete the library (`POST /api/admin/clients/:id/delete` with `{ confirmation: "delete" }`) after typing `delete` in the shared warning confirmation. That path revokes company sessions, clears non-cascading user foreign keys, deletes the client row (colors, people, and requests cascade), removes stored reference and request files, and writes a `DELETE` audit event. Pausing a library remains a separate `active: false` update.
- The Company Profile shows every active and paused Representative, Google connection state, and last sign-in time.
- Administrators can add, edit, pause, and restore Representatives. Changing an email disconnects its previous Google identity and revokes existing sessions.
- A Representative can request access for a colleague with name, email, and an optional note.
- Administrators can authorize or dismiss that request. Authorization atomically creates or reactivates the requested Representative.
- Pending and reviewed access requests remain visible, including requester, reviewer, status, timestamps, and notes.

### Color Request creation

- Hex is required and validated; Pantone and notes are optional.
- Entering a hex updates a live generated swatch and suggests a human-readable color name. The suggestion continues to follow the hex until the person edits the name.
- A Representative can generate from hex or attach images; the system always stores the generated Adobe RGB swatch in `color_request_sources` alongside any uploads (detail list: **Generated swatch**).
- Explore Swatch detail includes **Request this color** and opens the request composer with the selected name, hex, and Explore source prefilled.
- Hex lookup returns both an Approved-colors match and an Explore / swatch-library match. An Approved-colors hex remains a blocking conflict. A swatch-library-only hit shows a non-blocking notice naming the existing Explore swatch; submission stays allowed.
- Request cards identify the requesting person as well as status, hex, source preview, update time, and reference count.

### Review, revision, and approval

- Administrators upload categorized, immutable reference versions.
- Representatives can approve the current review set or choose **Request changes**.
- Requesting changes requires feedback and atomically records the feedback, marks the reviewed versions **Needs changes**, changes the request state to **Changes requested**, and records activity/notifications.
- No client review action uses rejected/rejection terminology.
- Approval records the approving Representative and exact approved versions, publishes the Approved Color under the client-provided `proposed_name`, and inserts the hex into Explore swatches with `ON CONFLICT(hex_code) DO NOTHING` (no duplicate row; existing swatch name unchanged).
- Requests remain open for attributed comments after approval.
- A comment may stay unpinned on the request, or optionally mark a point on the preview (`pin_x` / `pin_y`, 0–100%) tied to one delivery version or one request swatch (`source_id`); both image targets cannot be set together. Migration `015_comment_pins.sql` adds those columns. `POST /api/color-requests/:id/comments` remains `CLIENT` or `ADMIN` and still requires an accessible request.

### Shared request history

The request detail workroom exposes request information and chronological history through a **Show activity** control that opens a panel. The panel is not always visible in the request rail. Approved color pages do not include this control. Both Administrators and every authorized Representative of the Client Company can open it. Its Information section shows the brief, request metadata, and the selected image. History identifies the person responsible for:

- submitting the request;
- uploading or withdrawing a reference version;
- requesting changes;
- approving the request; and
- adding a comment (`COMMENT_ADDED`), including the comment text and, when known, the related image plus “On image” for pinned comments.

History rows use a subtle kind wash (created, upload, withdrawn, changes, approved, comment). Avatars are colored by party: Pixofix Administrator (`ADMIN`, orange), Client Representative (`CLIENT`, blue), or unknown (gray). The same party colors apply to comment-thread and request-brief avatars. Comment payloads may include additive `authorRole` from `users.role` (no migration); clients can ignore it. Comments also remain in the Comments section and still create notifications.

Historical request and delivery records were backfilled into the activity stream by migration `013` so existing requests do not appear empty.

### Notifications

- The application header contains a notification bell with unread count and a recent-notification popover.
- A full Notifications page supports opening the target record, marking one notification read, and marking all notifications read.
- Notifications poll every 30 seconds while a user is signed in.
- The server, never the browser, determines recipients. The acting person is excluded from the notification fan-out.
- Notifications are unique per recipient and activity event, preventing duplicate unread items.
- Request, reference, decision, comment, Representative, and access-request events are covered.

### Approved Colors and Explore Swatches

The existing browsing experience remains intact: card/grid browsing, search, saves, downloads, reference detail, and preview handling. Approved colors uses Core/Seasonal collection and does not show shade filters. Explore swatches uses shade filters and related colors. Approval remains the publication boundary for a Client Library. The Photoshop panel also exposes Explore as a Swatches library switch (`GET /api/plugin/swatches` / `…/:id/image`), separate from Approved colors and without personal saves.

## UI/UX refinement audit

The refinement pass followed familiar dashboard and workflow conventions while preserving the established Approved Colors and Explore Swatches visual language.

- Color Request totals are now actionable status filters with a visible selected state. Search and status filtering have persistent labels, a live result count, clear-filter recovery, and useful zero states.
- Request cards prioritize the decision-making information: status, name, color identity, requester, source, version count, and relative update time. Each card is one keyboard-accessible target.
- The request composer explains both swatch sources, previews generated colors live, blocks submission on an Approved-colors hex conflict (or while checking / on check error), shows a non-blocking swatch-library notice when only Explore already has that hex, and enables submission only when the selected path is valid.
- The request workroom has one primary heading, a **Show activity** control in the rail's sticky top bar, with **All requests** on the left (panel with request and image information plus history including comments; the brief stays in that panel and is not a rail section; not on Approved colors), a status card holding the role's next step and review actions, a Download link in the preview caption (original file), the same zoomable preview stage as Approved colors (viewport, zoom, navigator, Open full size on the display image, caption with file status; Compare remains request-only), a Comment control on the preview to place an optional pin on the current delivery, source, or generated swatch (markers sync with the Comments list), clearer comment language, and responsive action grouping. Version selection updates the preview without downloading; the `.page` `data-view` attribute is ignored by the global view-switch click handler so in-page clicks do not return to the list.
- Company Profile distinguishes the company view from a personal profile, uses exact Google-account language, explains access-request fields, and keeps pending and reviewed access state visible.
- Notification pages and popovers use concise relative time, unread summaries, descriptive empty states, and direct links to the affected workflow.
- Administrator Change history (`/activity`) is a day-grouped, filterable trail (not a raw audit table). Pixofix/admin, client, and system parties reuse the request-activity colors; each row links into the affected request, color, profile, or Explore record. Loading, empty, filtered-empty, and error states are covered.
- A skip link, main landmark, screen-reader labels, assertive error roles, polite live regions, visible keyboard focus, disabled-control styling, and reduced-motion support were added across the workflow.
- Responsive rules cover compact request cards, the request workroom, profile forms, action groups, and notification layouts without changing the approved library or swatch-library interaction model.

## Security controls

- HTTP-only, `SameSite=Strict` session cookies; Secure cookies in production or HTTPS deployments.
- Session tokens are random and stored only as SHA-256 hashes.
- Session lookup requires an active user and, for Representatives, an active Client Company.
- Same-origin validation protects state-changing browser requests.
- Authentication endpoints are rate-limited.
- Content Security Policy, MIME sniffing protection, restrictive referrer/permissions policies, and optional HSTS are applied. Portal pages deny framing (`X-Frame-Options: DENY`, `frame-ancestors 'none'`). `/plugin-bridge.html` and `/plugin-bridge.js` allow framing (`frame-ancestors *`, no `X-Frame-Options`) so the UXP hidden webview can load them.
- OAuth callback state is single-use and expires after ten minutes; PKCE and nonce protect the authorization exchange.
- Uploaded file count, size, and extensions are constrained; managed paths are resolved and checked before file access.
- Role and tenant checks are enforced in server routes rather than trusted to the UI.
- Production startup refuses missing Google authentication. Plugin routes are read-only, do not require a sign-in, and serve the approved catalog, swatches, and the active approved file. Portal Google and session checks still protect the web portal. Floor computers open the panel from the Photoshop Plugins menu after the one-time UPIA install in `UXP/README.md`.
- Actor activity is append-only; operational audit events remain Administrator-only. `GET /api/admin/audit` returns presented Change history fields via `presentAuditEvent` (`server/audit-history.js`) and omits raw before/after payloads and IP addresses from the JSON response.

## Performance and reliability

- Catalog responses use a short bounded cache that is invalidated after relevant mutations.
- Session lookup uses a bounded, short-lived cache with in-flight request coalescing.
- Preview generation is cached and warmable.
- Notification queries are recipient-scoped, bounded, and backed by migration indexes.
- Business actions that need activity and notifications use database transactions so their records cannot drift apart.
- Approved-file sync copies to a temporary destination with retries for transient Windows lock errors before archiving the previous file; a successful sync deletes earlier `FAILED` `sync_jobs` for that version. Migration `016_clear_resolved_sync_failures.sql` removes historical `FAILED` rows whose reference version already has `synced_at`. The Administrator Clients page summarizes Total clients, Active libraries, and People — not Sync issues — and `GET /api/admin/clients` does not return `failed_sync_count`.
- The workflow verification script creates an isolated test company and removes its database/files after exercising the full lifecycle.

## Deployment requirements

Set production secrets and Google OAuth values in the deployment environment:

- `NODE_ENV=production`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- The portal listens on every interface at port `8787` (`HOST=0.0.0.0`, dual-stack). Floor computers open the panel from the Plugins menu after the UPIA install in `UXP/README.md` and do not run the portal. Packaged panel `0.5.11` keeps a spinner until the live catalog is ready, then shows a per-card spinner instead of a letter until each preview lands. It retries the last working host first (LAN before loopback unless that host was loopback; 4s / 1s / 0.8s webview waits; JSON and preview fetches wait 8s; eight previews at a time), fetches client list and catalog together when a selected client is already known, and scans the client folder after the overlay hides. It loads `/plugin-bridge.html` in a hidden webview (`network.domains` and `webview.domains` are string `all`, `minVersion` `22.5.0`). Approved card and detail pictures load through that bridge into a temp JPEG. Fetch waits until a portal host is connected; a failed load is not cached. If that is unavailable it copies `lan-bridge.cmd`, `lan-bridge.ps1`, and `lan-bridge.vbs` to the temp folder and forwards `127.0.0.1:18787` to `http://192.168.0.112:8787`. Plugin CORS on `/api/plugin` includes `Access-Control-Allow-Private-Network` and echoes `Origin`. Allow inbound TCP `8787` on the computer that runs the portal (Windows Firewall on a Public network needs an elevated rule). Limit that rule to the studio network.
- `COOKIE_SECURE=true` when HTTPS terminates at the app, or configure `TRUST_PROXY=true` when HTTPS terminates at a trusted reverse proxy

The Google OAuth client must allow the exact configured redirect URI. Authorized users must be created in the portal before their first Google sign-in. Google Workspace addresses are supported; authorization is based on the exact Google-verified email, not an `@gmail.com` suffix.

## Verification

- Database migrations through `016_clear_resolved_sync_failures.sql` are part of `npm run db:migrate` (and `016` has been applied locally where noted in ops).
- JavaScript syntax checks pass for the changed server and browser modules.
- The complete automated test suite passes, including platform, tenant/profile, activity, request-state, UXP, and performance coverage.
- UI regression coverage verifies navigation landmarks, live feedback, visible focus, reduced motion, request filtering and validation, identity guidance, notification zero states, Change history party colors and link targets (`public/activity.js`, `#activity` / `#references` / profile anchors), and Clients page summary/cards without Sync issues / `failed_sync_count`. Presentation coverage for `presentAuditEvent` lives in `tests/audit-history.test.js`.
- Local sync coverage asserts `replaceApprovedFile` temp-copy behavior and transient lock-error classification.
- The database-backed workflow verifier passes the generated-swatch request, notifications, first upload, changes feedback, second upload, approval, Explore publication, access request, and authorization sequence.
- Browser QA covered the redesigned request dashboard and composer, the Administrator and Representative profile views, Notifications, the request workroom, Approved Colors, Explore handoff, and the actor timeline.
- Real Google sign-in still requires deployment-specific Google credentials and an allowed callback URL; the protocol validation and authorization logic are covered locally, but a production OAuth consent flow cannot be completed without those credentials.

This document describes the current filesystem snapshot rather than a commit diff.
