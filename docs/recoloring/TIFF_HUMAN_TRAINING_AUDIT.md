# Approved TIFF human-edit standards

27 October 2026. The recoloring pilot now uses population-level tonal and adjustment standards extracted from the approved layered TIFFs in `F:\CBI\TIFF for training`. The source TIFFs were opened read-only in Photoshop 25.3.1, inspected through native layer descriptors and closed without saving. The TIFF already open in Photoshop was reused and left open. No cleanup errors occurred.

## Corpus and integrity

- 34 Adobe RGB (1998), 8-bit TIFFs; 943 inspected layers.
- 34/34 documents inspected successfully; no source was overwritten.
- Every file was fingerprinted with SHA-256 before native inspection. The sorted corpus identity is `adc9f049810db6469c48addf7769b31373d4c7bd16bbf25039ff2706dc34be32`.
- Two full/detail pairs contain duplicate recipes. The calibrated statistics therefore use 32 unique human recipes so duplicates do not receive extra weight.
- The complete per-file hashes, layer hierarchy, adjustment payloads, target Lab values and normalized recipe signatures are retained in the [machine-readable standards](verification/tiff-human-training-standards.json). Local full native audit artifacts remain under ignored `storage/recolor-dev`.

## What the approved edits establish

| Human technique | Unique recipes | Rate |
| --- | ---: | ---: |
| Full source-color neutralization | 32 | 100% |
| Tinted Black & White | 29 | 90.6% |
| Curves | 28 | 87.5% |
| Color Balance | 23 | 71.9% |
| Brightness/Contrast | 7 | 21.9% |
| Levels | 4 | 12.5% |
| Range-specific Hue/Saturation | 3 | 9.4% |
| Target-specific raster texture | 3 | 9.4% |

The dominant editable order is tonal shaping, full neutralization, tinted Black & White, then small Color Balance or Hue/Saturation corrections. Solid Color appears in only three unique target recipes. The evidence supports candidate D as a primary technique, but the engine still compares B/C/D using the rendered reference score rather than choosing by frequency.

## Dark, middle and light behavior

Curve values below are median composite-channel outputs sampled at input `0/64/128/192/255`. Boundaries are target tint Lab lightness, not color names.

| Family | Target L* | Unique cases | Median curve output | Interpretation |
| --- | --- | ---: | --- | --- |
| Dark | `< 40` | 7 | `0 / 23 / 49 / 83 / 154` | Strong fold and highlight compression; dark targets deliberately lower the white endpoint instead of only shifting a midpoint. |
| Mid | `40–<70` | 12 | `0 / 42 / 90 / 150 / 216` | Moderate highlight compression with preserved shadow separation. |
| Light | `≥ 70` | 13 | `0 / 60 / 121 / 188 / 255` | Near-neutral upper endpoint with progressively lifted mids; highlight headroom is retained. |

Dark recipes show the widest variation and need more than a single anchor. The observed dark interquartile white endpoints are about `119–182`; mid endpoints about `195–221`; light endpoints about `244–255`. Brightness/Contrast is not a universal substitute: human values range from strong negative compression on dark/mid targets to positive lifting on light targets.

Color Balance is usually a small midtone correction, with occasional shadow/highlight refinements. The calibrated D stack therefore exposes bounded, editable midtone cyan/red, magenta/green and yellow/blue parameters while keeping Preserve Luminosity enabled.

## Texture, shadow and lighting policy

Raster texture treatment is exceptional, not a general recoloring rule. It occurs in three unique recipes, including heather treatments using Normal/Soft Light pixels and dark treatments using partial Hard Light. The pilot does not copy these pixels or invent texture for another color. It preserves the source texture, penalizes substantial detail loss and excessive amplification, and leaves authored material variants to a designer.

Approved-reference sampling now retains shadow, diffuse and highlight Lab zones. Fitting scores the diffuse color together with shadow/highlight lightness, tonal spread, zonal color, clipping and normalized source detail. Contrast, shadows and highlights are now optimized rather than existing only as manual controls.

## Implemented pilot changes

- Added interpolated five-point dark/mid/light Curves with source-aware blending; no color-name lookup exists.
- Added native full neutralization before tinted Black & White and an editable Color Balance layer after it.
- Increased automatic rendered fitting from 40 to 64 evaluations and explicit-method fitting from 24 to 40.
- Added gamma, contrast, shadow, highlight and three Color Balance fitting coordinates alongside color controls.
- Added zonal Lab measurement and a new `tiff-trained-zonal-tone-3` scorer.
- Kept legacy diffuse-only recipes replay-stable; TIFF calibration activates only when the approved reference has the required zonal measurements.
- Added repeatable corpus fingerprinting, native audit and analysis tools.

## Verification and remaining gate

`npm test` passes the complete application and plugin regression suite. The real Photoshop 25.3.1 suite passes all 30 native fixtures, including native creation/update, mask containment, calibrated Hue/Saturation + Black & White + Color Balance layers, PSD/PSB reopening, protected pixels, source preservation and adjustment-only comparison.

This materially improves the engine, but it does not by itself prove “better than human.” These TIFFs are development data and share product/workflow patterns. A credible claim still requires a sealed product-family holdout, aligned approved references, retoucher blind review, correction-time measurement and explicit edge/texture ratings. The pilot therefore remains `EXPERIMENTAL_DESIGNER_REVIEW_REQUIRED` and does not auto-synthesize the rare human raster texture treatments.
