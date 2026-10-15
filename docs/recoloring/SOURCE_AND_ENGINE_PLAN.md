# Revised implementation sequence after the human-layer audit

15 October 2026. This amends the approved three-stage plan using the [actual PSD findings](HUMAN_TECHNIQUE_AUDIT.md). It does not authorize an assumption about ambiguous layer purpose. The original-source requirement replaces the saved-visible-appearance benchmark policy. All original PSDs and existing professional recipes remain intact.

## 1. Qualify and freeze the correct source

Create a versioned **Source Preparation** manifest for each original view, separate from the approved color reference and from each target recipe. Bind it to the original SHA-256, profile, dimensions, full hierarchy/order, role decisions and visibility state.

The [initial source-policy manifest](verification/cbi-source-policy.json) records the observed branches and pending decisions for all 16 views. This is internal source preparation, not another client color approval; historical approvals remain authoritative.

On a working duplicate:

1. Exclude reference-guide display content.
2. Disable identified target-color/material branches, preserving their complete contents and masks.
3. Disable shared chromatic recoloring preparation outside those branches. Resolve mixed chromatic/tonal layers individually; do not discard essential lighting merely because a layer also desaturates.
4. Retain background, cleanup, lighting, labels and finishing layers in their existing order and saved states. Unknown raster content is retained and flagged until its purpose is reviewed.
5. Have the designer compare the candidate source and base-layer ablations. Record accepted source roles, the material-processing insertion location and the confirmed target-independent mask.
6. Freeze an owned Adobe RGB 16-bit working source only after the source state is accepted. Do not save over the input or alter its history.

Immediate decisions: Sample 2 view 01's `Hue/Saturation 3` lightness `-3`; view 07's `BASS` lightness `-4`; shared top raster finishing layers; Sample 1 view 06's root `Texture`; and shared external brightness/Levels adjustments. The audit supplies actual IDs, paths, parameters and removal renders. Preserve unknown layers by default; mark unresolved sources ineligible for scored qualification rather than silently choosing an interpretation.

**16 October owner decision:** keep Sample 2 view 01's `Hue/Saturation 3` (ID 339) and view 07's `BASS` (ID 167) flagged for retoucher review. Neither layer's lightness contribution has been accepted as base lighting or recoloring preparation. Both views remain excluded from scored benchmark runs; retain the alternative source renders and unchanged human payloads. This decision does not qualify the other views, whose base-role and insertion-location reviews remain pending. Synthetic adapter and recipe integration work can continue independently.

If a mixed layer's tonal contribution must be retained, keep that human layer unchanged and preserve its full recipe. After the role decision, represent any required independent base-tone correction in separate owned editable content and verify its native rendering. Do not silently change the original Hue/Saturation payload to approximate a decomposition.

No generic production rule such as “disable CC,” “disable all color adjustments,” or “delete Texture” is acceptable. New documents may lack these names and structures entirely. The source-role workflow is optional for layered documents; ordinary clean images still use source pixels and an explicit designer mask.

## 2. Separate human gold, reference targets and engine inputs

Maintain three distinct records:

| Record | Purpose | Allowed to influence fitting? |
| --- | --- | --- |
| Source Preparation | Original product appearance, retained base retouch, profile, material mask and insertion context | Yes |
| Prepared Approved Reference | Versioned client reference, ICC interpretation, material applicability and validated sampling regions | Yes |
| Human Appearance / Delivered Gold | Existing professional target stack, its dependencies/revision, and paired rendered output | No, except as development research; evaluation reads it only after result freezing |

Register all 153 existing non-Heather-Ash appearances individually. There are 152 unique corresponding view/color pairs and one additional Desert Taupe revision. Retain the 16 Sample 1 JPEG-only color/view results without inventing missing editable recipes. Deduplicate PSD/JPEG representations of the same delivered result. Keep ambiguous native/export revisions separate until provenance is resolved.

