# Photoshop recoloring implementation

Status: 16 October 2026 (Asia/Dhaka). **The [human-technique audit](HUMAN_TECHNIQUE_AUDIT.md) and [revised source/engine plan](SOURCE_AND_ENGINE_PLAN.md) now govern further development.** The owner requires the underlying original product appearance with essential base retouch retained. The earlier 20-case runs used saved Royal/Desert Taupe appearances; they remain technical smoke evidence and do not qualify the correct-source workload. Stage 1A and the experimental engine exist, but original-source feasibility and the complete production workflow remain incomplete.

The production Color Library, its manifest, portal routes, database, approvals, reference opening, synchronization and favorites remain unchanged. Experimental modules are excluded from the production CCX packager. No GPU, model download, server service or installed npm dependency is required. Bounded file hashing uses a pinned MIT-licensed source file documented in [source recovery](SOURCE_RECOVERY.md).

The [16 October implementation audit](IMPLEMENTATION_AUDIT_2026-10-16.md) and [checkpoint](CHECKPOINT_2026-10-16.md) record the current implemented/pending state, corrected identity finding and source-integrity verification.

## Run the checks

From the repository root:

```powershell
npm test
npm run test:recolor:photoshop
npm run recolor:lab
```

- `npm test` runs the existing regression suite plus recoloring and dataset behavior tests for explicit-profile color math, CIEDE2000, region measurements, candidate recipes, bounded fitting, serialized controls and correct source/gold pairing. It cannot establish native Photoshop rendering.
- `test:recolor:photoshop` builds a standalone UXP `.psjs`, executes it in the installed licensed Photoshop through the Windows COM launcher, and reports actual native results. The launcher was tested on Photoshop 25.3.1. If COM dispatch is unavailable on another workstation, run the generated `.psjs` using Photoshop **File > Scripts > Browse**. The command prints its path. Do not run the same generated test twice: each run owns unique artifact names.
- The host tests create and close only their own synthetic documents, leave user documents intact, restore the previously active document, and write a report plus editable synthetic PSD/PSB files under ignored `storage/recolor-dev/<run>/`.
- Reports include a SHA-256 identity of the tested module bundle. `technicalGatePassed` describes the synthetic checks; `productionQualified` remains **false**.

The checked-in [verification report](verification/photoshop-25.3.1.json) records **25 passing native fixtures**, including native-depth pixel reads, opt-in tinted Black & White/Levels editability, and the dimension-read performance regression, with the tested bundle identity. The [capability matrix](CAPABILITY_MATRIX.md) identifies remaining limits. [Primary-source research](PHOTOSHOP_RESEARCH.md) documents API constraints and unresolved validation.

## Load the separate development panel

`npm run recolor:lab` creates `storage/recolor-dev/panel/manifest.json`. In Adobe UXP Developer Tool, choose **Add Plugin**, select that manifest, then **Load**. Open **Plugins > Recolor Lab (Development)** in Photoshop. It has a different plugin ID from the production library and needs no portal connection. Rebuild and reload after changing its source modules.

The panel bundle and manifest pass syntax/build checks. Its modeless UI and modal handoffs still require an interactive UDT session; the standalone host tests do not exercise those UI paths. Do not distribute it as the production recoloring release.

1. Open a tagged RGB 8/16-bit source. Choose **Inspect source layers**, explicitly classify base/recolor/guide/unresolved roles, choose the root insertion location, and enter the reviewer. **Confirm roles and capture reviewed source** creates the working duplicate; unresolved or stale reviews are rejected. Group roles cover descendants unless overridden. Only the duplicate is normalized to Adobe RGB/16-bit, with the historical layers retained. **Capture visible state (unreviewed experiment)** remains available for technical smoke work and is labeled accordingly. See [source preparation](SOURCE_PREPARATION.md) for session authority and limits; no layer purpose is inferred automatically.
2. Work in the preview document. Choose its current Photoshop selection, an existing pixel layer mask, saved alpha selection or vector path, then choose **Use this mask**. Prepare/refine a selection with ordinary Photoshop tools before capture. Nondefault density/feather, disabled masks and combined vector/pixel masks require an explicit designer-created selection in this version.
3. Open the externally approved reference using Photoshop or the existing Color Library. Activate that reference and select representative diffuse material. Choose **Sample active reference selection**. HEX is unnecessary. Sampling is a session experiment, does not verify or create client approval, and currently assumes the lab's matte-material scope. Untagged source/reference documents are blocked in the panel until deliberately interpreted outside the lab.
4. Return to the source preview and choose A, B or C, or **Compare and fit A/B/C**. The Photoshop canvas renders the real native adjustments at document resolution; measurements use a maximum 640-pixel edge. Compare before/after and inspect material detail and edges at 100%. The displayed number is a diffuse-anchor Delta E, not a per-pixel median/p95, a physical-swatch guarantee or a production pass.
5. Tune intensity, brightness, contrast, shadows and highlights. Pending slider requests coalesce, while each native transaction finishes before another starts. Cancel fitting stops subsequent iterations. Native edits to the preview invalidate automatic updates; use **New preview revision** to preserve existing work and start independently from the frozen source. Reloading the panel starts a new session and leaves existing documents open.
6. **Apply native adjustments** checks protected pixels at full resolution before committing the preview as an editable variant with a shared group mask, separate tonal/chromatic adjustments, a blank Edge Corrections pixel layer and a Designer Final Touch-ups group. The new panel check still needs interactive host validation. Normal Photoshop editing remains available. Commit does not certify quality.
7. **Save experimental PSD/PSB** writes a layered Adobe RGB copy through the save picker and a versioned experimental manifest to plugin data. Source/reference paths are protected. Master round trips are verified in the synthetic host tests; automatic reopening/validation of each panel-saved user output is still pending.

