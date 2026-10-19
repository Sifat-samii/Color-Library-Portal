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

This writes an integrated plugin folder and CCX under a unique `storage/recolor-dev/pilot-*/` directory, and refreshes the stable development folder at `storage/recolor-dev/pilot-current/plugin/`. The generated `storage/recolor-dev/latest-pilot.json` records both paths and the CCX checksum. Generated artifacts are ignored by Git; rebuild when code changes, then reload in UDT.

The pilot uses the **same plugin identity and panel entrypoint** as the existing Color Library, version **0.6.2**, with Photoshop **25.3+** and explicit Photoshop API v2. The regular 0.5.15 manifest/config and release CCX remain available. Normal `plugin:package` still excludes experimental recoloring; the pilot command is the explicit distribution path for this increment.

Load this manifest with **Adobe UXP Developer Tools > Add Plugin > Load**:

```text
D:\Sifat_Project Coordinator\Color Library Portal\storage\recolor-dev\pilot-current\plugin\manifest.json
```

If the same plugin ID is already loaded in UDT, unload its old development entry before loading the pilot; preserve any unsaved Photoshop work. If this stable entry is already added, use **Reload** after a rebuild. Confirm UDT and the Recolor toolbar show **0.6.2**. The `UXP/manifest.json` in the source folder is the regular library release; the separate Recolor Lab manifest is a harness. Alternatively, install the generated pilot CCX using Adobe's installer. Installing/updating the panel on a workstation is separate from building it.

UDT saves its manifest path separately from the runtime loaded through its debugging service. A service-only load can pass technical tests while UDT's Reload action still points to another folder. `npm run recolor:pilot:check` reads that saved entry, reports its effective manifest path and version, and compares all current pilot runtime files against the registered copy. This check does not change Adobe settings or Photoshop documents. Confirm the visible **Pilot 0.6.2** label after Load/Reload before interpreting layout or click results.

On this workstation the owner was still reopening the original `pilot-VlepQ6/plugin/manifest.json` (0.6.0). That exact generated development folder was backed up and refreshed to 0.6.2; its original 0.6.0 CCX archive remains unchanged. The owner has confirmed the visible 0.6.2 label, that library controls no longer overlap Recolor, and that Go to preview opens the product preview. The [registration repair record](verification/product-pilot-registration-2026-10-19.json) separates those confirmations from pending workflow checks. For future updates prefer the stable manifest above, or verify and refresh the actual registered development copy; building another folder alone does not update UDT's saved entry. Earlier per-artifact development-folder checksums are historical; the installer archive checksums remain valid.

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

Disabled controls express prerequisites: **Preview color** needs a captured material mask and sampled approved reference; **Apply Color** needs a completed preview; **Save editable PSD/PSB** needs an applied result. Status and errors stay visible above the scrollable controls. Selecting a different method takes effect on the next **Preview color** operation.

In 0.6.2, Recolor is a separate layout view. Opening it hides the library controls with both `display: none` and `visibility: hidden`; Browse library restores their previous view. This addresses the [documented UXP native-text-widget stacking limitation](https://developer.adobe.com/photoshop/uxp/2021/uxp/known-issues/). A high z-index alone cannot isolate an overlay from native text inputs. The owner's screenshots exposed overlapping library fields that synthetic event tests missed.

The [0.6.2 layout record](verification/product-pilot-layout-2026-10-19.json) distinguishes the reproduced overlap, native computed-style regression, and pending physical-click confirmation. Run `npm run test:recolor:layout` against the connected development runtime to check library-widget hiding and restoration without creating or altering any Photoshop documents. Passing this check does not establish physical-pointer functionality. When debugging with the owner, verify **Use active product** with a real click before continuing to masking or reference selection.

## Reference identity and failure behavior

The library still owns approval status. Targets retain client/color/reference/version identity, original filename, declared checksum and historical approval metadata. A fresh temporary file is hashed before opening. A declared checksum mismatch rejects it. After opening, the reference's full rendered-pixel fingerprint is checked at sampling: changing a selection is allowed; editing image pixels is refused. Pixel fingerprints establish session consistency, not another client approval or physical-swatch accuracy.

Fitting/applying rechecks that the selected version is still present in the current client catalog. Withdrawal/version/client changes block subsequent operations while preserving completed variants. As with the existing library, offline cached catalogs cannot establish a withdrawal that has not been synchronized yet.

Saving protects source/reference paths and refuses existing nonempty output files. A versioned local session record includes recipe, source interpretation, approved reference identity and quality diagnostics. If record storage fails after the master saves, the error reports the saved master's path; the PSD/PSB is retained. These records do not implement full job recovery or automatic reopening/rebinding of editable results.

## Validation and remaining work

The initial implementation checkpoint is `checkpoint/recolor-pilot-2026-10-19`. Its [0.6.0 build record](verification/product-pilot-build-2026-10-19.json) remains historical. The [0.6.1 fix record](verification/product-pilot-fix-2026-10-19.json) pins the corrected build and live validation. Generated installers and Photoshop artifacts remain under ignored local storage.

Run `npm test` for application/library regressions, eight pilot session behavior checks and a complete pilot-package dependency/manifest check. Run `npm run test:recolor:photoshop` for actual native rendering and editability. The added integrated fixture samples an image, fits a native result, checks protected pixels, applies, saves/reopens, verifies source preservation, refuses master overwrite and retains independent target settings. Existing native fixtures cover soft masks, native control edits, PSD/PSB reopening, source preparation and source recovery.

The initial [integrated pilot native report](verification/product-pilot-25.3.1.json) is retained alongside the [0.6.1 native report](verification/product-pilot-fix-native-25.3.1.json). Both are synthetic technical evidence. The [live panel report](verification/product-pilot-fix-panel-25.3.1.json) additionally drives actual loaded-panel DOM events against Photoshop and an approved CBI library reference. This verifies modeless source/mask reads, reference retrieval and sampling, fitting, fine-tuning, Apply and independent variant controls. It does not test physical pointer hit areas, the interactive save picker, or qualify visual matching on production garments. Native fixtures verify PSD/PSB saves and reopening separately. The pilot is not production-qualified.

To repeat the live check, leave the panel visible in Photoshop and run `npm run test:recolor:panel -- --attached --reference` with Adobe UDT running and a client catalog selected. This uses the local runtime session recorded by the debugging script. Without `--attached`, the script validates and reloads the generated pilot first; end any active recoloring session before doing so. It creates isolated synthetic documents and a temporary reference copy, closes only unchanged documents it owns, and restores the prior active document. It never saves the user's open image. The synthetic reference region is only a technical probe, not a color accuracy assessment.

Next iterations: interactive defects and usability; actual product-image color/detail/edge tuning; better reference preparation and original-source benchmarks; repeatable total designer timing; full multi-color generation/recovery; destination exports and per-output validation; then optional segmentation. The experimental Delta E anchor in the panel is not median/p95 gold performance or an industry certification. Professional appearance and productivity are evaluated on working results instead of making broad historical review a development prerequisite.
