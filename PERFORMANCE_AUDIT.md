# Performance audit

Audit date: 18 September 2026

## Verified results

| Check | Result |
|---|---:|
| 5,000-color plugin catalog assembly | 30.4 ms |
| 5,000-color alias search | 85.5 ms |
| Synthetic large-image preview generation | 45.4 ms |
| Synthetic cached-preview lookup | 0.2 ms |
| Live warm plugin catalog API, 143 colors | 25.3 ms average, 34 ms maximum |
| Live cached preview delivery | 15.1 ms |
| Production assets | 291 files, 2.46 GB |
| Web preview cache | 288 files, 4.9 MB |
| Average bytes avoided per thumbnail | 99.8% |

All platform, catalog, syntax, authentication, and performance tests pass. `npm audit --omit=dev` reports zero known vulnerabilities.

## Changes made

- Replaced web thumbnail downloads of original production assets with immutable 720 px cached JPEG previews.
- Warmed all existing compatible previews and added automatic background preview creation for new uploads.
- Limited preview generation to two concurrent jobs to prevent CPU and disk spikes.
- Added a lightweight fallback for formats that cannot be rasterized by the preview service.
- Converted server catalog assembly from repeated array filtering to indexed maps.
- Parallelized independent PostgreSQL catalog queries.
- Added a 15-second in-memory catalog cache with immediate invalidation after successful portal mutations.
- Deduplicated concurrent session lookups and added a short bounded session cache.
- Added PostgreSQL indexes for synchronization jobs, global audit ordering, and active version lookup.
- Changed the migration runner to discover and apply pending numbered migrations automatically.
- Changed Photoshop file metadata scanning from serial reads to bounded concurrency.
- Reduced the Photoshop render page to 20 cards and enabled lazy, asynchronous image decoding.
- Changed the web edit workflow to submit only changed reference/version fields and to send independent changes concurrently.

## Repeatable checks

```powershell
npm test
npm run test:performance
npm run previews:warm
npm audit --omit=dev
```

Actual first-open time still depends on PostgreSQL availability, disk speed, Photoshop/UXP startup, and the size and format of newly uploaded production files. Cached steady-state paths are now optimized and measured; unsupported PSD/PSB preview decoding uses a small fallback while the original remains available for Photoshop.

## Follow-up (2026-09-25)

Large inspection views (color details stage and request review) now use `displayImage` / `/api/display` (and request `…/display` routes): browser-native formats are served at full resolution from the original file; TIFF/PSD/PSB are cached once as `previews/<id>.full.png` with no resize. Library cards and small thumbnails remain on the 720 px JPEG `cachedPreview` path measured above. `npm run previews:warm` still warms only the JPEG thumbnails.
