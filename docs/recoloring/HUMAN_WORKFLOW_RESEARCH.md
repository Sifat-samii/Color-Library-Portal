# Studying the existing human recoloring workflow

Reviewed 15 October 2026. This note supplies Adobe's documented mechanics and a proposed inspection procedure. It does **not** classify the supplied PSD layers or establish the cause of any observed halo. Those conclusions require the separate local PSD audit and rendered experiments. Engine changes should follow that audit.

The user's clarified benchmark input is the underlying original product appearance **with essential base retouching retained**. Earlier runs starting from the saved Royal/Desert Taupe appearances are exploratory results for a different source state; they do not validate this revised benchmark.

## 1. Capture the actual native recipe

Adobe documents `batchPlay` property reads, development-only discovery using `get` without a property, and recording native commands with **Copy As JavaScript**. Target document/layer IDs explicitly, inspect returned error descriptors, and preserve the unmodified returned payload beside the interpreted summary. A shipping integration should request specific properties rather than repeatedly dumping every property. [Adobe batchPlay contract](https://developer.adobe.com/photoshop/uxp/ps_reference/media/batchplay/)

For each group and child, record hierarchy/order, own and effective visibility, type, blend mode, opacity/fill, clipping relationships, mask settings, advanced blending, and the complete available adjustment payload. Record unsupported or absent fields as unknown. A custom preset label alone does not describe its transformation; absence of extracted points must not be treated as an identity curve. This is an audit completeness rule, not an established extraction defect in this workstation.

| Native family | What to preserve and interpret |
|---|---|
| Curves | Composite and individual channel input/output points or sampled mapping, black/white endpoints, opacity and blend mode. Composite curves change tone; channel curves can change color balance. Curve slope changes contrast, so a color recipe can also change visible weave/folds. [Adobe Curves](https://helpx.adobe.com/photoshop/using/curves-adjustment.html) |
| Hue/Saturation | Master and targeted ranges, range/fall-off boundaries, hue/saturation/lightness and Colorize state. Ranges determine which original colors respond; copying three master sliders can omit the technique. [Adobe Hue/Saturation](https://helpx.adobe.com/photoshop/desktop/adjust-color/color-corrections/apply-a-hue-or-saturation-adjustment.html) |
| Selective Color | Every adjusted color family, CMYK controls and Relative/Absolute mode. These methods differ, and RGB documents still use these CMYK-style controls. [Adobe Selective Color](https://helpx.adobe.com/photoshop/desktop/adjust-color/selective-color-adjustments/make-selective-color-adjustments.html) |
| Solid Color | Profile-interpreted color, blend mode, opacity, clipping and coverage. Color mode combines the blend hue/saturation with base luminance; it does not independently solve a large brightness change. [Adobe blend definitions](https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/blending-mode-descriptions.html) |
| Gradient Map | Color stops/positions/midpoints, interpolation data where exposed, reverse/dither, opacity and blend mode. It maps shadows through midtones to highlights; preserve the complete map rather than one representative swatch. [Adobe Gradient Map](https://helpx.adobe.com/photoshop/desktop/adjust-color/color-effects-techniques/apply-special-color-effects-to-images.html) |
| Raster/Smart Object corrections | Bounds, content identity, filters/effects and blending, without flattening or overwriting. Their purpose requires before/after evidence; a texture-looking layer may belong only to one target. |

The PSD specification distinguishes adjustment payloads, transparency, user masks, clipping, blending ranges and group structure. Its Curves load-file section describes channel curves and point ordering. These are useful independent inspection references, **not** a guarantee that every modern ActionJSON schema or all Photoshop rendering behavior is documented. Keep Photoshop's rendered composite authoritative. [Adobe PSD specification](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/)

## 2. Preserve blending context and effective mask coverage

Pass Through allows child adjustments to interact with content outside their group. Other group blend modes composite children first and change that interaction. Therefore switching a human group to Normal is not a neutral way to isolate it. Capture group and child blending together, including clipping and layer order. [Adobe group blending](https://helpx.adobe.com/photoshop/using/layer-opacity-blending.html)

Blend If can expose or suppress source/underlying tonal ranges, with split sliders providing a partial transition. Record both ranges and channel choices; otherwise apparent highlight/shadow protection may be misattributed to the color adjustment or mask. [Adobe advanced blending](https://helpx.adobe.com/photoshop/using/layer-opacity-blending.html)

Soft Light and Overlay alter contrast/light interactions. Their presence does not prove a base lighting correction: target-specific texture or tonal styling can use the same modes. Classification must consider placement, repeated use across targets and actual on/off renders. [Adobe blend definitions](https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/blending-mode-descriptions.html)

`Selection.load(layer)` loads pixel transparency; it does not read the layer mask. Read the user/vector mask explicitly, retaining returned bounds/offsets. Vector masks are paths; rasterizing one changes its editing representation. Density, feather, disabled state and linked position must also be recorded. [Adobe Selection](https://developer.adobe.com/photoshop/uxp/ps_reference/classes/selection/), [Imaging API](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/imaging), [vector masks](https://helpx.adobe.com/photoshop/using/masking-layers-vector-masks.html), [Layer properties](https://developer.adobe.com/photoshop/uxp/ps_reference/classes/layer/)

**Required experiment:** inspect full-resolution interior, fractional boundary and protected regions with the original group mask, any child masks and advanced blending intact. Compare controlled alternatives separately. A repeated soft mask, excessive feather, source-colored boundary pixels, or a strong tonal transform are candidate explanations for halos; documentation alone does not establish which caused the Ceil Blue result. Do not auto-contract every mask or copy target-specific edge paint as a universal fix.

## 3. Separate base corrections from target recipes through ablation

This procedure is a proposed development protocol, not an Adobe classification API:

1. Hash originals, work on owned duplicates, and record the saved complete hierarchy and visibility state before changing visibility.
2. Render the saved appearance. Then render candidate original-source states by disabling only identified recoloring branches. Retain all layers, masks, paths and channels in the duplicate.
3. Toggle ambiguous adjustments individually **in their original blending context**; render and measure their effect on garment tone/chroma/detail, skin/background and cleanup regions. An isolated layer rendered on a blank canvas is not the same experiment.
4. Classify each component as **confirmed base**, **confirmed target-specific**, **shared dependency**, or **ambiguous**, with descriptor evidence, before/after crops and rationale. A Curves layer can serve both color and lighting; its type or name cannot resolve intent.
5. Do not disable a whole mixed group if that removes essential cleanup/lighting. Do not silently retain its target-specific texture either. Ambiguous source states remain ineligible for scored evaluation until reviewed; retain alternative candidate source renders for that review.
6. Once resolved, freeze a versioned source-state manifest. Render each existing professional target as a distinct gold appearance using its own complete branch and required shared dependencies. Confirm correspondence with delivered JPG/PSD gold; mismatches remain separate evidence, not interchangeable truth.

## 4. Measurements and the next development gate

Interpret tagged originals using their embedded profile. Convert owned comparison copies to the declared measurement/working profile; assigning a profile changes interpretation without converting values. Record conversion options and embed Adobe RGB in production masters. [Adobe profile handling](https://helpx.adobe.com/photoshop/desktop/adjust-color/color-profiles/change-color-profile-for-documents.html)

Read native composites with an explicit profile, depth and alpha policy. Photoshop's Imaging API uses Lab D50; downsampled reads can use cache levels whose bounds differ from full-resolution coordinates. Use matching geometry and full-resolution boundary crops for edge findings. [Adobe Imaging API](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/imaging)

After source classification, the plan should add these gates before further engine tuning:

- Publish the human-technique inventory and resolved/ambiguous base-state decisions first.
- Use development targets to select general adjustment families, bounded tone strategies and mask-handling improvements. Reused human masks are explicitly supplied spatial input, not proof of automatic segmentation quality.
- Partition by source/product family before renewed evaluation: the same original view or another view of its product must not cross development and held-out groups unnoticed. Targets already studied cannot become untouched holdouts by changing a manifest label.
- Give the evaluation engine only the resolved source composite/structure, approved reference preparation and declared mask. Existing target curves, target visibility, human target pixels and target-specific texture/edge layers must not influence candidate generation, fitting or ranking.
- Use human gold only in the separate evaluator after the automatic result is frozen. Report validity of alignment/regions, color residuals, detail retention, boundary/protected-area changes and retoucher judgment separately.
- Re-run all affected cases from the revised source state; keep earlier saved-appearance reports as superseded exploratory evidence. Do not carry forward their color/detail conclusions as release results.

Adobe documentation supports the available native mechanisms. It cannot identify a designer's intent, certify the source state, prove a halo diagnosis, establish human-quality equivalence or prevent benchmark leakage. Those are local audit, experiment and review obligations.
