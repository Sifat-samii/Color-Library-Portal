# Pinned frozen-source recovery

16 October 2026. This extends [reviewed source preparation](SOURCE_PREPARATION.md) with durable recovery of the accepted, normalized working source. It does not recover an entire recoloring job or qualify a production result.

## Use in the development panel

After confirming source roles, choose **Save reviewed source recovery checkpoint** and select a folder. The tool creates a layered Adobe RGB, 16-bit PSB and a matching final JSON manifest. Keep them together. Names are unique, and existing artifacts are not overwritten.

In a fresh panel session, choose **Restore reviewed source checkpoint** and select the final JSON. File checksums, profile, depth and layer structure are verified. Photoshop opens a fresh working duplicate; existing documents and variants remain intact. Select the material mask and approved reference again. Cached mask coverage, reference measurements, fitted parameters and designer corrections to a variant are not restored by this source checkpoint.

**Cancel source verification** stops subsequent file reads. A cancelled save retains the PSB and an incomplete journal, without publishing a final recovery manifest. A changed artifact, changed manifest, unsupported revision or already-open artifact is refused. Ordinary Photoshop work remains available.

These panel controls build and pass syntax/wiring checks. Interactive UDT validation remains pending; the native operations are tested through standalone UXP scripts.

## What is pinned

The `FROZEN_SOURCE_CHECKPOINT` envelope contains a canonical payload checksum, an immutable checkpoint identifier/revision, the frozen PSB's byte count and SHA-256, normalized geometry/profile/depth/hierarchy, source-review decisions and provenance, original-source metadata, and normalization policy.

The artifact filename is constrained to a local generated PSB name. Recovery cannot use manifest text as Photoshop commands or a path outside the selected manifest's folder. SHA-256 protects content integrity; it is not an authentication signature or another client approval.

The authoritative recovered content is the **reviewed frozen PSB**, including retained original layers and disabled human branches. Recovery does not reinterpret or reapply an old runtime review to a different original PSD. Existing live-session manifests still require fresh inspection after reopening the original. This first recovery format has revision 1; revision lineage, migrations and full job recovery remain pending.

## File I/O and failure behavior

File hashing uses bounded asynchronous reads, normally 1 MiB per chunk, with cancellation and modification-time/size checks. Recovery verifies the artifact before opening and after duplication. Hashing runs outside Photoshop modal scopes; native saving, opening and duplication use bounded modal operations. Native fixtures use 64 KiB reads against an independent multi-megabyte Node crypto digest. Large production PSB recovery latency and peak memory still require measurement.

Photoshop 25.3.1 lacks the Node crypto module and Web Crypto digest on this workstation. The exact MIT-licensed [js-sha256 v0.11.1 source](https://github.com/emn178/js-sha256/tree/v0.11.1) is vendored with its license and SHA-256 in [vendor/README.md](../../UXP/recolor/vendor/README.md). There are no install hooks or runtime network requests. UXP's asynchronous file-descriptor reads use ArrayBuffer buffers. [Adobe filesystem contract](https://developer.adobe.com/photoshop/uxp/2021/uxp/reference-js/Modules/FileSystem/)

A `.pending.json` journal records SAVING, VERIFYING, COMPLETE, CANCELLED or ERROR. Only a complete, checksum-valid final manifest plus matching artifact can recover. Partial writes and journals alone grant no recovery authority. Files are retained for inspection after failure; disk exhaustion and process termination still need dedicated production-scale fault tests.

Recovery never adopts an existing open artifact, replaces a recoloring group, or merges arbitrary native edits. Incomplete owned recovery copies are closed only when their recorded state is unchanged; new manual edits are retained. The original source and saved recovery files are protected from the development panel's master-save path.

## Document identity finding and fix

During this implementation, the installed host's new-document call returned a previous document object while creating a different new document. A minimized probe recorded the old returned ID and the distinct new ID in the document inventory. The earlier harness trusted returned DOM objects for some creation/reopen operations; that assumption was insufficient under this observed behavior.

Creation, duplication and file opening now compare before/after document IDs and validate the sole new document's expected name. A returned object or display name alone does not establish ownership. Fresh file opening rejects reuse of an already-open document. The benchmark and document-audit launchers use the same verified open operation. Native cleanup excludes every pre-existing ID, and the final report asserts initial-document preservation and zero unexpected new documents.

All relevant render and PSD/PSB reopen checks were rerun under these guards. Historical reports retain their original values; the [current native report](verification/photoshop-25.3.1.json) is the checkpoint's authoritative synthetic evidence. Pre-existing documents and remnants from unsuccessful probes were retained, rather than closing documents with uncertain ownership.

See the [implementation audit](IMPLEMENTATION_AUDIT_2026-10-16.md) and [code checkpoint](CHECKPOINT_2026-10-16.md) for the full current state and next gate.
