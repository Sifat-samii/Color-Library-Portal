# Recoloring implementation audit — 16 October 2026

## Assessment

The system has a tested **experimental Photoshop-native foundation** and a separate development panel. It is not a complete production recoloring assistant. The main unresolved gate is useful professional quality from qualified original sources, with comparable reference/gold regions and retoucher assessment.

Scope: the complete recoloring work since production baseline `df687e6ef9fa97c18c069d506bcf90d88ef85f7f`, including the working tree, native reports, CBI audit, tooling and the approved implementation plan. The existing application's regressions and changes against that baseline were inspected. This is a current-state implementation audit, not a fresh live-client approval exercise or a comprehensive security review of every pre-existing server route.

## Implementation and evidence

| Area | Implemented now | Remaining / limit |
| --- | --- | --- |
| Existing Color Library | Production portal/backend/DB, search, favorites, reference opening, sync and production UXP code retained. Standard regression suite passes. | Live operator/browser and PostgreSQL end-to-end workflows were not rerun for this checkpoint. No recoloring Apply Color integration in the existing library yet. |
| Isolation | Separate development plugin ID, CommonJS modules, local processing and additive tooling. Experimental folders are excluded from production CCX packaging. | Production packaging/distribution and client/material feature flags remain pending. |
| Source binding | Explicit document identity, geometry, mode, depth, profile and history binding; frozen independent duplicate. Tab switches do not change an existing binding. | Tracking references opened in the production panel across into the development panel remains pending; the lab tracks references it samples. |
| Source role preparation | Explicit keep/recolor/guide/unresolved roles, group inheritance, structural locators, stale/unresolved rejection and reviewer provenance. | Actual CBI base-role decisions and reviewed insertion locations remain provisional. No automatic deduction of mixed tonal-layer intent. |
| Source preservation | Original document retained; historical branches disabled only in duplicates. Source structure and human adjustment payload survive native save/reopen checks. | Broader smart-object/filter/linked-asset coverage and exceptional profile-conversion behavior need real-document validation. |
| Document identity | New IDs are obtained from before/after inventories, validated against the requested operation, selected explicitly and checked before cleanup. | Observed on one Windows Photoshop 25.3.1 host. Other host/version behavior remains unqualified. |
| Mask inputs | Current selection, genuine pixel layer mask, saved alpha and vector path. Soft/offset 16-bit coverage and protected regions have native fixtures. | Nondefault density/feather, disabled/combined masks fall back to an explicit designer selection. Complex edge effectiveness and off-canvas masks need expanded tests. |
| Layer placement | Reviewed root anchor inserts a separate masked group below finishing work, adjacent to historical branches. Duplicate names are disambiguated structurally. | Nested insertion unsupported. The real Ceil Blue source-versus-placement edge experiment is not completed. |
| Native engine | A: Color fill/Color blend/Curves; B: Hue/Saturation/Selective Color/Curves; C: Gradient Map/Curves; opt-in D: tinted Black & White/Levels/Curves. | No production winner established. D remains opt-in; the panel exposes A/B/C. Material-specific fitting and safe limits remain experimental. |
| Rendered fitting | Actual Photoshop renders, deterministic bounded search, integrity rejection, cancellation, final winner rerender and optional four-seed comparison. | Fits an interior diffuse anchor, not a complete material appearance model. Multipoint tonal behavior, nonzero endpoints, reference shadow/highlight characteristics and calibrated texture limits need work. |
| Texture and detail | No synthesis or blur-based reconstruction. Source detail retained by native adjustments, with clipping/detail diagnostics. | Diagnostics do not establish weave, seam, lighting or texture fidelity. Dark-to-light noise/detail limits and authored material variants remain unvalidated. |
| Preview | Full-resolution Photoshop preview, before/after, sliders, serialized/coalesced changes and revision creation. | Modeless UDT interaction, rapid controls, native edit timing and responsive large-document behavior remain untested interactively. |
| Native manual edits | Unexpected preview changes block destructive updates; manual work and committed results are retained. | Fine-grained ownership, mapped-property overrides, mask refinement round trips and deliberate reapplication/merge workflows remain partial. |
| Editable masters | Organized native chromatic/tonal groups, editable material mask, edge raster layer and designer touch-up group. PSD/PSB reopening, profile/masks and actual control edits verified. | Per-output automatic validation in the panel, reopened ownership recovery and broad production document integrity remain pending. |
| Variant independence | Separate variants originate from one frozen source; synthetic tests confirm independence. | Per-target tuned settings, five-target review/generation UI, complete-set saving and partial-failure recovery are not finished. |
| Color management | Tagged interpretation before conversion; explicit untagged restriction; Adobe RGB 16-bit working copies and embedded masters. Lab D50 math and ΔE00 separate from catalog D65. | Prepared-reference ICC checksum/provenance and production Adobe RGB chip integration pending. No physical-swatch accuracy claim. |
| Prepared approved targets | External manually approved image regions can be sampled without HEX; local target/recipe metadata is versioned. | No PostgreSQL preparation tables, administrator publishing, client-scoped prepared-target retrieval, material applicability UI, approval-withdrawal checking or immutable reference-asset pinning. |
| Source recovery | Layered frozen PSB, byte SHA-256, canonical manifest checksum, structure/profile/depth validation, cancellation and partial journal. Fresh copy recovery works across adapter instances. | Recovers source only. Confirmed masks, targets, fitting state and edited variants are not resumed. Full revision lineage/migrations, power/disk fault tests and large-PSB performance remain pending. |
| Quality assessment | Full-resolution outside-mask differences, clipping/detail proxies and explicit comparison validity. Gold comparison reads after fitting; mixed 8/16-bit frames normalize to Lab D50. | Edge-band/halo/fringe detection, calibrated texture thresholds, multi-view consistency, aligned comparable regions and senior-retoucher acceptance pending. |
| Review reports | Source qualification and scoring eligibility retained, A/B/C/D seeds shown, manual QC/time form available. Legacy reports remain unverified. | Local HTML interaction not verified; review notes need explicit download. No automated approval or complete designer productivity evaluation. |
| Benchmark corpus | Supplied CBI manifests, aliases, pairing, SHA identities, 20-case plan, 153 human appearances, 1,164 layers and 728 masks audited. Heather Ash excluded as instructed. | All studied CBI products are development data. Accepted original-source benchmark and separate sealed held-out products remain necessary. |
| Exports | Experimental layered Adobe RGB PSD/PSB saving. | Client/destination presets, converted sRGB JPEG/PNG/WebP delivery, dimensions/DPI/compression/transparency verification and export recovery remain unimplemented. Navigation JPEGs are not delivery exports. |
| Segmentation | Mask interface is independent of the recoloring source. | SAM 2.1, prompts, protected regions, refinement/matting, authenticated transfer and local endpoint not started. |
| Shared processing | Existing PostgreSQL retained; no new infrastructure introduced. | Shared GPU, durable jobs/leasing, bounded concurrency, material classification and advanced assessment not started. |

