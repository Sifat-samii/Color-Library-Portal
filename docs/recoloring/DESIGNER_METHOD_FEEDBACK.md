# Designer method feedback — 27 October 2026

This is designer preference evidence for the automatic selection policy. It is not a client-library color approval, a trained neural model, or proof that one method works for every lightening task.

## Navy → Arctic Aqua: reviewed and preferred

The designer reported that Automatic chose **Hue and selective color**, but **Tint and levels** gave the preferred visual result. The open Photoshop preview was inspected without editing, refreshing, applying, saving over, or reloading the session.

Observed preview: 1300 × 2000, Adobe RGB (1998), native tinted Black & White/Levels stack (`native-tinted-bw-natural-lighting-4`). The group was visible at 100% opacity with six editable adjustments: material tone curve, Levels, full source desaturation, tinted Black & White, Color Balance and luminosity lighting curves.

Observed settings: intensity 100, brightness 0, contrast +18, shadows −12, highlights 0; Levels gamma 0.7; midtone Color Balance `[3, 0, 0]`. Lighting curve knots were `[0,0]`, `[64,47]`, `[192,196]`, `[255,255]`. These belong to this reviewed example and are **not universal defaults**.

The captured reference sample measured Lab D50 `[85.006, -16.277, -7.651]`; the Navy material measured `[18.406, 3.441, -22.008]`. This is a +66.599 L* transition. The reviewed result measured diffuse ΔE00 1.58, relative detail 0.95, relative fold depth 0.71 and no added tonal clipping. The designer's visual preference takes precedence over ranking exclusively by numerical anchor/lighting score.

A read-only diagnostic snapshot and native layer descriptors were captured under ignored local storage: `storage/recolor-dev/designer-review-1Xaoan/`. This image is a review record, not a delivered client image.

## Navy → White Gardenia: reported exceptions

The designer subsequently reported:

- **Tint and levels:** excessive brightness washed detail out of some fabric areas.
- **Gradient and tone:** decent color, but flat shadows and lighting.
- **Hue and selective color:** poor result in this scenario.

These are user-reported observations. Gardenia's failed result was not captured as a native before/after pair; Photoshop had moved on to another target by the next inspection. The source library calls the reference **White Gardenia**. Do not treat the Aqua acceptance as a blanket approval of Tint and levels on white targets.

## Implemented selection policy

Policy ID: `designer-lightening-2026-10-27-v1`.

- Apply the preference to measured matte-material transitions with source L* ≤50, target L* ≥60 and a rise of at least 20 L*. Names and HEX values do not select the method.
- Prefer **Tint and levels**, continue fitting its parameters and retain explicit manual method overrides.
- Classify near-white targets as L* ≥90, or L* ≥85 with Lab chroma ≤12. Arctic Aqua's measured chroma is approximately 18 and is not treated as neutral near-white.
- For near-white targets, start D conservatively (brightness −4, gamma 0.85, contrast +6, highlights −6), then fit and measure the actual render. These are search seeds, not final values.
- Before honoring the preference, check protected pixels, added clipping, fine detail and relative fold depth. For near-white, also check detail retention in the source's brightest quartile and the weighted fraction of bright-region gradients that collapse. This can detect washed-out white fabric even when no RGB channel is fully clipped.
- Prefer **Gradient and tone** over Hue/selective color as the near-white fallback only when it retains fabric depth. A flat result does not qualify merely because its average color is close.
- Keep unsafe/weak candidates available to the fitting search so a poor starting seed can be corrected. Explain fallbacks or unresolved preservation warnings in the preview review.
- Leave small lightness changes, darkening and explicit method choices outside the preference policy.

The provisional guardrails allow at most 2% added tonal clipping, require at least 0.5 normalized fine detail, and require fold depth ≥0.35 for ordinary lightening or ≥0.5 for near-white. Near-white highlight-detail retention must be ≥0.25 and its weighted collapsed-detail fraction ≤0.35. Missing detail measurements are not fabricated; visual review remains necessary.

These rules operationalize the designer's observations. More reviewed cases are needed before treating the thresholds as calibrated production guarantees.
