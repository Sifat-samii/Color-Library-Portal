# Recoloring checkpoint — 16 October 2026

This checkpoint captures the complete experimental recoloring implementation and its audit. Its local Git tag is `checkpoint/recoloring-2026-10-16`; the checkpoint commit is the commit containing this document. Production baseline: `df687e6ef9fa97c18c069d506bcf90d88ef85f7f`.

## Read first

- [Implementation audit: implemented, partial, pending and corrected findings](IMPLEMENTATION_AUDIT_2026-10-16.md).
- [Source recovery workflow and authority](SOURCE_RECOVERY.md).
- [Developer entry point and commands](README.md).
- [Revised plan and source-role gate](SOURCE_AND_ENGINE_PLAN.md).
- [Machine-readable file inventory and verification identities](verification/implementation-checkpoint-2026-10-16.json).

## State

Experimental native A/B/C and opt-in D, full-resolution preview primitives, source-role review, verified root insertion, editable PSD/PSB mechanisms, bounded rendered fitting, source recovery, local benchmark/audit/review tooling and regression coverage are present. The existing Color Library remains separate from the lab.

Verification: **25 native Photoshop checks pass**, existing automated application/panel regressions pass, and all 16 original plus 16 staged PSD checksums match their previous identities. Native evidence records initial-document preservation and no unexpected new documents. Pixel assets and multi-gigabyte test artifacts remain outside Git under ignored local storage; this is a code/metadata checkpoint, not a backup of the user's datasets.

Production qualification remains **false**. Source recovery covers a reviewed frozen source, not fitted jobs or designer-edited variants. Actual original-source quality, live panel validation, prepared-reference portal integration, complete multi-color workflow, delivery exports, production pilot and later segmentation/GPU work remain pending. The CBI mixed-tone flags remain unresolved.

## Resume

Run `npm test`, `npm run test:recolor:photoshop`, and `npm run recolor:lab` from the repository root. Read the audit's release-gate section before expanding scope. Source recovery PSB/JSON pairs must stay together; original files are never overwritten by recovery. Do not infer production readiness from synthetic test success or historical saved-state benchmark scores.

The next meaningful gate is qualified original-source/reference/mask preparation and measured senior-retoucher acceptance. Continue the approved stages from that gate.
