# Integrated Color Library recoloring pilot

19 October 2026 (Asia/Dhaka). The owner chose a product-first sequence: build a usable designer workflow, evaluate real results, then improve it. Reviewing every historical PSD is not a prerequisite for using this pilot. Ambiguous historical benchmark sources remain excluded from scored claims.

## What this build contains

The existing **Pixofix Color Library** panel gains a **Recolor / Pilot** toolbar and an **Apply Color** action beside **Open Reference** on each approved reference. Search, client selection, favorites, previews, sync, approvals and ordinary reference opening retain their existing transport and data contracts. There is no remote Photoshop command bridge, pixel-upload service, new database requirement, HEX requirement, segmentation worker or GPU dependency.

The pilot uses the current appearance of the explicitly selected product document. It creates a layered frozen Adobe RGB (1998), 16-bit working duplicate. Designers prepare any historical recoloring visibility themselves before capture; the pilot does not infer unknown layer purpose. Opened library references are recorded so that they cannot silently become a subsequent product source.

Adobe RGB catalog HEX chips are converted to sRGB display values in the pilot; the original stored codes and approved images are unchanged. This corrects chip interpretation without treating a HEX chip as the recoloring target.

Material coverage comes from an explicit Photoshop selection, layer mask, alpha channel or path. Source binding persists when references become active. Native A/B/C and experimental tinted Black & White/Levels D can be compared through Photoshop-rendered fitting. The panel offers preview, before/after, tone/intensity controls, native editable Apply Color, independent variants, per-target session settings and layered PSD/PSB saving.

Every new variant starts from the frozen source. A manually changed provisional preview is retained when a new variant is created. Ending a session leaves previews and committed results open. Native edits are not automatically merged into another target. Committed results remain editable through ordinary Photoshop tools.

## Build and load

From the repository root:

```powershell
npm run recolor:pilot
```

This writes an integrated plugin folder and CCX under a unique `storage/recolor-dev/pilot-*/` directory. The generated `storage/recolor-dev/latest-pilot.json` records the exact paths. Generated artifacts are ignored by Git; rebuild when code changes.

The pilot uses the **same plugin identity and panel entrypoint** as the existing Color Library, version **0.6.0**, with Photoshop **25.3+** and explicit Photoshop API v2. The regular 0.5.15 manifest/config and release CCX remain available. Normal `plugin:package` still excludes experimental recoloring; the pilot command is the explicit distribution path for this increment.

Load the generated `plugin/manifest.json` with **Adobe UXP Developer Tools > Add Plugin > Load**. If the same plugin ID is already loaded in UDT, unload its old development entry before loading the pilot; preserve any unsaved Photoshop work. Do not load the separate Recolor Lab manifest for this workflow. Alternatively, install the generated CCX using Adobe's installer. Installing/updating the panel on a workstation is separate from building it; this code change does not silently reload an installed copy.

The current native workstation is Photoshop 25.3.1. Broader compatibility is unqualified. Explicit API v2 is required for native modal operations; it is set in the generated pilot manifest without raising the regular library manifest's minimum version. [Adobe modal execution](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/executeasmodal), [Adobe manifest/API version policy](https://github.com/AdobeDocs/uxp-photoshop/blob/main/src/pages/guides/uxp-guide/uxp-misc/manifest-v4/photoshop-manifest/index.md)

## First recoloring

1. Open the intended original product image in Photoshop. Prepare any existing adjustment visibility as desired. Keep the tagged source intact.
2. Open the Color Library panel and choose **Recolor > Use active product**. The bound source name remains visible. This creates working copies; it does not edit the original source.
3. In the product preview, make/refine the garment selection using normal Photoshop tools. Choose **Use material selection**, or select a reviewed existing mask/channel/path in the mask selector. Nondefault mask modifiers/combined masks require a designer-created selection in this version.
4. Choose **Browse library**, select the client and approved color, then choose **Apply Color** on the intended Crop/Full reference. This opens a fresh temporary copy of that approved file and returns to the recoloring controls. Ordinary **Open Reference** remains available separately.
5. On that reference, select representative diffuse fabric, excluding background, bright highlights and deep shadows. Choose **Sample reference**. The preview document becomes active again. Initial preparation is deliberately designer-assisted; automatic material/reference-region analysis is not implemented.
6. Choose **Preview color**. The default compares four eligible native methods and refines the best rendered candidate. Use **Show original** and inspect the canvas at 100%. Fine-tune intensity, brightness, contrast, shadows and highlights if needed. Cancel stops later fitting iterations after the current native operation.
7. Choose **Apply Color** to keep the editable result, then **Save editable PSD/PSB** under a new filename. Final touch-ups and the material mask remain editable. Existing masters are refused rather than silently overwritten. Client delivery JPEG/PNG/WebP exports are not in this increment.
8. For another target, browse the library and choose its reference. Each variant uses the same frozen original, not the previously recolored result. The target selector retains sampled targets and their individual controls for this session. Use **New variant** after manual edits or to replace the shared mask. **End source session** allows a different product without discarding open results.

The source/reference must have an explicit profile interpretation. Tagged inputs are read with their actual profiles and converted on working copies. Missing HEX values do not matter. The pilot does not infer a profile for an untagged image.

## Reference identity and failure behavior

The library still owns approval status. Targets retain client/color/reference/version identity, original filename, declared checksum and historical approval metadata. A fresh temporary file is hashed before opening. A declared checksum mismatch rejects it. After opening, the reference's full rendered-pixel fingerprint is checked at sampling: changing a selection is allowed; editing image pixels is refused. Pixel fingerprints establish session consistency, not another client approval or physical-swatch accuracy.

Fitting/applying rechecks that the selected version is still present in the current client catalog. Withdrawal/version/client changes block subsequent operations while preserving completed variants. As with the existing library, offline cached catalogs cannot establish a withdrawal that has not been synchronized yet.

Saving protects source/reference paths and refuses existing nonempty output files. A versioned local session record includes recipe, source interpretation, approved reference identity and quality diagnostics. If record storage fails after the master saves, the error reports the saved master's path; the PSD/PSB is retained. These records do not implement full job recovery or automatic reopening/rebinding of editable results.

## Validation and remaining work

Local implementation checkpoint: `checkpoint/recolor-pilot-2026-10-19`. The [build record](verification/product-pilot-build-2026-10-19.json) pins the generated CCX checksum, native tested bundle and outstanding validation. This checkpoint is code and evidence; generated installers and Photoshop artifacts remain under ignored local storage.

Run `npm test` for application/library regressions, eight pilot session behavior checks and a complete pilot-package dependency/manifest check. Run `npm run test:recolor:photoshop` for actual native rendering and editability. The added integrated fixture samples an image, fits a native result, checks protected pixels, applies, saves/reopens, verifies source preservation, refuses master overwrite and retains independent target settings. Existing native fixtures cover soft masks, native control edits, PSD/PSB reopening, source preparation and source recovery.

The checked [integrated pilot native report](verification/product-pilot-25.3.1.json) records this tested bundle. It is synthetic technical evidence. Actual modeless panel interaction, live catalog/reference downloading and visual layout still need a workstation session; standalone script tests do not establish those UI properties. The pilot is packaged, not production-qualified.

Next iterations: interactive defects and usability; actual product-image color/detail/edge tuning; better reference preparation and original-source benchmarks; repeatable total designer timing; full multi-color generation/recovery; destination exports and per-output validation; then optional segmentation. The experimental Delta E anchor in the panel is not median/p95 gold performance or an industry certification. Professional appearance and productivity are evaluated on working results instead of making broad historical review a development prerequisite.