Multiple references may be sampled in one lab session. To try a different target after applying, create a new preview revision, select the target and preview it. Each revision starts from the frozen source. The lab does not yet retain separate tuned controls per target, generate a complete multi-color set, resume manifests after reopening, or export client delivery renditions.

## Implemented modules and interfaces

All modules are CommonJS in `UXP/recolor/`, separate from the production panel:

| Module | Interface and behavior |
| --- | --- |
| `color.js` | Explicit Adobe RGB/sRGB conversion to unrounded CIELAB D50 2-degree values, inverse conversion, gamut indication and CIEDE2000. It does not reuse the catalog's D65 calculations. Display conversion is available for later chip integration. |
| `quality.js` | `measureMaterial`, `evaluateRender`, `compareFrames` and `compareGold` report validity, diffuse-anchor difference, protected pixels, clipping and a normalized horizontal detail proxy. Exact protection requires full-resolution reads. Resampled edge changes are diagnostic only; unvalidated gold alignment cannot satisfy release thresholds. |
| `recipes.js` | `createCandidates(sourceMeasurements, target, options)` returns A/B/C by default and optional tinted Black & White/Levels D without requiring HEX; `adjustRecipe` enforces provisional parameter bounds. Only explicitly matte targets are eligible. Bounds and material rules still need benchmark calibration. |
| `fitting.js` | `fit(source, target, renderEvaluate, options)` evaluates actual rendered candidates through the callback, rejects unavailable/critical measurements, refines within a deterministic budget and restores its winner. Numerical tests use an injected evaluator; host tests use Photoshop pixels. `latestQueue` serializes/coalesces controls. |
| `native-descriptors.js` | Native A: Solid Color + Color blend + Curves; B: Hue/Saturation + Selective Color + Curves; C: five-stop Gradient Map + tonal Curves; opt-in D: tinted Black & White + Levels + separate tone/lighting Curves. Chromatic and luminosity adjustments are separate. These are experimental recipes, not calibrated material models. |
| `file-identity.js` / `source-checkpoint.js` | Bounded SHA-256, immutable frozen-source manifests, corruption checks and local checkpoint validation. Fresh-copy recovery is described in [source recovery](SOURCE_RECOVERY.md); full job recovery remains pending. |
| `source-preparation.js` | Explicit source roles, review provenance, inherited group decisions, unresolved/stale rejection and reviewed root insertion. Live-session role authority plus separately pinned frozen-source recovery. Original-source review rebinding, full job recovery and revision lineage remain pending. |
| `photoshop-adapter.js` | Capture/inspect, canonical mask acquisition, preview creation, native rendering/update, comparison, commit/cancel and pixel reads. Current document/layer IDs target objects. Expected state is rechecked inside mutation scopes. A native edit causes conservative revision preservation; no arbitrary edit merging or cross-reopen replacement is authorized. |
| `harness-panel.js` | Separate modeless development controls, explicit source binding, reference-region sampling, preview fitting and experimental master saving. |
| `host-tests.js` | Instrumented native synthetic fixtures, actual round trips and report generation. Uses standalone script execution context; plugin use instead calls short `executeAsModal` scopes. |
| `document-audit.js` / `benchmark.js` | Read-only native document inspection and instrumented actual-render feasibility jobs. Original files stay untouched. Reference regions and material masks require review; completed artifacts survive another case's failure. |

Frames contain typed RGB/RGBA data, explicit profile/maximum and full-document coordinate bounds. Masks contain one typed coverage channel, width/height, left/top offset and explicit maximum. Raw 16-bit imaging reads use `fullRange`; reduced reads of 8-bit documents use native 8-bit precision to avoid the measured resampling error. Frames report actual component size/maximum; masks retain 16-bit precision. Alpha is retained rather than implicitly matted white. Masks are read-only inputs to rendering; replace their value when coverage changes.

The default optimizer compares all A/B/C seeds equally, then refines lightness and two chromatic offsets on its strongest candidate. Explicit `includeTintedBlackWhite: true` also evaluates D with a separately versioned recipe and gamma refinement; at least five evaluations are required. See [post-audit progress](NATIVE_ENGINE_PROGRESS.md) for actual native evidence and remaining limits. It penalizes clipping/detail loss but does not yet enforce calibrated texture thresholds, use target highlight/shadow descriptors for material-aware tonal fitting, or provide held-out human-gold statistics. Full-resolution protected-pixel verification is implemented; the detail proxy does not establish visual texture fidelity. Candidate limits are experimental safeguards, not proven production limits.

