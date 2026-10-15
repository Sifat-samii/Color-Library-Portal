# Native mask-write diagnosis

15 October 2026, Photoshop 25.3.1. The benchmark had reached adjustment creation; its report had not flushed a later phase, so the first apparent reference-measurement location was misleading. A minimized source probe isolated the stall to material-mask writing.

The inner pixel loop read `document.width` and `document.height` repeatedly. These are native DOM calls. A 1300 x 2000 mask therefore caused millions of host crossings before writing its pixels. Cache both dimensions once before allocating and iterating; use those values for bounds, indexing and image-data creation.

| Real-host check | Before | After |
| --- | ---: | ---: |
| Native dimension reads for 96 x 64 mask | 18,442, regression failed | 8, regression passed |
| Regression elapsed time | About 4.5 s | About 0.8 s |
| 1300 x 2000 minimized render | Cancelled after a prolonged mask loop | About 0.42 s; mask write about 54 ms |

`host-tests.js` retains the regression: it wraps real native documents to count dimension getter access while executing the real adapter and Photoshop renderer. It does not simulate native rendering. At that milestone the refreshed harness passed all 16 fixtures, including PSD and PSB reopen/edit checks. The current [verification report](verification/photoshop-25.3.1.json) includes 25 passing fixtures after the [native-depth and tinted-candidate work](NATIVE_ENGINE_PROGRESS.md) and [reviewed source preparation](SOURCE_PREPARATION.md).

The corrected three-case CBI pilot completed next. Original documents and supplied files were preserved. No Photoshop process termination or automatic closure of earlier interrupted documents was used. Earlier interrupted previews remain available for deliberate inspection.

Local diagnostic reports are under ignored `storage/recolor-dev/`: `dimension-red-1792071423986`, `dimension-green-1792071623364`, and `render-probe-fixed-1792071639179`. They are separate from quality benchmarking. The full-size probe used a synthetic target for diagnosis, not an approved color preparation.

Prevention: bound host-property reads in pixel-processing loops, keep native phase journals, and distinguish host aborts from completed operations. The launcher records interrupted runs after native return; it never uses a JavaScript timer as a purported native cancellation mechanism.