## Findings corrected before this checkpoint

| Finding | Correction / evidence |
| --- | --- |
| **High: a returned document object could refer to a previous document.** | Creation/open/duplication now resolve validated new IDs. The native suite reran all rendering and PSD/PSB reopen scenarios. Final report asserts preservation of all pre-existing IDs and no unexpected new documents. Unknown ownership never permits automatic cleanup. |
| **Medium: review summaries omitted source eligibility and opt-in D.** | The review builder now preserves qualification/eligibility and renders the declared A/B/C/D set. Two regression tests cover this and explicit legacy ineligibility. |
| **Medium: file-change checks could miss millisecond changes within a second.** | File verification compares full modification timestamps and byte counts; an actual same-size, one-millisecond file-change regression goes red before the fix and green after it. |
| **Compatibility: UXP file URLs are objects on this host.** | Recovery normalizes the URL to a string before resolving its constrained sibling artifact. Native recovery verifies the resulting file. |
| **Earlier adapter defects retained as regression coverage.** | Cached mask-loop dimensions prevent millions of native getters; reduced 8-bit reads avoid the observed arbitrary-resize promotion failure; gold comparisons normalize precision/channel layouts and require validated alignment; saturated single channels are not mistaken for complete tonal clipping. |

These fixes do not establish human-quality results. The earlier 20-case saved-color run is technical history, superseded for original-source qualification. The earlier Ceil Blue halo remains an unresolved real-image quality finding; outside-mask equality alone cannot dismiss it. Historical native reports retain their values, but the current identity-safe suite is authoritative for this checkpoint.

## Verification at the checkpoint

- `npm test`: existing portal/panel regressions plus 14 recoloring, 4 recovery, 3 dataset, 3 interruption and 2 review-summary behavior tests pass.
- Real Photoshop 25.3.1: **25/25 fixtures pass**, zero cleanup errors, all initial document IDs preserved, zero unexpected new documents. The report pins the current module-bundle SHA-256.
- Recovery tests include independent multi-chunk SHA-256, fresh adapter recovery, native edits after recovery, changed manifests/PSBs, already-open artifact refusal and cancellation without final-manifest publication.
- All **16 original PSD files on Z:** and all **16 staged copies** match the pre-audit SHA-256 identities. Original files were read for this verification; none were changed.
- Development panel builds and passes syntax/wiring checks. Production runtime source, portal/server/database code and production manifest have no recoloring implementation changes against the baseline.

Evidence: [current native report](verification/photoshop-25.3.1.json), [source integrity](verification/checkpoint-source-integrity-2026-10-16.json), [recovery evidence](verification/source-recovery-25.3.1.json), [checkpoint inventory](verification/implementation-checkpoint-2026-10-16.json). Full logs/artifacts remain under ignored `storage/recolor-dev/` on this workstation.

## Release gate and next work

| Stage | Checkpoint status |
| --- | --- |
| 1A native integration | Substantial tested foundation on one host; UI, broader documents and production-scale fault coverage remain. |
| 1B reference-driven feasibility | **Open gate.** Original-source roles, mask/reference regions, real edge experiments, retoucher quality and total workflow time must be validated. |
| 1C prepared references / production preview | Mostly pending. Start full portal/library integration after useful professional results. |
| 1D variants / exports / recovery / pilot | Partial primitives exist; complete production workflow and the 100-case pilot are pending. |
| 2 optional segmentation | Not started; native-mask operation remains independent. |
| 3 shared GPU / advanced capabilities | Not started; retain the approved sequencing. |

The owner's two mixed-tone source flags remain: Sample 2 front `Hue/Saturation 3` (lightness −3) and detail 07 `BASS` (lightness −4). Other provisional base roles and insertion locations still require review. No internal preparation was promoted to client approval.

Next: validate the source/recovery UI interactively, accept explicit source roles and reference/mask regions, connect pinned frozen sources to the development benchmark, run the controlled source/placement edge experiment, then compare native methods on qualified sources. Record retoucher corrections and total designer time. Obtain unseen products for held-out evaluation. The experimental ΔE00/time/minor-adjustment targets are not met merely by passing this checkpoint.
