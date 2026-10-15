# Tested Photoshop capabilities

Measured on the installed **Photoshop 25.3.1 / Windows** host, refreshed 16 October 2026 (Asia/Dhaka). See the [machine-readable report](verification/photoshop-25.3.1.json). All 25 synthetic technical checks pass, with `productionQualified: false`.

| Capability | Evidence / limitation |
| --- | --- |
| Native runtime | Standalone `.psjs` dispatched locally through Photoshop COM; report obtains the actual UXP host version. No claim of universal COM dispatch support. |
| Source preservation | An 8-bit tagged sRGB layered fixture becomes a separate 16-bit Adobe RGB document; original depth/profile/history remain unchanged. Existing group, alpha channel and vector path survive master reopening. |
| Reviewed source preparation | Explicit keep/disable/unresolved roles recover a synthetic original on a duplicate; pending/stale reviews are rejected before document creation. Historical adjustment payloads and child visibility survive PSD reopening. Role review remains live-session bound; a separate frozen PSB recovery path now pins file SHA-256. Full job recovery remains pending. |
| Frozen-source recovery | Bounded file hashing, manifest checksum, fresh PSB opening/duplication and new-adapter recovery. Changed files/manifests, already-open artifacts and cancellation are tested. Source-only recovery; large PSB/UI/fault coverage remains pending. |
| Document ownership | Before/after ID inventories validate new documents rather than trusting returned DOM objects. Current report asserts all initial IDs preserved and zero unexpected new documents. |
| Processing location | A reviewed root anchor keeps new recoloring below finishing work and adjacent to the old branch. Label appearance and protected pixels remain unchanged; duplicate names resolve by reviewed structure. Nested insertion is unsupported. |
| Hidden recipe independence | Two different historical hue stacks retained but disabled produce identical independent A/B/C/D fitted recipes and actual winner pixels on synthetic sources. Broader leakage testing and held-out qualification remain pending. |
| Method A | Native Solid Color and Curves exist, alter material and leave protected fixture pixels unchanged. |
| Method B | Native Hue/Saturation, Selective Color and Curves exist, alter material and leave protected fixture pixels unchanged. |
| Method C | Native five-stop Gradient Map and Curves exist, alter material and leave protected fixture pixels unchanged. |
| Opt-in method D | Native tinted Black & White, Levels and separate tone/lighting Curves; live gamma changes, mask containment, PSD/PSB persistence and actual reopened Levels edits verified. Default A/B/C recipes remain unchanged. |
| Provisional parameter update | Existing group ID survives a live parameter change. Small-fixture timings are recorded; they do not predict production-document latency. |
| Shared material mask | Actual soft pixel mask read separately from transparency; no unintended child masks; disabling the group restores normalized source pixels exactly. |
| Nondefault mask density | Explicitly rejected with designer-selection fallback. Feather, disabled/combined masks are conservatively restricted but require expanded host fixtures. |
| Offset / precision | Offset 16-bit coverage is retained within the reported native precision tolerance; protected pixels remain unchanged. |
| Reduced pixel reads | 1024 x 768 fixture returns 128 x 96 data with correctly normalized full-document bounds and aligned material measurements. Cache behavior on other hosts remains to be tested. |
| Mask-loop performance | Real 96 x 64 host regression bounds dimension reads; caching reduced 18,442 reads to eight. A 1300 x 2000 material-mask write completed in about 54 ms in the minimized source probe. End-to-end fitting and saving have separate costs. |
| Rollback | Resolved native error after a partial edit is surfaced; only that transaction's layers roll back. |
| Editable master | PSD and PSB reopen with Adobe RGB, group mask, source structure and native controls. Actual reopened pixels agree with preview within the test tolerance; changing group opacity changes the rendered result. |
| Manual changes | A designer-added layer blocks destructive reapplication; cancel preserves its document. Committed variants cannot be automatically overwritten through the preview adapter. |
| Independent variants | Two different recipes from the frozen source leave each other and that source unchanged. Five-color production generation remains pending. |
| Selection inputs | Rectangle selection, saved alpha channel and saved vector path produce expected coverage. Runtime channel/path IDs were unavailable on this host; validated index plus name targets the current working duplicate. |
| Rendered fitting | All A/B/C/D seeds are actually rendered in opt-in mode, bounded search stays within budget, and the final visible canvas is the measured winner. A/B/C remain the default. This checks mechanics, not professional material quality. |
| Human-workflow audit | Separate visibility-only experiments inspected all 16 inputs, 1,164 layers and 728 masks, with 153 human appearances and 54 base/texture ablations on duplicates. This is research evidence; source-role approval and generalized-engine quality remain pending. |
| Native-depth image reads | A synthetic arbitrary-size 8-bit resize reproduced the native error; the adapter now reads reduced 8-bit documents at native precision. Known color, bounds, full/reduced Lab and unchanged source are verified. The original staged PSD probe also passes. See [post-audit progress](NATIVE_ENGINE_PROGRESS.md). |

## Not yet established

- Modeless lab UI loading, plugin modal contention, rapid interaction and modal cancellation on actual designer workstations. The host harness uses a standalone execution context, rather than testing panel event handlers.
- Quality acceptance of the 20-case feasibility set, the 100-case development benchmark, expanded held-out material/client reliability, retoucher acceptance and end-to-end productivity. Twenty real baseline masters completed technical round trips; a visible Ceil Blue edge defect prevents treating this as a quality pass.
- Broader protected/transparent complex edges, offset/feathered/combined masks across realistic assets, and arbitrary layered-document features. Full-resolution protected-pixel checks succeeded in the three-case CBI pilot; that does not certify all edges or material texture.
- Broader multi-gigabyte PSD/PSB, PSB size limits, long sessions, disk exhaustion, partial-save recovery, plugin reload/reopen ownership, multiple OS/host versions and locale effects. The supplied >1 GB source completed its PSB round trip in about 187 seconds; a concurrent monitor encountered out-of-memory. Resource behavior needs further investigation.
- Prepared-reference portal integration, approval withdrawal/revision validation, persistent recipe ownership and production exports.
- Physical-swatch accuracy, calibrated viewing conditions, complex materials, optional segmentation and shared GPU deployment.

Passing these fixtures permits continuing feasibility development. It does not change the existing library's Photoshop minimum, qualify the lab for distribution, or satisfy the human-quality gate.
