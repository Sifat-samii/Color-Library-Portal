# CBI feasibility dataset audit

**Current source policy:** recover the underlying original product appearance with essential base retouch retained. The [human-technique audit](HUMAN_TECHNIQUE_AUDIT.md) inspects every input's recipes and source dependencies. Saved-appearance runs described below remain historical technical evidence; reruns require reviewed original-source states.

15 October 2026. Dataset supplied by the owner at `Z:\Sifat_Project_Coordinator\Color library test\Recolor Data\CBI`. This supersedes the previously discovered F: WW115 candidates, which the owner rejected for benchmarking. Original dataset files were read only. Photoshop inspection used local workspace copies.

## Verified inventory

Both supplied Markdown manifests were read. They describe expected layout and view conventions; they explicitly say their contents had not yet been inspected. The following counts and properties were independently measured:

| Item | Sample 1 | Sample 2 |
| --- | ---: | ---: |
| Raw PSD sources | 8 | 8 |
| Target folders | 8 | 14 |
| Paired human JPEGs | 64 | 112 |
| Human PSDs | Not supplied, as documented | 112 |
| View/target pairs | 64 | 112 |
| Included after Heather Ash exclusion | 64 | 104 |

- Approved references: 143 crop assets and 144 full-body assets. The inventory includes the PSB crop. A missing crop does not invalidate an otherwise resolved full reference.
- All **591** inspected image assets contain an Adobe RGB (1998) ICC description.
- All raw, human JPEG and human PSD view dimensions are **1300 x 2000**. Their product/view mappings agree with the supplied eight-code convention. Matching geometry alone does not prove pixel alignment or consistent photographic detail.
- The 16 input PSDs total approximately 2.84 GB; Sample 2 view 06 alone exceeds 1 GB despite its modest canvas dimensions. Header/resource inspection does not decode layers or prove the files open successfully.
- After the authorized aliases and exclusion, there are **168 included pairs**, eight excluded Heather Ash pairs and zero unresolved inventory findings. PSD and JPEG representations are counted once per result.

The [metadata summary](verification/cbi-dataset-summary.json) records the audit date and SHA-256 of the complete local inventory. Full per-asset metadata stays in ignored `storage/recolor-dev/cbi-dataset-inventory.json`. This is metadata evidence, not an image-quality result.

## Canonical labels adopted

The owner authorized resolving spelling variants, flagging them and following consistent labels going forward. These rules apply to this CBI recoloring dataset. Original filenames and historical approval records are preserved.

| Canonical label | Recognized original variants |
| --- | --- |
| Caribbean Blue | Caribbean Blue, Carribean Blue |
| Ceil Blue | CEIL, Ciel, Ceil, Ciel Blue, Ceil Blue |
| Hunter Green | Hunter, HUNTER GREEN |
| Teal Blue | Teal Blue crop, full reference ending `_Teal.jpg` |
| Heather Ash | Explicitly excluded until further instruction |

These names follow current scrub-industry usage: Cherokee's current collection uses **Ceil Blue**, **Caribbean Blue** and **Teal Blue**, while its product catalog also uses **Ciel Blue** and **Hunter Green**. Ceil/Ciel are retained as searchable aliases; a commercial color name is not a numerical color specification. Supplied approved image pixels remain authoritative. [Cherokee collection](https://cherokeeuniforms.com/collections/womens-ceil-blue-scrubs), [Cherokee color catalog](https://www.cherokeeuniforms.com/men-scrubs-caribbean-blue)

Fixed production-name prefixes are removed only for reference indexing. Canonicalization does not modify reference files, choose a new physical color, require client reapproval or change the existing production portal catalog.

## Prospective 20-case selection

[cbi-20-case-plan.json](benchmark/cbi-20-case-plan.json) fixes ten cases per product before algorithm rendering. It covers all eight views, several light/dark/neutral/saturated targets and repeated Wine views for consistency. Heather Ash is omitted. The original case-selection artifact retains its prospective `NOT_RUN` markers. Actual subsequent results are separate in [the baseline report](verification/cbi-20-case-baseline.json) and [feasibility findings](FEASIBILITY_RESULTS.md); no quality pass is implied.

Before numerical scoring, each case still needs a validated native material mask, representative reference sampling regions, comparable gold-image regions and material eligibility. Source bytes/profile/framing must remain unchanged; use normalized working duplicates. Record actual asset checksums and preparation revisions when freezing the runnable set. Do not optimize against the human gold image: use it only for evaluation after fitting against the approved reference.

The two-product corpus is useful for feasibility and multi-view evaluation. Broader held-out client/material validation and timed senior-retoucher review remain necessary for the production gate.

