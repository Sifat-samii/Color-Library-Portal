# Retoucher review handoff

**Current sequence:** the [integrated product pilot](PRODUCT_PILOT.md) is the default development path. This historical-source review is optional preparation for qualifying those benchmark cases, not a prerequisite for trying or building the tool. The owner chose to review working results and iterate.

19 October 2026. This is an internal technical review by a senior Photoshop retoucher familiar with the client's accepted work. It does not require new client color approval.

The production Color Library has no new Apply Color workflow yet. The implemented experiments live in a separate **Recolor Lab (Development)** panel. Its bundle is built, but interactive panel validation is still pending. The developer remains responsible for fixing panel failures, running qualified benchmarks, calculating valid metrics, and completing production integration.

## 1. Start with source review; no new panel is required

Open the existing [human-technique review gallery](../../storage/recolor-dev/human-techniques-1792074735482/analysis-1792075469223/review.html) in a normal browser. If the link does not launch, paste this path into File Explorer and double-click `review.html`:

```text
D:\Sifat_Project Coordinator\Color Library Portal\storage\recolor-dev\human-techniques-1792074735482\analysis-1792075469223\review.html
```

This gallery shows existing human edits, source candidates and comparisons with individual shared layers disabled. It is not a gallery of qualified automatic results. It has no review-note saving controls; record decisions in a copy of the [review notes template](REVIEW_NOTES_TEMPLATE.md). Its small sRGB images help navigation only. Make final judgments on the layered working duplicates in Photoshop at 100%.

The layered human adjustments are in these input PSDs:

```text
Z:\Sifat_Project_Coordinator\Color library test\Recolor Data\CBI\Recolor Sample 1\Input
Z:\Sifat_Project_Coordinator\Color library test\Recolor Data\CBI\Recolor Sample 2\Input
```

The approved references are in `CBI\Approved Color\CROP` and `CBI\Approved Color\FULL`. The matching human deliveries are in each sample's `Output` color folders. Sample 1 has JPEG gold. Sample 2 has JPEG and composite PSD gold; its output PSDs do not contain the editable human adjustment stacks.

Choose one senior retoucher. For an initial handoff, start with `WW115_01.psd` and one other Sample 1 view, plus a Sample 2 view other than 01 or 07. These are suggested review candidates, not already-qualified sources. Aim for 3-5 source/target combinations, including a neutral/dark and a lighter/saturated target. A case means one source view plus one target color. Expand to the planned 20 cases after this initial review works.

For each source:

1. Open the input PSD. Use **Image > Duplicate**, retaining layers. Toggle or inspect layers only in this working duplicate. Leave the original file untouched.
2. Identify target-specific recoloring groups and any shared neutralization outside them. Determine which must be disabled to recover the original fabric color. Do not assume that disabling `CC` alone is sufficient.
3. Inspect shared `RT`, `Layer 1`, `BG`, `AD`, `Logo`, `Texture` and tone adjustments wherever present. Compare on/off effects and record their actual purpose. Names and adjustment types are not proof of purpose.
4. Record each relevant root group/layer as **Keep base / cleanup / lighting**, **Disable existing recoloring**, **Disable reference guide**, or **Unresolved**. One decision can cover a whole group when its contents have the same role. Record exceptions by full layer path; distinguish duplicate names by their order/position.
5. Confirm that the recovered source retains original material detail, cleanup, intended lighting, labels and background. Select the intended position for new recoloring relative to the retained finishing layers. Record the root layer it should sit immediately above, or explicitly choose above all source layers. Do not reorder the original structure.
6. Confirm the material mask, protected labels/hardware/background, and representative diffuse sampling areas. Record mask/path/channel names and locations; keep shadows, specular highlights, seams and mixed materials out of diffuse color samples.
7. Record reviewer, date and decisions in the notes. If a role cannot be established, mark the source **Needs clarification / exclude for now**. Do not approve a source merely to unblock the test.

Keep Sample 2 view 01 root `Hue/Saturation 3` (saturation -100, lightness -3) and view 07 root `BASS` (hue -43, saturation -50, lightness -4) flagged and excluded unless their intent is explicitly resolved by a retoucher. They need not block review of other views. Ignore Heather Ash. Treat Desert Taupe's added raster weave as a separate material treatment outside initial color-only matching.

## 2. Load the development panel for an assisted trial

The developer has rebuilt the panel. Adobe UXP Developer Tools is installed on this workstation at:

```text
C:\Program Files\Adobe\Adobe UXP Developer Tools\Adobe UXP Developer Tools.exe
```

1. Leave Photoshop open and launch Adobe UXP Developer Tools from Start or the path above.
2. Enable Developer Mode if UDT prompts for it. Confirm Photoshop appears among connected applications.
3. Choose **Add Plugin** and select this existing manifest (do not create a new plugin):

   ```text
   D:\Sifat_Project Coordinator\Color Library Portal\storage\recolor-dev\panel\manifest.json
   ```

