# Pixofix Color Library roadmap

Last updated: 2026-10-07

## Implemented in this prototype

### Photoshop panel

- Multi-client selector populated by the shared portal. Floor computers install the panel and do not run the portal.
- Admin-controlled local folders; no designer management controls.
- Library switch: Approved (client catalog, search, sort, favorites, grouped references, one-click open) and Swatches (shared Explore via `GET /api/plugin/swatches`, shade filters, hex detail with copy, Open PNG).
- Per-client local integrity snapshots that flag unexpected folder changes.

### Portal and PostgreSQL service

- Separate administrator and client roles; no designer portal account.
- Client/color management, instructions, Core/Seasonal collection labels, per-user personal saves (portal only; not in the plugin catalog), immutable uploads, approval, withdrawal, removal, and version history.
- Admin filesystem picker for each client’s dedicated production folder.
- Safe approved-file delivery with recovery archives.
- Central audit history. Sync jobs record delivery attempts; successful syncs clear earlier `FAILED` rows for that version. The Administrator Clients page shows People (not a Sync issues / historical-failure counter).

## Recommended next production milestone

Last updated: 2026-10-07

Google OpenID Connect is already the production sign-in path; password login remains a local-development fallback only. Web inspection already uses `displayImage` / `/api/display` (native JPEG/PNG/GIF/WebP at full resolution; TIFF/PSD/PSB cached once as `previews/<id>.full.png`). Card thumbnails still use the 720 px JPEG `cachedPreview` path. When Sharp cannot rasterize a format, that path caches a 720 px JPEG placeholder so the Photoshop panel and web cards still receive an image.

Remaining production hardening:

- Put the portal behind HTTPS and a private network/VPN (`COOKIE_SECURE` / `TRUST_PROXY` as documented in the root README).
- Add password reset, account lockout, and optional two-factor authentication for any remaining password fallback accounts.
- Improve thumbnail rasterization for formats that still use the JPEG placeholder.
- Add database/storage backup jobs and an administrator restore workflow.
- Add retry controls and notifications for failed synchronization jobs.
- Store the exact approved color/version IDs in Photoshop document metadata or job records.
- Add order/job IDs so every recolor is traceable to the source version used.
- Add checksum verification in the UXP panel (offline catalog cache already records `savedAt`).

## Success measures

- Median time from order color to opening the approved reference.
- Wrong-color rework rate.
- Percentage of jobs traceable to an exact approved version.
- Failed or overdue local synchronization count (unresolved only — not historical `FAILED` rows for versions that later synced).
- Duplicate/orphan reference count per client.
