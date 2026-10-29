# Professional fabric engine — Pilot 0.7.0

28 October 2026 (Asia/Dhaka). Implemented local development upgrade; formal retoucher qualification and unseen-garment evaluation remain deferred. No neural model was trained. A completed preview does not certify physical textile compliance.

## Workflow and native methods

Confirm one fabric's mask and appearance (matte, satin, velvet, patterned, translucent or mixed). Sample representative diffuse material on the approved reference. Preview color analyzes the source, compares four native methods, refines them and checks the result. Explicit method selection/Refresh and manual controls remain available. Recoloring and surrounding reflected-color correction are separate operations; skin/background are never silently modified.

- A: Solid color and tone — native Color fill plus independent tonal shaping.
- B: Hue and selective color — targeted hue range/falloff and undertone correction.
- C: Gradient and tone — Color-blended gradient, separate luminosity shaping.
- D: Tint and levels — neutralization, tinted Black & White, Levels and Color Balance.

Shared monotonic tone curves are planned in linear luminance and encoded for native rendering. Separate source-derived shadow/highlight masks support local corrections; the parent owns material coverage once. No automatic inversion, High Pass, generated texture or blanket Screen/Divide is used. Manual intensity, brightness, contrast, shadows and highlights remain; green/magenta and blue/yellow undertone controls are added. Apply commits the exact completed preview.

## Engine and compatibility

The engine exposes analyze, fit and verify. Photoshop document ownership and modal/native operations remain in the adapter. Analysis uses a maximum 1024-pixel image, decoded RGB luminance, diffuse Lab D50, multiscale edge-aware log-luminance diagnostics and estimated source/material uncertainty. These estimates are not a physical intrinsic decomposition.

Recipe v2 (`native-fabric-1`) records source/mask/reference signatures, tonal/chromatic strategies, local corrections and initialization provenance. Recipe v1 keeps its original renderer. A 0.6.12 source snapshot and original installer are retained under local `storage/recolor-dev`.

Designer priors guide search order and score differences within 0.1, never a large mismatch or preservation failure. Every eligible family gets refinement. Difficult transitions allow 160 native evaluations; other transitions allow 96. A five-minute deadline stops additional search between operations; finalist restoration/verification finishes safely afterward. Three finalists receive deterministic native-resolution shadow/midtone/highlight patches. The selected result is restored and the canvas verified in 1024-pixel tiles. Cancellation restores the previous completed preview.

Reference shadow/highlight histograms are not optimization targets. Approved references supply diffuse color; the product supplies its own lighting structure. Navy → Aqua is a positive Tint/Levels example, not a forced winner. Gardenia's reported washout, flat gradients and poor hue result remain explicit defect scenarios.

## QualityReport v2 and draft Apply

Checks separately cover diffuse color, fold/shading structure, multidirectional source-correlated detail, uncorrelated detail/noise, highlights/shadows, clipping regions, overshoot/halos, mask-band edges, protected pixels and native ownership. Newly clipped pixels are counted independently of recovered pixels. Clipping components are per tile; boundary-crossing components may appear in adjacent records. Missing evidence is unavailable, never a pass.

- **Checks passed:** implemented checks passed under provisional development limits; not universal certification.
- **Needs review:** failed/unavailable checks or source/material uncertainty remain. Correct the preview or explicitly acknowledge Apply as an editable draft. The manifest records unresolved evidence and the override.
- **Integrity failure:** protected pixels/ownership changed. Apply cannot be overridden.

The `fabric-development-1` limits are controlled-defect safeguards, not industry tolerances: diffuse-anchor ΔE00 ≤2; detail correlation ≥0.85; relative detail 0.35–2; new clipping ≤0.1%; highlight retention ≥0.25; relative fold depth 0.25–4; bounded noise residual/halos. Formal human calibration is deferred. Satin, velvet, translucent, patterned and mixed materials receive uncertainty flags; matte solid fabric is the initial intended scope.

## Existing data, feedback and benchmarks

`npm run recolor:index` creates a local case index: 176 paired cases, eight Heather Ash exclusions, 32 unique TIFF recipes and the two designer observations. It distinguishes source inputs, gold, technique priors, missing regions and provenance. Already-used development data is never described as an untouched holdout.

Record review locally saves explicit acceptance/correction notes, signatures, recipe and quality evidence in plugin data's `recolor-feedback` folder. Rejection needs a note or defect region. Method selection and slider movement are not training labels. Calibration changes only through versioned releases, never silently during a session.

New-engine benchmark jobs set `engineVersion: "native-fabric-1"`. Scored cases require `sourceCheckpoint` (the existing checksum-verified reviewed-source JSON), an explicit reviewed source-derived mask, and `referenceRegionReviewed: true`. Reopened layer masks use structural indices/name, not old IDs. Unqualified cases are reported as excluded. Gold is opened only after fitting. Historical source ambiguity does not block normal pilot development.

## Stability and saving

Reads are tiled and image data explicitly disposed. Local masks are bounded to four million pixels; larger masks use global controls with a warning. Canonical masks above sixteen million pixels are rejected before copying pixel data into JavaScript. No multiframe/full-canvas result cache is retained. These bounds do not guarantee every huge Photoshop document.

