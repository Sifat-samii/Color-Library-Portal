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
- Limited preview generation to four concurrent jobs to prevent CPU and disk spikes.
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

Actual first-open time still depends on PostgreSQL availability, disk speed, Photoshop/UXP startup, and the size and format of newly uploaded production files. Cached steady-state paths are now optimized and measured. When Sharp cannot decode PSD or unsupported TIFF, `cachedPreview` caches a JPEG placeholder at the requested edge (720 px unless the caller asks for 360 px) so web cards and the Photoshop panel still receive an image; the original remains available to open in Photoshop.

## Follow-up (2026-09-25)

Large inspection views (color details stage and request review) now use `displayImage` / `/api/display` (and request `…/display` routes): browser-native formats are served at full resolution from the original file; TIFF/PSD/PSB are cached once as `previews/<id>.full.png` with no resize. Library cards and small thumbnails on the web portal remain on the 720 px JPEG `cachedPreview` path measured above. `npm run previews:warm` still warms only the JPEG thumbnails.

## Follow-up (2026-10-07)

`cachedPreview` writes a JPEG placeholder at the requested edge when Sharp cannot rasterize the original. `GET /api/previews/:versionId` and `GET /api/plugin/versions/:id/preview` (720 px by default, 360 px with `?w=360`) therefore return an image instead of an SVG or 404 JSON on those decode failures. Improving actual rasterization of those formats remains a follow-up.

## Follow-up (2026-10-08)

Portal library cards stay on the 720 px JPEG (`previews/<id>.jpg`, `GET /api/previews/:versionId`). `npm run previews:warm` still warms only those files. The Photoshop panel (`0.5.15`) reuses a plugin data JPEG (`pixofix-pv-<versionId>.jpg`) before any download, then loads remaining card and detail thumbs in two batches of 24 from `GET /api/plugin/previews?w=360&ids=` (`{ previews: [{ id, jpeg }] }`, `jpeg` base64). The webview batch waits 20s. A failed batch falls back to `GET /api/plugin/versions/:id/preview?w=360`, which stores `previews/<id>.w360.jpg` and resizes from the existing 720 px JPEG when that file is present. The single plugin preview route still defaults to 720 px. `previewCacheRelativePaths()` includes the `.w360.jpg` file when preview files are deleted. The connecting screen stays hidden when a saved catalog is already on this computer. Card pictures already saved in the plugin data folder show with that catalog. Missing pictures load after. A successful batch is written to `pixofix-pv-<versionId>.jpg` in the plugin data folder and the card uses that file URL; a later Photoshop launch reuses that file from one data-folder listing. Cards keep the letter or hex placeholder and a spinner until the image loads (2s safety). The 360 px card JPEG is quality 55. Preview generation allows 4 jobs at once.
