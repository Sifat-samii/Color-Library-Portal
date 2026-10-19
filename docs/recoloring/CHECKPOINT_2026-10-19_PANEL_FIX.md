# Recolor pilot 0.6.1 panel fix checkpoint

Checkpoint tag: `checkpoint/recolor-pilot-fix-2026-10-19`. Previous product checkpoint: `0071ae7` (`checkpoint/recolor-pilot-2026-10-19`).

The integrated pilot is loaded locally and works through actual Photoshop panel events. No portal deployment or database migration was required. The regular 0.5.15 release inputs remain unchanged.

## Fixed

- Wrap Imaging pixel and mask reads, buffer access, disposal and mask inventory in short Photoshop modal scopes. Standalone scripts had concealed the modeless-panel failure.
- Explicitly select the first mask and method options, and retain the selected target by index. Photoshop 25.3.1 left newly populated selects at index -1.
- Compare RGB and RGBA protected pixels using independent strides and implicit full opacity for RGB. Geometry, profile, precision, RGB changes and actual alpha changes remain strict checks.
- Enable mask acquisition on a fresh variant even when its selected target retains previous recipe settings.
- Keep status visible above scrollable controls and keep recoloring controls available while the catalog connects.
- Provide a stable generated development manifest: `storage/recolor-dev/pilot-current/plugin/manifest.json`.

## Evidence

- `npm test`: passed, including 15 recoloring measurements/fitting checks, eight session checks, two modeless modal-scope regressions and package dependency validation.
- Real Photoshop 25.3.1: all 26 native checks passed. PSD and PSB reopening retained native adjustments, editable masks and Adobe RGB. Initial documents were preserved and no unexpected documents remained.
- Loaded panel: all ten live checks passed, including real approved-library reference retrieval/sampling, native fitting, intensity changes, Apply, independent New variant, and session end. Disposable fixtures were cleaned up; the prior user document remained open.
- The live test uses actual DOM events rather than physical pointer input. The save picker still needs an ordinary manual test; native saves and reopened masters are covered separately.

The [fix record](verification/product-pilot-fix-2026-10-19.json) pins package hashes and both native and live reports. Earlier reports remain historical, including failed probes under ignored local debug storage.

## Test and continue

Follow [First recoloring](PRODUCT_PILOT.md#first-recoloring). The corrected panel is already loaded on this workstation. For future reloads, add the stable manifest to Adobe UXP Developer Tools and verify version 0.6.1.

Next product work: evaluate actual product-image results and improve reference sampling, tone behavior and edge quality; complete delivery export presets, multi-color batch generation and recovery; then optional segmentation. Synthetic technical passes do not establish human-quality color accuracy or production qualification. Historical PSD review is not a prerequisite for trying the product.