4. Find **Pixofix Recolor Lab** in UDT and choose **Load** from its Actions menu. If already added, use **Reload**.
5. In Photoshop, open **Plugins > Recolor Lab (Development)**. Depending on the host menu layout, the panel entry may appear under **Pixofix Recolor Lab**. The existing Color Library remains a separate panel.

These are Adobe's documented development-plugin loading steps: [installation and Developer Mode](https://developer.adobe.com/photoshop/uxp/2022/guides/devtool/installation), [Add Plugin, Load and Reload](https://developer.adobe.com/photoshop/uxp/2021/guides/udt-walkthrough/).

If loading fails or the panel is blank, record the exact UDT error through **Details/Logs**, Photoshop version, and the step that failed. Return those details to the developer. A panel failure is an implementation issue, not a failed retoucher review. Do not spend time changing machine security settings or trying unrelated plugin installations.

## 3. Run one reviewed case

1. Activate a fresh layered working duplicate in its saved starting state. Choose **Inspect source layers** in the lab. Enter the previously reviewed roles, the root insertion location and reviewer name. Group children may inherit their group's decision. If you make native Photoshop edits after inspection, inspect again before confirming.
2. Choose **Confirm roles and capture reviewed source**. This creates the normalized frozen source and preview. Check that the correct product is bound and original color/base retouching are intact. Unresolved roles block capture. Do not use **Capture visible state (unreviewed experiment)** for source qualification.
3. Optionally choose **Save reviewed source recovery checkpoint** into a new local review folder. Keep the resulting PSB and final JSON together. This preserves the reviewed source, not an entire fitted session.
4. In the preview document, select the garment/material with normal Photoshop tools, or choose a reviewed layer mask, saved selection or path in the lab. Click **Use this mask**. Inspect labels, hardware, skin/background and fine edges. Unsupported complex masks require a designer-created selection.
5. Open the actual approved color reference through the library or Photoshop. Activate it and select a representative diffuse fabric area, excluding background, deep shadow and bright specular reflection. Click **Sample active reference selection**. Record the exact reference filename and area in the notes; no HEX is needed. Untagged inputs require a deliberate profile interpretation before sampling.
6. Return to the product preview. Choose **Compare and fit A/B/C**. Record failures and useful/unusable candidates. **Preview method** lets you inspect A, B and C individually. The extra experimental D method is not exposed in this panel yet.
7. Use **Show original** for comparison and tune the available controls. Inspect at 100% against both the approved reference and the matching human delivery. Check undertone, texture, fold depth, highlights/shadows, edges and protected details. The displayed diffuse-anchor Delta E is diagnostic, not final quality approval.
8. Choose **Apply native adjustments**, then **Save experimental PSD/PSB** under a new filename in the review folder. Save a separate copy before any manual correction if comparing before/after retouching. Never save over input files or human gold. For example, use `WW115_01_Wine_auto_v01.psd` and `WW115_01_Wine_reviewed_v01.psd`.
9. Save, close and reopen the experimental master only after preserving your work. Verify the native adjustments and group mask remain editable, Adobe RGB (1998) is embedded, and disabling the recoloring group restores the normalized source appearance. Record any discrepancy; automatic per-output validation in the panel is still pending.
10. Record **acceptable as-is / minor adjustment / major correction / unsupported / blocked by tool**, defects, corrections and complete time. Count mask/reference preparation, processing, manual correction, QC and saving. Record a measured conventional manual baseline where available; label estimates as estimates.

Use **New preview revision** for another target or after manual edits; previous work stays open. A new revision starts from the frozen source. Separate tuned settings per target are not yet retained. Start another source with UDT **Reload** after saving review work; existing documents remain open. If needed, restore its reviewed source checkpoint and select its mask/reference again. Ordinary panel reload is not full job recovery.

## 4. Return the handoff

Save a copy of the notes template as `CBI_retouch_review_YYYY-MM-DD_<initials>.md` in your chosen review folder. Plain text with the same fields is also sufficient. Tell the developer the local folder path in this chat; no email or client submission is required.

The initial handoff is complete when it contains:

- Reviewer identity/date, reviewed source files, explicit role/insertion decisions and unresolved exclusions.
- Exact approved reference and accepted human delivery for each initial case, mask and comparable region notes.
- Saved experimental outputs when the panel works; otherwise the exact blocking error and step. A rejected result is useful review evidence.
- Color/detail/edge findings, edits needed, and measured complete workflow times where a run completed.
- Client delivery requirements: format, dimensions, resolution metadata, profile, quality/transparency, naming and folder rules; mark unknown items as unknown.

The developer then applies these decisions, fixes interactive defects, integrates qualified sources into the benchmark runner, reruns actual Photoshop renders and presents the expanded feasibility results for review. The current automated runner still uses saved visible source state, so its old results cannot complete this gate. Passing the initial handoff does not establish production release readiness or the full 20-case quality/productivity targets.
