# Native engine progress after source review

16 October 2026 (Asia/Dhaka). The [human-layer audit](HUMAN_TECHNIQUE_AUDIT.md) and [source/engine plan](SOURCE_AND_ENGINE_PLAN.md) remain the basis for development. Source-role review and original-source quality acceptance remain open. These changes are isolated to the experimental recoloring modules.

This note records the 18-fixture adapter/tinted-candidate milestone. The subsequent [reviewed source-preparation slice](SOURCE_PREPARATION.md) reached 22 checks, and [frozen-source recovery](SOURCE_RECOVERY.md) brings the current count to 25. These changes do not approve unresolved CBI roles.

## Owner decision and benchmark boundary

Sample 2 view 01 `Hue/Saturation 3` (ID 339) and view 07 `BASS` (ID 167) remain flagged for retoucher review, as instructed. Their lightness changes have not been classified as base lighting or recoloring preparation. The [source-policy manifest](verification/cbi-source-policy.json) records the decision and excludes both views from scored benchmarks. Other provisional source roles still require review.

The current development benchmark runner captures saved visible state; reviewed source preparation is not implemented in it yet. New reports explicitly record `scoredBenchmarkEligible: false` and `SAVED_VISIBLE_STATE_ONLY_SOURCE_PREPARATION_NOT_IMPLEMENTED`. It may produce technical smoke evidence, but cannot qualify original-source recoloring. No new CBI quality benchmark was run for this update.

## Reduced pixel-read fix

The audit failure was reproduced through `photoshop-adapter.readPixels` on a disposable **1024 x 768, 8-bit Adobe RGB layered document**. Reading at an exact 128 x 96 cache level succeeded. An arbitrary 640 x 480 resize requested as 16-bit components failed with `Photoshop Error. Code: -1` on Photoshop 25.3.1. Reading full size first did not explain the successful cache-level case.

Reduced reads of 8-bit documents now request native 8-bit components. Full-resolution reads and 16-bit working-document reads retain 16-bit output. Frames report the actual returned component size and maximum; bounds are normalized to full-document coordinates. There is no catch-all error retry and no document-depth conversion in the read operation.

The retained native fixture checks a known Adobe RGB color, geometry, comparable full/reduced Lab measurements and unchanged original document state. The original staged `WW115_01.psd` failure also passes: 416 x 640 at maximum 255, full 1300 x 2000 at maximum 65535, no source changes or cleanup errors. See the [red/green evidence](verification/native-depth-read-25.3.1.json).

## Opt-in tinted Black & White candidate

Candidate **D** uses native tonal Curves, Levels and tinted Black & White, followed by separate luminosity highlight/shadow Curves. The tonal Curves and Levels use Normal blending for this experimental variant. Tint comes from the prepared reference's Lab D50 measurement in Adobe RGB. Standard Black & White channel weights are used; no target-specific human curves, hidden target layers or gold-image pixels enter candidate creation or fitting.

`createCandidates(source, target, { includeTintedBlackWhite: true })` and `fit(..., { includeTintedBlackWhite: true })` enable D. A/B/C remain the default and retain their existing serialized recipe version. D has its own `native-tinted-bw-experimental-1` version and bounded gamma control (0.25–4). These are experimental limits, not calibrated production settings. Opt-in fitting requires at least five evaluations: four rendered seeds and a final winner verification. Gamma refinement is available when D wins the seed comparison.

The native fixture verifies:

- Actual Black & White with Tint enabled and native Levels creation.
- Live gamma updates without rebuilding the group; rendered changes remain inside the material mask.
- Disabling the group restores the normalized source exactly.
- Both PSD and PSB reopen with their mask, Adobe RGB profile, tint state, gamma and matching preview pixels.
- Editing the reopened Levels gamma changes actual rendered pixels.
- Opt-in fitting renders A/B/C/D and leaves the verified winner visible.

The separate development panel still exposes A/B/C. Development jobs can opt into D with `includeTintedBlackWhite: true`; that does not change their source-qualification status. Additional Color Balance, variable channel mixing, shaped/nonzero tone endpoints and material calibration remain future experiments. D's native functionality does not establish human-quality color or texture reproduction.

## Verification and remaining gate

All **18 native Photoshop fixtures** passed with zero cleanup errors; the [report](verification/photoshop-25.3.1.json) pins the tested bundle SHA-256. `npm test` passed, including 14 recoloring behavior tests, existing portal/panel regressions, dataset pairing and interruption recovery. The separate development-panel bundle builds and passes syntax checking; interactive UDT behavior still requires workstation testing.

Continue with accepted original-source roles, reviewed insertion locations, reference/mask regions, edge experiments and independent reference-driven A/B/C/D comparisons. The 20-case quality gate, retoucher assessment, production workflow, prepared-reference integration and later segmentation stages remain incomplete. Existing approved-library behavior and client approvals are unchanged.
