# CBI internal retoucher review notes

Copy this file to your review folder and fill it in. Leave unknowns explicit. This is internal technical review, not new client color approval.

This is optional review support. The [integrated pilot](PRODUCT_PILOT.md) can be tried without completing historical source review first.

- Reviewer:
- Date:
- Photoshop version:
- Review folder:
- Lab loaded successfully: Yes / No / Not attempted
- Exact tool error and step, if any:

## Source review (copy this section for each input PSD)

- Source sample, filename and full path:
- Reviewed on layered duplicate: Yes / No
- Source decision: Accepted for initial trial / Needs clarification / Excluded
- Original-color appearance confirmed, with base cleanup/lighting retained: Yes / No / Unknown
- New recoloring location: Above all original source layers / Immediately above root layer [full name and position]
- Why this location preserves finishing work:

| Layer/group full path and position | Keep base / Disable recoloring / Disable guide / Unresolved | Purpose and evidence; child exceptions |
| --- | --- | --- |
| | | |
| | | |
| | | |

- Material mask source (selection/layer mask/channel/path) and name:
- Mask exclusions (labels, hardware, skin, background, etc.):
- Diffuse color sample area(s), in document pixels or annotated on a duplicate:
- Highlight/shadow/edge/detail review areas:
- Unknown layer roles or additional material treatment:
- Source recovery PSB and matching final JSON paths, if saved:
- Reviewer/date for this source decision:

Keep HH00074_01 root Hue/Saturation 3 and HH00074_07 root BASS flagged unless explicitly resolved. Never infer all layers named BASS or RT have the same purpose.

## Target/result review (copy for each source plus target combination)

- Case identifier:
- Reviewed source above:
- Target color and material:
- Exact approved reference path (CROP/FULL):
- Historical approval provenance known to production (or unknown):
- Reference sample area and exclusions:
- Exact accepted human-delivery path:
- Human delivery accepted as comparison target: Yes / No / Needs clarification
- Framing/alignment comparable: Yes / No / Unknown
- Added texture or material differences excluded from color-only comparison:
- Lab method(s) examined:
- Automatic result master path:
- Manually corrected master path, if any:

| Review item | Acceptable / Needs correction / Cannot assess | Evidence, affected area and correction |
| --- | --- | --- |
| Reference color and undertones | | |
| Weave, stitching and material detail | | |
| Highlights, shadows and fold depth | | |
| Edges, halos, spill and source-color fringes | | |
| Background, labels and protected components | | |
| Framing, geometry and view consistency | | |
| Reopened editable layers and material mask | | |
| Embedded Adobe RGB master profile | | |
| Disabling recolor restores normalized source | | |

- Outcome: Acceptable as-is / Minor adjustments / Major correction / Unsupported / Blocked by tool
- Exact manual corrections required:
- Conventional manual baseline minutes (measured / estimate / unavailable):
- Assisted preparation minutes (source/mask/reference):
- Automated processing minutes:
- Manual correction minutes:
- Final QC/save/reopen minutes:
- Total assisted minutes (include all stages):
- Source preparation reused across targets? Explain timing allocation:
- Remaining uncertainty or rejected result reason:

## Client delivery requirements

- Client/preset name:
- Format(s):
- Pixel dimensions:
- Resolution/DPI metadata:
- Delivery profile (Adobe RGB / sRGB / other explicit requirement):
- Compression/quality/file-size limit:
- Background/transparency/matte:
- Filename rules:
- Folder rules:
- Other requirements/unknowns:

## Handoff

- Initial sources reviewed:
- Initial source/target cases reviewed:
- Cases excluded and why:
- Developer action needed:
- Folder path to return in chat:

These notes and saved results complete an initial review handoff. The developer must still run the qualified original-source benchmark, fix tool issues and establish the complete feasibility and release criteria.