## Native inspection and pilot status

On Photoshop **25.3.1**, the locally copied Sample 1 front PSD opened and was inspected. It contains native adjustment groups, smart objects, masks and named paths. `REF` is hidden; the recoloring group contains a visible Royal variant. Its saved rendered appearance is the source baseline. Existing groups are not silently disabled or removed to invent a different raw image.

Sample 2's front input subsequently opened successfully in Photoshop 25.3.1 through the restarted instance's existing automation object outside the sandbox. It contains native adjustment groups, a `CC` pixel mask and named paths; its saved appearance is Desert Taupe. Both products' saved appearances are preserved as independent frozen source baselines.

Two Sample 2 human PSDs (Black and Desert Taupe, front view) were inspected successfully. Each has **one Background pixel layer**, no layer mask and two named paths. Their PSD extension does not indicate an editable recoloring recipe. They remain valid supplied rendered evaluation targets. Do not generalize this two-file layer finding to the other 110 output PSDs without inspection.

An earlier native open stalled and its COM connection ended with RPC error `0x800706BE`; subsequent connection attempts returned `0x80080005` and `0x800401E3` until the restarted instance became reachable in the normal user context. This history does not establish file corruption or a confirmed cause. No force termination, preference reset, profile reassignment or original-file write was performed. The inspector now uses documented silent opening, validates returned document IDs and closes only its own opened documents. [Opening investigation and Adobe sources](OPENING_RESEARCH.md)

A three-case pilot completed: Wine on both products and Black on Sample 2. It uses existing `CC` masks, visually selected provisional torso regions from approved crop references, SHA-256 asset identities and a bounded ten-render budget. All three masters saved and reopened with matching preview pixels, embedded Adobe RGB, editable group masks, preserved source structure and rendered changes after editing group opacity. Full-resolution checks found zero changed pixels outside their masks. These are technical results, not a passed color-quality benchmark. Current artifacts are recorded by `storage/recolor-dev/latest-benchmark.json`.

The apparent reference-measurement stall was traced to the later material-mask write: a pixel loop repeatedly called native document dimension getters. A real-host regression reproduced 18,442 reads for a 6,144-pixel mask; caching dimensions reduced that to eight. The full-size mask write then completed in about 54 ms. Intermediate phase journaling now makes the active operation visible. A separate overly strict reopen assertion was corrected after Photoshop returned 50.196% for a requested 50% opacity; the check now also verifies an actual rendered change. [Diagnosis evidence](MASK_PERFORMANCE.md)

The pilot's diffuse-reference anchor differences were approximately 1.22, 0.97 and 0.04 Delta E00. These are **not** median/p95 human-gold scores. Visual inspection also found stronger weave/fold contrast in the Sample 2 light-to-dark result than in its supplied human edit. Material-aware tonal calibration and senior-retoucher review remain open. Matching one diffuse anchor is insufficient.

The benchmark runner now records individual native phases and stops subsequent cases on cancellation. It writes A/B/C navigation images, fitted/human comparison images, full-resolution protected-region checks, separately qualified gold-image diagnostics and editable masters with save/reopen checks when those operations complete. Gold statistics remain unavailable as release evidence until alignment and material-region comparability are validated.

All 20 prospective cases subsequently completed baseline rendering, protected-region checks and editable master round trips, including one PSB from the >1 GB source. A later scoring correction was independently tested on Teal Blue and Hunter Green, with corrected masters retained. This is development/calibration data, not held-out validation. The visible Ceil Blue edge defect and material/tonal findings keep the production gate open.

## Reproduce the inventory

```powershell
npm run recolor:audit -- --root "Z:\Sifat_Project_Coordinator\Color library test\Recolor Data\CBI" --out "storage/recolor-dev/cbi-dataset-inventory.json"
npm run test:recolor:dataset
```

The inventory tool reads PSD headers/ICC resources with bounded allocations and JPEG metadata without loading complete PSDs into JavaScript. It flags missing/ambiguous view mappings, product mismatches, inconsistent PSD/JPEG identities, reference ambiguity, metadata failures and geometry differences. Output is constrained to workspace storage.

For native inspection, prepare a local JSON array of `{ "label": "...", "path": "..." }` entries, then run:

```powershell
node scripts/build-recolor-harness.js --audit path-to-local-audit-inputs.json
```

Run the generated `audit.psjs` using Photoshop File > Scripts > Browse, or the locally tested COM launcher when available. Reports and sRGB navigation thumbnails stay in the new workspace artifact directory. Those thumbnails are not color-critical proof images. Native fixtures from the earlier synthetic run remain separate evidence; they do not qualify this real dataset.
