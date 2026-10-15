# Existing professional recoloring: native PSD audit

15 October 2026. **The benchmark source is now the original product appearance with essential base retouching retained.** The saved Royal/Desert Taupe states are not the source for future evaluation. This document precedes further engine implementation and informs the [revised development plan](SOURCE_AND_ENGINE_PLAN.md).

## Scope and preservation evidence

All **16 input PSDs** were opened from workspace copies and duplicated again inside Photoshop **25.3.1**. Inspection captured the complete hierarchy, sibling order, own/effective visibility, adjustment payloads, blend modes, opacity/fill, clipping, masks and channels/paths. Experiments changed visibility only on disposable duplicates; they did not change adjustment parameters, reorder/delete layers, flatten, save or overwrite a PSD.

The audit recorded **1,164 layers**, **728 pixel masks**, **153 non-Heather-Ash native human appearances**, **45 shared-base layer ablations**, and **nine Desert Taupe texture ablations**. Every opened input retained its history/visibility signature; duplicate visibility was restored before disposal. All 16 staged PSD SHA-256 values remained unchanged. The supplied Z: originals were used only for copying/read-only metadata inspection. [Full native inventory and rendered findings](verification/cbi-human-techniques.json), [byte-integrity verification](verification/cbi-source-integrity.json)

The 153 appearances represent 152 view/color pairs plus a second Desert Taupe revision in Sample 2 view 04. Heather Ash's eight branches were preserved and inventoried but excluded from rendering/evaluation as previously instructed. Sample 1 contains six editable color branches per view; Caribbean Blue and Teal Blue have supplied JPEG gold but no corresponding native branch in these source PSDs.

A separate bounded PSD-record inspection covered the 16 sources and **all 112 Sample 2 output PSDs**. The source record counts agree with native layer counts after excluding group-closing records. All 112 output PSDs are 8-bit, with no primary layer records and no alternate layer-record block; their additional block is `CAI `. The two earlier native opens showed a single Background layer. Thus the input PSDs supply the editable human recipes; the output PSDs supply composite gold images. A PSD extension alone does not imply adjustment editability. [Adobe PSD record specification](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/)

## Observed adjustment vocabulary

| Family | Layers | What was actually observed |
| --- | ---: | --- |
| Curves | 145 | Composite-channel custom points; nonzero black floors, shaped midtones and sometimes lowered white endpoints; some Screen blending and partial opacity |
| Levels | 109 | Input/output endpoints, gamma, Screen blending, and occasional individual-channel corrections |
| Hue/Saturation | 90 | Master neutralization and targeted color ranges with explicit fall-off boundaries |
| Color Balance | 77 | Separate shadow/midtone/highlight corrections; Preserve Luminosity is not always enabled |
| Brightness/Contrast | 53 | Additional tonal refinement, including shared corrections outside `CC` |
| Black & White | 48 | All 48 use **Tint**, including colored outputs such as Wine and Royal |
| Solid Color | 126 | Color blend for chroma, plus distinct Normal/Multiply/background uses |
| Selective Color | 16 | Targeted neutral/black correction; Relative mode present |
| Gradient Map | 0 | No example in these supplied inputs; this does not establish that it is unsuitable elsewhere |

The remaining layers are 243 groups, 153 raster layers and 104 Smart Objects. Native blending includes 235 Pass Through, 733 Normal, 114 Color, 33 Screen, 25 Overlay, 17 Soft Light and seven Multiply layers. Fifty-one layers use partial opacity. These counts include references and base corrections; they are not all recoloring operations.

