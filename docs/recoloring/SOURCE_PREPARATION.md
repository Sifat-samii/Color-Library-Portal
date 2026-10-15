# Reviewed source preparation and recoloring placement

16 October 2026 (Asia/Dhaka). This implements the next experimental source-workflow slice from the [revised plan](SOURCE_AND_ENGINE_PLAN.md). It does not resolve the CBI source-role ambiguities or qualify production color accuracy.

## Designer workflow in the development panel

1. Activate the source document and choose **Inspect source layers**. The review stays bound to that document when tabs change.
2. Assign explicit roles: **Keep base / cleanup / lighting**, **Disable existing recoloring**, **Disable reference guide**, or **Unresolved — retoucher review**. Group roles apply to descendants; nested choices can override them. Unknown work is not classified by its name or adjustment family.
3. Choose **Above all original source layers** or **Before** a specific root layer. Selecting a reviewed historical recoloring branch places the new group adjacent to it, beneath finishing layers above it. Nested insertion is currently unsupported to avoid silently applying an ancestor's material mask again.
4. Enter the reviewer name or initials and choose **Confirm roles and capture reviewed source**. Unresolved decisions and stale reviews block this path. This is internal source preparation; it does not create or alter client approval.
5. The adapter duplicates the original, disables only the reviewed branches, preserves child settings and visibility, then normalizes that working copy to Adobe RGB/16-bit. Continue with mask selection, reference sampling and native recoloring.

An explicit **Capture visible state (unreviewed experiment)** option retains the older smoke-test workflow. Its snapshots and output manifests are labeled `UNREVIEWED_VISIBLE_STATE`. It does not qualify an original-source benchmark.

The panel bundle builds and passes syntax checking. Interactive UXP Developer Tool validation is still required; standalone native fixtures do not exercise panel widgets, modeless event handling or user timing.

## Source-preparation contract

`photoshopAdapter.inspectSource(documentId)` returns a bound document inspection and its complete flattened layer hierarchy. Layer records contain structural indices, name paths, current runtime IDs, kinds, local visibility, opacity and blending modes. The document/history binding is checked after inspection.

`createSourcePreparation(inspection, { roles, insertion, review })` produces a versioned `SOURCE_PREPARATION` manifest. The manifest records the inspected source, explicit role decisions, unresolved locations, insertion context and reviewer provenance. It contains no human adjustment parameters for fitting.

`photoshopAdapter.captureSource(documentId, { sourcePreparation })` revalidates the complete live inspection before duplication and inside the modal operation. Derived visibility actions are rebuilt from role decisions; modifying cached `disableLayers` does not grant authority. A retained base layer inside a disabled branch is rejected as contradictory. Original hidden layers remain hidden; keeping a layer never activates historical alternatives.

Layer locations use the reviewed structural index and full inspection rather than names alone. Duplicate names are supported without guessing. The duplicated hierarchy must match the reviewed topology before visibility changes. Preview sessions resolve the insertion anchor to the duplicate's runtime layer ID and keep that anchor during native recipe creation and updates.

Output manifests include source preparation and source qualification. Original layers, historical adjustment payloads, masks and ordering remain in the document. A reviewed source does not authorize overwriting manual corrections or arbitrary reopened groups.

## Current authority and persistence limits

This manifest version is explicitly **live-session only**. It binds a review to document identity, history and hierarchy. Reopening, Save As, structural changes or other native edits require a fresh inspection/review; persisted JSON is not permission to rebind an arbitrary document. Review data is carried into the output manifest saved by the existing experimental master-saving flow.

A separate [frozen-source recovery format](SOURCE_RECOVERY.md) now pins a saved PSB with SHA-256 and restores a new independent source across sessions. It does not rebind a live review to a different original PSD. Full review-revision lineage, job recovery and automatic benchmark consumption remain pending. The separate benchmark runner still captures saved visible state and reports scored eligibility false. Do not use this session review as evidence that those missing steps or the original-source feasibility gate have passed.

The owner-requested flags for Sample 2 view 01 `Hue/Saturation 3` and view 07 `BASS` remain unresolved in the [CBI source-policy manifest](verification/cbi-source-policy.json). Other provisional base roles also remain pending. No CBI source was automatically approved or modified for this implementation.

## Native evidence

The [Photoshop 25.3.1 report](verification/photoshop-25.3.1.json) now has **25 passing fixtures**, zero failures and zero cleanup errors. The [source-preparation evidence](verification/source-preparation-25.3.1.json) extracts the four added scenarios and pins the tested bundle.

- Source recovery retains a synthetic original garment and finishing label while disabling historical Hue/Saturation. Recoloring changes the garment beneath the label and leaves protected pixels unchanged. A saved/reopened PSD preserves layer placement, historical hue settings, child visibility and preview pixels.
- Pending and unresolved reviews are rejected before document creation. A native edit after an accepted review invalidates it and remains intact after rejection.
- Two identically named branches receive distinct visibility decisions and the intended insertion anchor through their reviewed locations.
- Two different visible historical hue recipes become the same recovered source. Actual A/B/C/D fitting produces identical recipe parameters and rendered winners with both hidden human recipes retained. No human-gold input is supplied to the fitter. This specific test does not establish every possible leakage path or qualify held-out data.

The initial finishing-label test setup obscured the synthetic garment. It was replaced with a bounded 8×8 pixel patch, and the fixture now checks its source material before testing recoloring. Pixel writes use the documented target bounds; no product rendering workaround was needed. [Adobe Imaging API](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/imaging)

`npm test` passes, including existing application/panel regressions and 14 recoloring behavior tests. These checks establish the tested source workflow and native mechanics. Reference-region review, full-resolution real edge experiments, retoucher color/texture acceptance, broader document coverage and production integration remain open.
