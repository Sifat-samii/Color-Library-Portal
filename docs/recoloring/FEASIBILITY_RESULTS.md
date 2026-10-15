# CBI feasibility results and open gate

**Source-policy supersession:** the owner has now instructed recovery of the underlying original product appearance with essential base retouch retained. All runs described below used the saved Royal/Desert Taupe appearances. Preserve them as historical technical evidence; their color/detail/timing results do not qualify the revised benchmark. See the [human-technique audit](HUMAN_TECHNIQUE_AUDIT.md) and [revised plan](SOURCE_AND_ENGINE_PLAN.md).

15 October 2026. **The native workflow works technically; the professional-quality gate has not passed.** Production library behavior is unchanged. The complete production workflow, reference-preparation backend and segmentation have not been released.

## Actual execution

- The current [Photoshop 25.3.1 report](verification/photoshop-25.3.1.json) has 25 passing native fixtures, including the mask performance regression, independent variants, manual-edit protection and real editable PSD/PSB round trips.
- The [three-case pilot](verification/cbi-three-case-pilot.json) completed reference-based fitting, full-resolution protection checks and editable master reopening.
- The [prospectively selected 20-case baseline](verification/cbi-20-case-baseline.json) completed all 20 actual-render jobs and master checks. All A/B/C seeds were rendered on each case. Winners were selected by the experimental score, not by retoucher approval.
- Across that baseline, **30,979,847 protected pixels were compared and zero changed** before lossy encoding. This invariant does not establish correct mask boundaries, absence of halos inside coverage, or acceptable garment appearance.
- Median automated case time was approximately **21 seconds**, ranging from **16 to 187 seconds**, including capture, fitting, QA, master saving and reopening. These are standalone harness timings, excluding designer preparation, correction and export. The requested 50% total-workflow time reduction has not been measured.
- The >1 GB Sample 2 detail source completed an approximately 880 MB editable PSB round trip. A concurrent monitoring command encountered `System.OutOfMemoryException`; subsequent native cases completed with no cleanup errors. No process restart or forced termination was used. Large-document resource requirements remain unresolved.

## Findings requiring correction or review

| Finding | Evidence | Consequence |
| --- | --- | --- |
| Added light edge contour | Visual inspection of Sample 1 / Ceil Blue / view 03 shows a white outline absent from its source and human result | Release-blocking edge defect. Check the native master at 100%, mask coverage and tonal/blending behavior. Zero outside-mask differences do not clear this finding. |
| Tonal/material mismatch | Sample 2 Wine retains strong source weave/fold contrast compared with the supplied human result | Anchor fitting alone cannot establish a professional match. Calibrate source/material tonal behavior; do not blur or invent texture to improve a number. |
| Saturated-color scoring defect | The original scorer penalized any channel at zero/max as lost tonal detail, disadvantaging legitimate saturated targets | Corrected: complete black/white tonal clipping affects the score; per-channel clipping remains a diagnostic. Further channel-detail and gamut review remains necessary. |
| Source interpretation | Input PSDs already contain recoloring groups; visible front appearances are Royal and Desert Taupe | Resolved policy: recover the underlying original color on duplicates, retaining essential base corrections. These historical runs used the previous source state. Specific mixed-purpose layers remain flagged in the new audit. |
| Measurement validity | Reference torso regions and existing CC masks are internally prepared, provisional inputs; paired human-image alignment is not validated | Human-gold median/p95 statistics are diagnostic only. No physical-swatch, median ≤2/p95 ≤4, or cross-view acceptance claim. |
| Productivity and human acceptance | No timed retoucher study or correction ratings supplied | Neither the 50% time reduction nor 80% minor-adjustment target has been demonstrated. |

The original baseline's median diffuse-anchor ΔE00 was approximately **0.41**; 18 of 20 anchors were ≤2. This is a median across one anchor per case, **not** a per-pixel color-accuracy acceptance score. The clearly visible Ceil Blue defect occurs despite an anchor score below 2.

## Controlled scoring correction

The [two-case calibration](verification/cbi-clipping-calibration.json) used the same source/reference regions, masks and 16-evaluation budget as the baseline. Only the scoring definition changed. Teal Blue's anchor residual fell from **6.88 to 0.99**, and Hunter Green's from **3.34 to 0.22**. These improvements did not require a larger search budget. The [corrected master run](verification/cbi-corrected-masters.json) repeated those outcomes and verified editable PSD round trips with unchanged protected regions.

This targeted calibration is separate from the original 20-case report. The updated policy has not yet been rerun and reviewed across the full 20-case set. Do not combine both runs into a claimed uniform-version benchmark pass.

## Review artifacts

Local ignored artifacts are available in:

- Baseline gallery and 20 masters: `storage/recolor-dev/benchmark-1792072094135-ecd33807/review.html` and its `case-01` through `case-20` folders.
- Corrected Teal Blue / Hunter Green gallery and masters: `storage/recolor-dev/benchmark-1792073555473-cab73b6c/review.html`.
- Standalone current synthetic fixtures: `storage/recolor-dev/2026-10-15T14-13-36-803Z-17f39ec7/`.

The local galleries show reduced sRGB navigation renditions, A/B/C seeds, reference/source/fitted/human comparisons and a downloadable retoucher form. They are generated artifacts; interactive browser verification was unavailable under the browser's local-file policy. Open the HTML locally and inspect masters in Photoshop for color-critical assessment. Download notes before closing the page; no external service receives them.

## Next implementation work

1. Qualify the owner-selected original source state using the new audit's layer-role decisions and validate masks/reference regions with the retoucher.
2. Reproduce the Ceil Blue boundary defect in a focused native fixture; establish safe edge/tonal behavior or an explicit manual-correction classification before production eligibility.
3. Calibrate material-aware tonal fitting and safe parameter limits using references and retoucher assessments. Keep human gold images for evaluation rather than fitting.
4. Rerun the complete feasibility set under the pinned updated engine and record valid regions, correction ratings and end-to-end time.
5. Proceed to Stage 1C/1D production integration only after useful professional results are demonstrated, as required by the approved plan.