No custom PSD source/destination Blend If ranges or clipping-to-previous-layer relationships were observed. Do not credit Blend If with the human edge quality in this corpus. Preserve/support it when encountered in other documents, but test it separately as a proposed improvement. The PSD read captures split range values directly; the broad native `get(layer)` did not expose those ranges. [Adobe blending and group semantics](https://helpx.adobe.com/photoshop/using/layer-opacity-blending.html)

## Actual human recipe examples

The sequences below are **bottom to top**, matching processing order. Numeric settings are development observations in the source's Adobe RGB context, not production presets or HEX definitions.

**Sample 1, front, Ceil Blue:** Curves → Levels → full desaturation → Solid Color in Color mode → Color Balance. The curve uses approximately `(0→58, 54→183, 255→255)`. Levels uses gamma `1.02`, output `13…250`. The Color fill is approximately Adobe RGB `(127,149,196)`; midtone Color Balance is `(-1,+1,-4)` with luminosity preservation. The method deliberately changes black floor and tonal shape before setting chroma. The current engine's fixed-endpoint, one-anchor curve is a smaller model.

**Sample 1, front, Wine:** Levels (input white `239`, gamma `1.03`, output black `6`) → full desaturation → Color fill → shadow/midtone Color Balance → a red-range Hue/Saturation correction. The final range has a wrapped `315/345/15/45` transition and saturation `+6`. Merely copying three master Hue/Saturation values would omit this technique.

**Sample 1, front, Black:** Curves → desaturation → Selective Color on Blacks. The curve lifts black to `3`; Selective Color changes black by `-6` in Relative mode. This is more specific than applying a neutral solid fill.

**Sample 2, front, Wine:** shared garment neutralization below `CC`, then Levels gamma `1.14` → Brightness `+12` → tinted Black & White with tint approximately `(87,42,64)` → Color Balance. Tint is not interchangeable with a Color-mode solid fill; native rendered comparison is required.

**Sample 2, front, White Gardenia:** Curves at about `90.20%` → Brightness `+12` → Color fill → composite/blue-channel Levels → Color Balance. The curve includes `(20→143, 98→168, 193→188)`, and composite Levels gamma is `1.6` with output `19…247`. This provides evidence for shaped dark-to-light tonal compression and explicit undertone handling, not a universal white recipe.

**Sample 2, Desert Taupe:** Screen-mode Curves, desaturation, Color fill, hue-range refinement, Color Balance, and target-specific raster material treatment. In the front view, Curves includes `(0→108, 68→218, 255→255)`. The texture subgroup uses Soft Light and Overlay raster layers around `70.20%`; another raster uses Multiply around `78.04%`. These are separate, editable contributions and must not be labeled as purely native color adjustments.

All parameters and their exact per-view differences remain in the [machine-readable audit](verification/cbi-human-techniques.json). Reuse technique families and tested parameterization; do not copy a named target's hidden settings into evaluation.

## Separating original appearance from recoloring

| Component | Evidence and proposed treatment |
| --- | --- |
| `CC/<target>` branches | Identified by hierarchy, native payloads and individual rendered appearances. Disable every target branch for an original-source candidate; retain all branches, children and masks intact. Keep each human appearance separately as development gold. |
| `CC` outer mask | Candidate target-independent garment coverage shared by the branches. Preserve bounds, antialiasing and exclusions. Designer review is still needed; its existence is not segmentation-quality proof. |
| Sample 2 root Hue/Saturation / `BASS` | Shared recoloring preparation **outside `CC`**. Six views have desaturation without a lightness change. Turning off `CC` alone therefore does not recover the original color. Disable this chromatic preparation in original-color candidates; preserve its recorded state for reconstructing human gold. |
| Sample 2 view 01 `Hue/Saturation 3`, ID 339 | Saturation `-100` **and lightness `-3`**. The chromatic role is clear; whether the tonal component is essential base lighting or recoloring preparation remains ambiguous. Candidate renders are retained; source qualification needs that decision. |
| Sample 2 view 07 `BASS`, ID 167 | Hue `-43`, saturation `-50`, lightness `-4`. Another mixed chromatic/tonal layer requiring an explicit source-role decision. Do not treat every `BASS` layer as identical. |
| `BG` branches | Masked background/environment corrections, including Color fill, Curves, Multiply and Overlay noise. Retain their saved states. Their adjustment type does not make them product recoloring. |
| Sample 1 `AD/Levels 2` | Shared, locally masked tonal correction in seven views. Retain in the candidate source; essential purpose/location requires review rather than inference from `AD`. View 08 does not contain this group. |
| Top `Layer 1`, `RT`, `Logo`, root `Texture` | Raster/group contributions outside target branches. Controlled removal renders are available. Preserve them by default; their names and bounds do not establish whether they are cleanup, finishing, original detail, or baked target-dependent paint. Sample 1 view 06's root `Texture` is a specific ambiguity. |
| Shared external tone controls | Sample 2 view 04 has active Brightness `+7`; view 08 has Levels gamma `0.98`. Retain pending purpose review. A hidden Brightness layer in view 05 stays hidden; do not activate historical alternatives. |
| `REF` and placed reference assets | Guide content is excluded from candidate/product renders without deletion. Preserve visibility provenance and embedded assets; these are not the product source. |

The rendered candidates show dark green material for Sample 1 and nearly black material for Sample 2. Front diffuse diagnostics are approximately Lab D50 `(26.35,-42.79,3.47)` and `(12.84,0.91,-2.09)` respectively. These are masked-image statistics, not physical color specifications. Both candidates retain shared cleanup/background/lighting layers.

## Texture, masks and layer-order implications

Switching Desert Taupe's texture subgroup off/on changed the normalized detail proxy by factors **1.22–1.56** across the nine revisions; the front ratio was approximately **1.46** while diffuse color changed little. Visual comparisons confirm an added weave treatment. The earlier Wine test inherited this from its incorrectly selected Desert Taupe source. It cannot be used as evidence of original-fabric preservation or a general engine texture failure without rerunning from the corrected source.

Do not silently carry that treatment into Wine, Black or other targets. Matching an authored material/texture variant may exceed the initial color-only scope. Preserve the existing professional treatment for study and manual work; automatic texture invention remains excluded.

Of 728 masks, **640 are completely white and 88 nonuniform**. One target-child exception is `HH00074_08.psd / CC / Royal / Curves 13`, which has a nonuniform correction mask. New recipes can omit redundant white child masks, but must support genuine local corrections. Three background child masks are disabled; retain that state. All measured mask densities were 100% and feather values zero; no vector masks were present, although named paths remain in the documents. Some source masks extend outside the 1300×2000 canvas, so retain offsets and crop only in document coordinates.

The human target branches sit below some existing finishing/retouch layers. `RT` is below `CC` in Sample 1's front document and above `CC` in Sample 2's front document: the same name does not define a universal insertion point. The prototype instead inserts above the complete rendered source. That difference is a **testable explanation**, not a confirmed cause, of the Ceil Blue halo. Compare source identity and insertion location independently before applying a blanket mask contraction or changing group blending. Preserve original layer order and use an explicit, reviewed material-processing insertion point. [Adobe Pass Through behavior](https://helpx.adobe.com/photoshop/using/layer-opacity-blending.html)

## Ground-truth and measurement limits

Each of the 153 captured human appearances has its own source hash, group ID/path and supplied-JPEG correspondence. Duplicate names are not sufficient identity: view 04 contains two distinct Desert Taupe groups, both captured separately. Their revision/final-delivery intent requires review; do not choose one retrospectively because it minimizes evaluation error.

Native-human versus supplied-JPEG masked diagnostic medians range from **0 to about 1.87 ΔE00**, with a median across appearances around **0.35**. This supports correspondence investigation; it is not an automatic quality pass. Alignment and comparable-region approval remain unvalidated, and those diagnostic fields explicitly remain unavailable for release scoring. Approved references remain the production target; human output is separate evaluation evidence.

During inspection, reduced 16-bit reads of an 8-bit layered PSD failed on this 25.3.1 host, while native 8-bit reduced reads and full-resolution 16-bit reads succeeded. The audit used native-depth reads without changing PSD depth. Add this combination to adapter integration tests; do not infer an image-opening or mask failure. No engine workaround was implemented here.

## Review artifacts and next decision

On 16 October the owner instructed that Sample 2 front `Hue/Saturation 3` (ID 339) and detail 07 `BASS` (ID 167) **remain flagged for retoucher review**. Their mixed tonal roles remain unresolved. Exclude those views from scored runs; do not remove or retain their lightness contribution by assumption. Other provisional source roles also still require review.

Open the local gallery at `storage/recolor-dev/human-techniques-1792074735482/analysis-1792075469223/review.html`. It contains source candidates, individual base-layer removal renders, texture comparisons, all 153 human appearances, and the layer/parameter tables. Images are reduced sRGB navigation renditions; use the original PSDs for full-resolution color/edge review. Browser interaction with this local HTML has not been verified by the agent.

Source roles remain provisional where designer intent is ambiguous. The next step is the [source qualification and engine revision plan](SOURCE_AND_ENGINE_PLAN.md), beginning with those role decisions and independent original-source baselines. The engine and production application were not changed during this audit.

The historical [engine identity check](verification/human-audit-engine-identity.json) confirms that the native-test bundle was unchanged during the human audit. Audit instrumentation is isolated under ignored development storage. Subsequent adapter fixes and the opt-in tinted candidate are recorded separately in [post-audit progress](NATIVE_ENGINE_PROGRESS.md); the audit snapshot does not identify that newer engine bundle.