## Current gate: the supplied CBI feasibility set

Reviewed sources can now be saved and restored using the lab's **Save reviewed source recovery checkpoint** and **Restore reviewed source checkpoint** controls. Keep the generated PSB and final JSON together. Recovery verifies file integrity and creates a new working source; masks, targets and edited variants still require session setup. See [source recovery](SOURCE_RECOVERY.md) for authority, cancellation and limits.

The owner has supplied the matched Z: CBI dataset and its two manifests. The [dataset audit](CBI_DATASET_AUDIT.md) records 176 paired examples, 168 included after the requested Heather Ash exclusion, approved naming aliases and the prospective 20-case selection. The [subsequent human-layer audit](HUMAN_TECHNIQUE_AUDIT.md) inspected all 16 sources, 1,164 layers, 728 masks and 153 human appearances. Correct source qualification, reference/mask validation, retoucher review and timed workflow evaluation remain necessary. Prior saved-state renders do not establish feasibility from the underlying original.

The previously discovered F: WW115 files are excluded at the owner's instruction. Sample 1's supplied human outputs are intentionally JPEG-only; that is not a missing-PSD defect. Sample 2's PSD/JPEG representations belong to the same examples and must not be counted twice.

For each selected case, validate the supplied assets and prepare:

- Original raw/PSD source and its intended profile; original framing must match the human result.
- Exact manually approved reference asset/version, historical approval provenance, client, color and material.
- Accepted human-edited PSD/PSB plus a comparable flattened rendition if available.
- Recolor/protected-region selection or mask, comparable diffuse measurement regions, and edge/detail review regions.
- Transformation category (similar tone, light-to-dark, dark-to-light, neutral, saturated), view grouping and known limitations.
- Senior-retoucher rating, correction time, manual baseline time and complete assisted-workflow time.

Preserve assets; record checksums and measurement validity. Compare each A/B/C result on the same source/mask/reference. Use Lab D50 Delta E only on valid comparable regions and aligned gold-image samples. Mark unavailable comparisons explicitly. Calibrate experimental median <= 2/p95 <= 4 targets against human repeatability, inspect texture/edges, and assess the requested 50% time reduction and 80% minor-adjustment goals. One synthetic anchor score does not establish these criteria.

The current runner still captures saved visible state. Its reports now explicitly mark source preparation unimplemented and scored benchmark eligibility false. Do not use it for original-source qualification until reviewed source preparation is integrated. For historical technical smoke jobs with explicit local paths, reference sampling regions and asset identities:

```powershell
npm run recolor:benchmark -- -Job storage/recolor-dev/cbi-20-case-job.json
node scripts/recolor-review.js storage/recolor-dev/<run>/report.json
```

The launcher attaches to the existing Photoshop instance. After native return, it distinguishes completion, errors and interrupted operations; an incomplete phase never counts as a pass. It preserves completed case records and requests document inspection after hard cancellation without closing unknown documents. The review builder creates a local `review.html` comparison gallery, `summary.json` and a downloadable retoucher form. Navigation images are reduced sRGB renditions; inspect masters in Photoshop at 100%. Retoucher notes must be downloaded before closing the page. They do not automatically authorize production.

## Approved remaining sequence

| Step | State / next deliverable |
| --- | --- |
| 1A native integration | Implemented technical harness; 25.3.1 synthetic evidence recorded. Real workstation UI, document breadth and production-size testing remain. |
| 1B feasibility | Human audit and revised plan complete; ambiguous base roles remain for review. Qualify original-source states, test insertion context and revised native families, then rerun all development cases under one pinned version. Earlier saved-state runs are superseded for source qualification. |
| 1C reference preparation / preview | After the gate: additive PostgreSQL prepared-reference revisions and admin preparation, UXP read-only retrieval, material applicability, reference checksum/provenance, prepared target selection, per-target settings, production preview UI and Adobe RGB chip correction. Historical approvals remain authoritative. |
| 1D production workflow | Independent multi-variant generation, explicit ownership/revisions, local recovery manifests, destination export presets, per-output validation, 100-case development evaluation, scoped designer pilot and client/material flags. |
| 2 assisted segmentation | Optional authenticated SAM 2.1 adapter behind the canonical mask interface, corrected/protected masks, cancellation and temporary transfer. Pin licenses/checkpoints; unavailable processing must leave native-mask recoloring usable. |
| 3 advanced processing | Shared GPU endpoint, PostgreSQL durable leasing/recovery, bounded concurrency, refinement and independently validated additional material recipes. |

Production masters will embed Adobe RGB (1998); web delivery will be converted to sRGB on an export duplicate. Other deliveries require explicit destination presets. The lab currently saves only experimental Adobe RGB masters. No neural pixels, segmentation, automatic material recognition or physical-swatch claim is included in this increment.
