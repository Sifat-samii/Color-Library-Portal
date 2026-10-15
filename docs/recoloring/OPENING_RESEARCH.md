# Sample2 PSD opening: research notes

**Subsequent status:** the copied Sample 2 input and two human PSDs opened successfully on the existing Photoshop 25.3.1 instance. Three real recoloring cases then completed native master round trips. The later apparent stall was a separate mask-loop performance bug, now reproduced and fixed; see [diagnosis evidence](MASK_PERFORMANCE.md). The original transport/opening failure's cause remains unconfirmed. The notes below retain the earlier investigation context.

15 October 2026. First-party Adobe sources only. This investigation did not drive Photoshop, cancel its running script, alter preferences, or modify implementation code.

## Observed state and interpretation

The parent investigation reports Photoshop 25.3.1: Sample1 opened; three local Sample2 PSDs produced DOM Document wrappers with undefined IDs and no open documents. An explicit native open on a 111 MB Sample2 then remained pending while Photoshop responded and consumed CPU. These observations do not establish corruption, a hidden prompt, an external-asset wait, or a rendering defect. Valid headers, resource lengths and ICC data do not validate every layer, compressed channel, embedded object or composite payload.

Adobe documents `app.open(fileEntry)` as returning a Document; its argument is a UXP File entry. No second open-options object is documented. For diagnosis, inspect the complete native result and require a valid returned `documentID` that exists in `app.documents`; a JavaScript wrapper alone is not evidence of a successful open. The inspected installed DOM implementation's unchecked wrapping explains how an invalid native result could be concealed, but the actual earlier result is needed to identify its cause. [Adobe open API](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/photoshop)

## Dialog and result semantics

`_options.dialogOptions: "dontDisplay"` **can show UI** when an error occurs or more parameters are required. `"silent"` is the documented no-UI default and returns a scripting error for such conditions; `"display"` shows normal command UI. Consequently, the pending command's `dontDisplay` setting does not exclude a relink or other required prompt.

`batchPlay` may reject invalid input or resolve with an error descriptor for a valid command that Photoshop cannot execute. Capture both paths, including error code/message and the complete result. Do not infer success from promise resolution. [Adobe command options and results](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/batchplay)

## Plausible dependencies, not confirmed diagnoses

- **Linked Smart Objects:** Adobe documents a relink dialog when opening a document with missing source files. Resolution checks the last-known relative location, then absolute location, an alias on macOS, and the document's folder. Copying a PSD to a local disk does not remove those internal dependencies. Check for external/UNC paths after the current operation ends, or inspect structured linked-layer blocks read-only. [Adobe linked-file resolution](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/smart-objects/package-linked-smart-objects.html)
- **Profile prompts:** An embedded Adobe RGB profile can still differ from the working space and trigger Ask When Opening. A valid ICC profile does not exclude a profile-policy dialog. Preserve the embedded profile for the color comparison; do not discard it merely to bypass a prompt. [Adobe opening color policies](https://helpx.adobe.com/photoshop/desktop/adjust-color/choose-colors/manage-color-profiles-when-opening-images.html)
- **Layer/embedded payload or host-specific processing:** PSD contains layer/mask records, compressed pixel data, embedded/linked object blocks and a composite. Header/resource checks alone cannot certify those structures. A large PSD with modest canvas dimensions is not proof of any particular fault. [Adobe PSD specification](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/)

## Safe cancellation and bounded diagnosis

Adobe documents standalone script cancellation through the progress UI, `script.executionContext.isCancelled`, and the script cancellation event. Modal execution also documents Escape/progress cancellation and error propagation. Do not swallow cancellation errors. These are cooperative mechanisms, not a guarantee that every native decoder immediately interrupts. [Standalone script lifecycle](https://developer.adobe.com/photoshop/uxp/2022/scripting/reference/), [Modal cancellation](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/executeasmodal)

There is no documented per-command `batchPlay` execution timeout. `executeAsModal.timeOut`, introduced in 25.10, controls acquisition of a modal scope, not an open-operation deadline; it is unavailable on 25.3.1. A JavaScript timer/Promise.race does not cancel a pending native open. Do not dispatch another open or destructive cleanup until the current operation settles or cancellation is confirmed.

After the running operation finishes or is deliberately cancelled by its owner:

1. Preserve the samples and record the raw native result, elapsed time, cancellation status and actual host/build. Retry only one copied sample, using normal File > Open/visible dialogs. This separates required UI from a script-only failure. Do not overwrite the supplied PSD.
2. If normal opening succeeds, inspect missing links, profile policy and the exact recorded open action. Repeat one controlled `silent` call and log all results. Do not globally suppress warnings or change color policy as an assumed fix.
3. If normal opening also stalls, record Help > System Info, scratch free space, GPU/driver and plug-in inventory. Later isolated tests can disable GPU or use Shift-launch to bypass optional/third-party plug-ins, restoring the previous configuration afterward. Preferences reset and forced termination are not first diagnostic actions. [Adobe System Info](https://helpx.adobe.com/photoshop/desktop/troubleshoot/troubleshoot-tools-resources/use-system-info-to-diagnose-issues.html), [Adobe isolation guidance](https://helpx.adobe.com/photoshop/kb/troubleshoot-crash-or-freeze.html)
4. As a separate recovery diagnostic, Adobe documents Shift+Alt during opening on Windows to use the saved composite, if compatibility data exists. This loses layers, must be saved under a new name, and cannot count as successful native-layer validation. [Adobe composite recovery](https://helpx.adobe.com/photoshop/kb/file-recovery-photoshop.html)

Until the same Sample2 opens successfully in the native host, mark its recoloring evaluation **blocked at input opening**, not passed or failed on recoloring quality. The research does not identify a confirmed root cause.