All supplied CBI products/views now belong to the **development corpus**, because their human adjustments have been studied. Do not relabel another view of these products as untouched held-out data. Obtain separately sealed, unseen products/source sessions for later qualification; split by product/capture family, not random view or color rows.

For sealed evaluation, the fitter receives only normalized source measurements/pixels, the declared source-derived mask, prepared reference data and bounded native-render feedback. It receives no human target curves, layer payloads, target-specific texture/paint, gold pixels or gold file paths. Keep gold loading in the separate evaluator after freezing the result. Preserving old layers in the PSD must not make their settings accessible as optimization inputs.

Add behavioral leakage checks: identical visible sources/masks/references with different hidden human recipes must produce the same fitted parameters and rendering; changing or withholding gold must not change fitting. Freeze masks and measurement regions before evaluating target outcomes. Reusing an existing mask must be explicit and target-independent, not copied from a held-out target's corrective mask.

## 3. Expand the experimental native engine from observed techniques

Retain A/B/C as comparison baselines. Add technique variants rather than selecting a production winner by how often a designer used a layer family.

| Candidate work | Why it is needed | Verification |
| --- | --- | --- |
| Source neutralization slot | Human workflows remove source hue before applying chroma; shared preparation may live outside a target group | Source-color contamination and neutral-underlying behavior across green/black inputs |
| Multipoint Curves and Levels | Observed recipes use black floors, white ceilings, gamma and shaped tonal compression | Rendered shadows/midtones/highlights, monotonicity, local contrast, clipping and banding |
| Color Balance / range Hue-Saturation / Selective Color | Undertones are refined by tonal zone or source-color range | Actual native range descriptors, neutral casts, safe parameter bounds and mask containment |
| Normal versus Luminosity tonal strategies | Human tone layers are not universally Luminosity; later chromatic layers interact with them | Controlled same-source/mask/reference comparisons; never assume equivalent rendering |
| **D: tinted Black & White + Levels, optional Curves/Color Balance** | All 48 observed Black & White layers use Tint, including colored variants | New native creation/update/editability fixtures, then equal-budget comparison with A/B/C |
| Separate localized correction masks | One human target-child curve uses a genuine nonwhite mask | Derive future corrections from the source/reference; retain editable masks, avoid double soft coverage |
| Explicit source processing location | Human recoloring sits below shared finishing layers | Preserve original layer order; compare with the prototype's previous top-of-stack placement |

Learn parameter families and safe limits from development cases. Do not use a color-name-to-human-curve lookup as a generalized engine. Reference colors remain authoritative, with no required HEX. Gradient Map remains an experimental alternative even though this corpus contains no example.

Do not transfer Desert Taupe/Heather raster textures into the recovered source or other colors. The initial release remains color-only: preserve recoverable original texture, identify low-detail/low-signal dark-to-light limitations and provide manual correction. Authored material/texture variants remain separately classified; they do not justify invisible reconstruction or claiming raster texture as a native adjustment.

## 4. Diagnose edges and establish valid color objectives

Before tuning a broad benchmark, run a small controlled matrix on the recorded Ceil Blue failure:

- Correct original source versus historical saved-color source.
- Reviewed material-processing insertion location versus top-of-stack placement.
- Identical mask and native recipe for each comparison.

Measure full-resolution boundary bands, protected pixels, source-color fringes, halos and stitching/label regions. Keep changes independent to identify the cause. The earlier outside-mask invariant passed despite a visible inside-mask halo, so it is necessary but insufficient. Do not impose a universal mask erosion, feather or Normal-group substitution.

The current whole-mask IQR diffuse anchor is a diagnostic, not a complete perceptual match objective. Validate comparable fabric regions and their lighting/material interpretation with the retoucher. Fit bounded chroma and tone behavior without transferring an entire reference histogram or forcing shaded pixels toward one flat color. Compare against aligned human gold only in evaluation. Report unavailable measurements explicitly when regions are not comparable.

