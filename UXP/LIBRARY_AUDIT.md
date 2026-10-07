# CBI approved-color library audit

Audit date: 9 September 2026  
Last updated: 2026-10-05  
Source reviewed read-only: `F:\CBI\Approve`

## Current inventory

| Item | Finding |
|---|---:|
| Approved color groups | 143 |
| Usable reference files | 286 |
| JPEG references | 285 |
| Photoshop Large Document references | 1 |
| Crop reference images at folder root | 143 |
| Full-resolution images in `FULL` | 143 |
| JPEGs with embedded ICC profiles | 285 of 285 |
| Ignored system files | 2 `Thumbs.db` files |

Most root JPEGs are 1212 × 2087 px and most `FULL` JPEGs are 5352 × 8024 px. This makes the root file the efficient card thumbnail while preserving the full-resolution file as a second selectable reference.

## Historical filename notes

These notes describe how names related inside `F:\CBI\Approve` on 9 September 2026. They are not panel matching rules. The Photoshop panel groups approved files by portal color and reference IDs and the synced `localRelativePath`. It does not strip production prefixes or apply filename search aliases.

At the time of the inventory:

- Full-size filenames sometimes started with `CK605_CK002__CIEL_F_1178_`.
- Some full-size names ended with `_FULL`.
- Names differed by case, accents, or stray trailing spaces and underscores.
- `White1.psb` and `FULL\White.jpg` were the same approved color, WHITE.
- `Teal Blue.jpg` and `FULL\..._Teal.jpg` were the same approved color, TEAL BLUE.

With those names, every color in that snapshot had exactly two reference files. The panel does not rename client files.

## Operational risk found

Audit note (2026-09-25): This file remains a historical inventory of `F:\CBI\Approve` as of 9 September 2026. The portal now stores immutable reference versions, restricts activation to authorized Administrators (with client review on Color Requests), and syncs only approved files into each client's production folder. The production folder alone is still not a safe system of record if someone edits files outside the portal.

The folder can still act as both the live delivery surface and an informal approval record for operators who bypass the portal. A file can be replaced in place without a centralized reviewer, reason, or recoverable version. The Photoshop panel reduces day-to-day selection errors and flags local file changes against a reviewed baseline; treat portal approval as authoritative.