Native operations are serialized; slider events coalesce after 180 ms. Errors preserve existing work. PSD/PSB saves reopen an owned validation copy and check profile/depth/editable hierarchy, native adjustment controls, mask bytes and tiled pixels (maximum one Photoshop 0–32768 unit, or two full-range units), then close only that copy. Gradient RGB stops are compared at native 15-bit precision; identity-curve preset labels may canonicalize from Custom to Default without changing parameters. A saved file remains available if verification or later JPEG export fails; validation failure is not reported as successful output.

The native draft-acknowledgement button is deliberate: UXP's native checkbox event bridge rejected synthetic change events during the scoped panel test. The explicit review button uses the same native event path as the other workflow controls.

Checks: `npm test`, `npm run test:recolor:fabric`, `npm run test:recolor:photoshop`, `npm run test:recolor:adjustments`. Synthetic native tests own their documents; scoped real-UXP UI tests do not alter designer image documents. Numerical, native and human evidence remain distinct.

## Development verification — 28 October 2026

The final 0.7.0 installer is `storage/recolor-dev/pilot-rBSvs1/pixofix-color-library-recolor-pilot-0.7.0.ccx`, SHA-256 `bc09241687b0794d502db6d5832536a28f4f6a824a437bd73c26721fd53f9514`. The registered development folder matches all 55 packaged runtime files. The final runtime was loaded in Photoshop 25.3.1 and its version, material choices, undertone controls and explicit draft-review button were inspected without binding an image document.

| Evidence | Result and scope |
| --- | --- |
| Full `npm test` | Passed, including 30 legacy recolor, 29 pilot-session, 16 new engine, four modal/read and two case-index checks, plus the existing application suites. |
| Complete native fixture run | 36/36 passed; frozen-source behavior, native methods, soft/offset masks, protected pixels, recovery, cancellation, independent variants and editable saves. |
| Final focused native runs | Four v2 method/save checks and one transparent-margin PSB check passed after the final pixel-read refinements. Each method coalesced 500 slider events into one queued render. |
| Scoped real-UXP interaction test | Seven checks passed using native panel events and an in-memory image adapter; no designer image documents were altered. |
| Historical scored job | All 20 attempted cases excluded for missing reviewed original-source checkpoints; none counted as a pass. |
| Existing-image diagnostics | Aqua and White Gardenia passed the implemented checks on a small material-only region; both saved masters reopened and verified. |

The transparent PSB fixture covers all 1,478,400 canvas pixels, including 1,474,304 protected pixels, across four tiles. Photoshop can change invisible RGB under zero alpha on reopening. Owned analysis buffers therefore canonicalize those invisible values; alpha remains exact and visible pixels retain the native precision limit. Source pixels are never rewritten for this normalization.

The final diagnostic source is a reduced 585 × 900 original-appearance navigation JPEG with unresolved historical source provenance, not the designer's exact Navy review. Only a 3,240-sample material region is evaluated; reference regions are provisional. Aqua's diffuse ΔE00 was 0.080, with detail correlation 0.959, highlight detail retention 0.518 and fold-depth retention 0.871. Gardenia's values were 0.222, 0.952, 0.477 and 0.827 respectively. Both had zero newly clipped or changed protected pixels. These are local diagnostic measurements, not whole-garment acceptance or textile certification. Method A won both comparisons; the positive D observation remains a conditional prior.

Earlier diagnostic masks crossed a bright background wedge and returned Needs review. Those attempts remain recorded; the final region was corrected using source-only inspection, without using human gold. Older diagnostic artifacts retain an inaccurate top-level source-policy heading; their explicit unqualified per-case status and `scoredBenchmarkEligible: false` govern interpretation. The runner now labels future diagnostic headings correctly.

Earlier native attempts and their failures are retained in the [verification record](verification/product-pilot-professional-fabric-2026-10-28.json). A diffuse-only D-layer omission and an outdated no-fill assertion were corrected. A subsequent run encountered transient native Select failures after a rollback fixture; focused rollback checks and the final complete run passed, but the transient root cause and the previously reported Photoshop crash are not established. The 36-case run and later focused runs used different recorded bundle hashes; they are not represented as one identical-build test run.

Formal visual calibration, unseen-family evaluation, production-size multi-gigabyte PSD/PSB, sustained interactive sessions and challenging fabrics remain unqualified. Screenshot capture was unavailable; panel verification used actual UXP DOM events. The upgrade is ready for designer review, with provisional checks and explicit draft handling in place.

## Primary research

[Adobe blend modes](https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/blending-mode-descriptions.html), [Adobe RGB encoding](https://www.adobe.com/digitalimag/pdfs/AdobeRGB1998.pdf), [Adobe sharpening](https://helpx.adobe.com/photoshop/desktop/effects-filters/smart-filters/sharpening-overview.html), [intrinsic-image research](https://yaksoy.github.io/ColorfulShading/), [CIEDE2000](https://www.cie.co.at/publications/colorimetry-part-6-ciede2000-colour-difference-formula-1), [Adobe Imaging API](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/imaging) and [modal execution](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/executeasmodal). The academic-use-only intrinsic model is not bundled.