The actual recovered inputs are dark: Sample 1 is green, Sample 2 nearly black. Re-establish transformation eligibility, noise/detail thresholds and safe tonal limits from these sources. Earlier saved-appearance quality numbers and timing improvements cannot qualify this workload.

## 5. Verification, editable output and designer review

Extend real Photoshop tests for native-depth reduced reads, D-family descriptors, strong dark-to-light transformations, nonzero tone endpoints, shared finishing layers above the recolor group, nonuniform child masks and off-canvas source masks. The audit observed a 25.3.1 reduced-read precision combination that needs an adapter regression. Mocks/source-text checks cannot establish these properties.

Insert a new owned recolor group at the reviewed material-processing location without moving/deleting existing content. Disable old target branches only in the working duplicate. Preserve finishing/label/cleanup layers above it and base image corrections below it. Copy canonical mask coverage once into the owned group; do not nest it inside an already masked human group and unknowingly apply coverage twice. Ordinary flat inputs get an independent owned group above the source.

Keep chromatic, tonal, local edge and designer corrections separately editable. Preserve original layers, masks, channels, paths, blend settings and historical branches. Every color starts from the same accepted frozen original source. Save/reopen must verify the actual native structure and rendered changes, not only a filename or group name. Native IDs require validation against source hash, path/order and ownership; duplicate Desert Taupe names demonstrate why names alone are unsafe.

Rerun the selected 20 development cases from accepted sources under one pinned engine/QA version. Retoucher review must record mask corrections, color/tonal edits, detail/edge findings and complete workflow time. Apply the original experimental acceptance targets only where the measurement methodology is valid. No release claim follows from a low anchor score or diagnostic match between an existing human stack and its JPEG.

## 6. Resume the approved stages at the right gate

1. **Audit complete:** native layer/parameter inventory, controlled human renders, source candidates and ambiguity list are available. Source-role signoff remains open.
2. **Next Stage 1B:** source qualification, adapter compatibility regression, focused edge experiments, expanded native recipe candidates and reference-driven fitting calibration.
3. **Then Stage 1C/1D:** prepared-reference backend, production preview, per-target controls, independent variants, recovery manifests, client export presets and the 100-case development/designer pilot after useful professional results are demonstrated.
4. **Stage 2/3 unchanged:** optional segmentation remains behind the mask interface; shared GPU/durable orchestration comes later and must preserve the native-mask workflow.

Re-estimate after original-source feasibility and role review. The audit establishes mechanisms and dependencies; it does not establish a production-ready generalized engine. No engine or production-system changes were made for this investigation.

**16 October implementation update:** the native-depth reduced-read regression is fixed, and opt-in tinted Black & White/Levels candidate D passes native creation, updates and editable PSD/PSB round trips. All 18 native fixtures pass. See [post-audit progress](NATIVE_ENGINE_PROGRESS.md) for versioning, evidence and limits. These independent synthetic checks do not resolve source-role ambiguities or pass the original-source feasibility gate.

**Next implementation slice:** [reviewed source preparation](SOURCE_PREPARATION.md) now provides explicit roles, stale-review rejection, duplicate-safe structural locations and root-level insertion beneath finishing work. Four additional native scenarios bring the passing count to 22, including historical-payload preservation and hidden-recipe independence. This first manifest version is live-session only; file SHA-256 pinning, durable revisions and benchmark consumption still precede scored original-source qualification.

**Checkpoint update:** [frozen-source recovery](SOURCE_RECOVERY.md) now saves and validates a layered PSB plus checksum manifest, with fresh-copy restoration, cancellation and corruption refusal. Identity-safe creation/opening was audited and all 25 native fixtures pass. [The implementation audit](IMPLEMENTATION_AUDIT_2026-10-16.md) records the remaining gate; full job recovery, benchmark integration and real original-source quality remain pending.
