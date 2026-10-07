const requestStatusLabels = {
  AWAITING_DELIVERY: "Awaiting delivery",
  IN_PROGRESS: "In review",
  CHANGES_REQUESTED: "Changes requested",
  APPROVED: "Approved",
  IN_REVIEW: "In review",
  NEEDS_CHANGES: "Needs changes",
  WITHDRAWN: "Withdrawn"
};

function requestStatusLabel(status) {
  return requestStatusLabels[status] || status;
}

function requestStatusClass(status) {
  return String(status || "").toLowerCase();
}

function shownProfile(label) {
  const text = String(label || "").trim();
  return /adobe\s*rgb/i.test(text) ? "" : text;
}

function requestClientQuery() {
  if (state.user.role !== "ADMIN") return "";
  return `?clientId=${encodeURIComponent(state.user.selectedClientId)}`;
}

function requestStatusMessage(title, message, action) {
  return `<section class="panel request-status" role="status"><strong>${esc(title)}</strong><p>${esc(message)}</p>${action || ""}</section>`;
}

function requestEmptyState(title, message, action = "") {
  return `<section class="panel workflow-empty"><span class="workflow-empty-icon" aria-hidden="true">◇</span><h3>${esc(title)}</h3><p>${esc(message)}</p>${action}</section>`;
}

async function renderColorRequests() {
  if (state.user.role === "ADMIN" && !state.user.selectedClientId) {
    state.view = "clients";
    return render();
  }
  if (state.view === "request" && state.requestId) return renderColorRequestDetail(state.requestId);
  state.view = "requests";
  state.requestId = null;
  syncAppRoute();
  nav(workspaceNav());
  page(
    state.user.role === "ADMIN" ? "CLIENT REQUESTS" : "COLOR REQUESTS",
    "Color requests",
    "Submit a swatch. Deliveries stay here until you approve one into Approved colors.",
    ""
  );
  $("#content").innerHTML = requestStatusMessage("Loading color requests", "Fetching the latest requests.");
  $("#content").setAttribute("aria-busy", "true");
  try {
    state.colorRequests = (await api(`/api/color-requests${requestClientQuery()}`)).requests;
    drawColorRequests();
  } catch (error) {
    $("#content").innerHTML = `${requestStatusMessage("Could not load color requests", error.message, '<button id="retryRequests" class="secondary" type="button">Try again</button>')}`;
    $("#retryRequests").onclick = () => renderColorRequests();
  } finally {
    $("#content").removeAttribute("aria-busy");
  }
  const createButton = $("#newColorRequest");
  if (createButton) createButton.onclick = () => openColorRequestForm();
}

function drawColorRequests() {
  const requests = state.colorRequests || [];
  const waiting = requests.filter(request => request.status === "AWAITING_DELIVERY").length;
  const inProgress = requests.filter(request => request.status === "IN_PROGRESS").length;
  const needsChanges = requests.filter(request => request.status === "CHANGES_REQUESTED").length;
  const options = ["all", "AWAITING_DELIVERY", "IN_PROGRESS", "CHANGES_REQUESTED", "APPROVED"].map(value => {
    const label = value === "all" ? "All statuses" : requestStatusLabel(value);
    return `<option value="${value}" ${value === (state.requestFilter || "all") ? "selected" : ""}>${label}</option>`;
  }).join("");
  const activeFilter = state.requestFilter || "all";
  const stat = (filter, count, label) => `<button class="stat request-stat" type="button" data-request-filter="${filter}" aria-pressed="${activeFilter === filter}"><strong>${count}</strong><span>${esc(label)}</span><i aria-hidden="true">→</i></button>`;
  $("#content").innerHTML = `<section class="stats request-stats" aria-label="Request status summary">${stat("all", requests.length, "All requests")}${stat("AWAITING_DELIVERY", waiting, "Awaiting delivery")}${stat("IN_PROGRESS", inProgress, "In review")}${stat("CHANGES_REQUESTED", needsChanges, "Needs changes")}</section><div class="toolbar request-toolbar"><label class="search-field"><span class="sr-only">Search color requests</span><svg class="search-field-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.4"></circle><path d="m10.5 10.5 3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"></path></svg><input id="requestSearch" type="search" placeholder="Search name, hex, Pantone, or requester" value="${esc(state.requestQuery || "")}" aria-controls="requestCards requestResultSummary"></label><label class="request-filter-label"><span class="sr-only">Filter requests by status</span><select id="requestStatusFilter" aria-controls="requestCards requestResultSummary">${options}</select></label><button id="newColorRequest" class="primary" type="button">New request</button></div><p id="requestResultSummary" class="request-result-summary" aria-live="polite"></p><div id="requestCards" class="card-grid"></div>`;
  $("#requestSearch").oninput = debounce(() => {
    const input = $("#requestSearch");
    if (!input) return;
    state.requestQuery = input.value;
    paintRequestCards();
  });
  $("#requestStatusFilter").onchange = event => {
    state.requestFilter = event.target.value;
    paintRequestCards();
  };
  document.querySelectorAll("[data-request-filter]").forEach(button => {
    button.onclick = () => {
      state.requestFilter = button.dataset.requestFilter;
      $("#requestStatusFilter").value = state.requestFilter;
      paintRequestCards();
    };
  });
  paintRequestCards();
}

function syncRequestStatState(filter) {
  document.querySelectorAll("[data-request-filter]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.requestFilter === filter));
  });
}

function paintRequestCards() {
  const query = ($("#requestSearch")?.value || "").toLowerCase();
  const filter = $("#requestStatusFilter")?.value || "all";
  const requests = (state.colorRequests || []).filter(request => {
    const haystack = `${request.displayName} ${request.pantone} ${request.hexCode || ""} ${request.note || ""} ${request.requestedBy || ""}`.toLowerCase();
    return (!query || haystack.includes(query)) && (filter === "all" || request.status === filter);
  });
  const total = (state.colorRequests || []).length;
  const resultSummary = $("#requestResultSummary");
  if (resultSummary) resultSummary.textContent = total ? `Showing ${requests.length} of ${total} request${total === 1 ? "" : "s"}` : "No requests yet";
  syncRequestStatState(filter);
  const empty = !total
    ? requestEmptyState("No color requests yet", "Create the first request from a hex color or start from an Explore swatch.", '<button class="primary" type="button" data-empty-new-request>New color request</button>')
    : requestEmptyState("No matching requests", "Adjust the search or status filter to see more results.", '<button class="secondary" type="button" data-clear-request-filters>Clear filters</button>');
  $("#requestCards").innerHTML = requests.length ? requests.map(requestCard).join("") : empty;
  $("[data-clear-request-filters]")?.addEventListener("click", () => {
    state.requestQuery = "";
    state.requestFilter = "all";
    $("#requestSearch").value = "";
    $("#requestStatusFilter").value = "all";
    paintRequestCards();
    $("#requestSearch").focus();
  });
  $("[data-empty-new-request]")?.addEventListener("click", () => openColorRequestForm());
  document.querySelectorAll("[data-open-request]").forEach(card => {
    card.onclick = event => {
      if (event.target.closest("button,a")) return;
      renderColorRequestDetail(card.dataset.openRequest);
    };
    card.onkeydown = event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        renderColorRequestDetail(card.dataset.openRequest);
      }
    };
  });
}

function requestCard(request) {
  const preview = request.sourceType === "UPLOADED"
    ? `/api/color-requests/${encodeURIComponent(request.id)}/source/preview`
    : `/api/color-requests/${encodeURIComponent(request.id)}/swatch`;
  const sourceLabel = request.sourceType === "EXPLORE" ? "Explore swatch" : shownProfile(request.sourceProfile) || (request.sourceType === "GENERATED" ? "Generated swatch" : "Uploaded swatch");
  const identity = [request.hexCode, request.pantone].filter(Boolean).join(" · ");
  const versionLabel = `${request.deliveryCount} reference version${request.deliveryCount === 1 ? "" : "s"}`;
  return `<article class="panel request-card" data-open-request="${esc(request.id)}" tabindex="0" role="link" aria-label="Open ${esc(request.displayName)}, ${esc(requestStatusLabel(request.status))}"><header class="request-card-top"><div><span class="pill ${requestStatusClass(request.status)}">${esc(requestStatusLabel(request.status))}</span><h3>${esc(request.displayName)}</h3><p class="request-card-code"><span class="request-color-dot" style="--request-color:${esc(request.hexCode || "#E9ECEF")}" aria-hidden="true"></span>${esc(identity || "Color details pending")}</p></div><span class="request-card-arrow" aria-hidden="true">→</span></header><p class="request-card-owner">Requested by <strong>${esc(request.requestedBy || "Unknown")}</strong></p><footer class="request-card-source"><img src="${preview}" alt="" loading="lazy" decoding="async" width="64" height="64"><div><span>${esc(sourceLabel)}</span><strong>${esc(versionLabel)}</strong><time datetime="${esc(request.updatedAt)}" title="${esc(date(request.updatedAt))}">Updated ${esc(relativeDate(request.updatedAt))}</time></div></footer></article>`;
}

function requestHex(value) {
  const match = String(value || "").trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return "";
  let hex = match[1].toUpperCase();
  if (hex.length === 3) hex = hex.split("").map(char => char + char).join("");
  return `#${hex}`;
}

function hexMatchUrl(hex) {
  const params = new URLSearchParams({ hex });
  if (state.user.role === "ADMIN") params.set("clientId", state.user.selectedClientId);
  return `/api/color-requests/hex-match?${params}`;
}

function referencePreviewLabel(image) {
  if (image.kind === "QUICK") return "Crop reference";
  if (image.kind === "FULL") return "Full reference";
  return image.label || "Reference";
}

function syncRequestComposer(root = $("#modalBody")) {
  const form = $("#modalForm");
  const submit = $("#modalSubmit");
  const hexInput = root?.querySelector('input[name="hexCode"]');
  const nameInput = root?.querySelector('input[name="name"]');
  if (!form || !submit || !hexInput || !nameInput) return;
  const sourceType = root.querySelector('input[name="sourceType"]:checked')?.value || root.querySelector('input[name="sourceType"]')?.value || "GENERATED";
  const files = [...(root.querySelector("[data-request-files]")?.files || [])];
  const checkState = root.querySelector("[data-hex-match]")?.dataset.checkStatus || "clear";
  const blocked = ["checking", "conflict", "error"].includes(checkState);
  const valid = Boolean(requestHex(hexInput.value) && nameInput.value.trim() && (sourceType !== "UPLOADED" || files.length) && !blocked);
  form.dataset.validationBlocked = String(!valid);
  submit.disabled = !valid;
  const status = root.querySelector("[data-composer-status]");
  if (!status) return;
  const message = !requestHex(hexInput.value)
    ? "Hex code is required."
    : !nameInput.value.trim()
      ? "Color name is required."
      : sourceType === "UPLOADED" && !files.length
        ? "Add an image."
        : "";
  status.hidden = !message;
  status.textContent = message;
}

function renderHexMatch(input, panel, status) {
  panel.dataset.checkStatus = status.kind;
  input.classList.toggle("is-invalid", status.kind === "conflict");
  input.setAttribute("aria-invalid", status.kind === "conflict" ? "true" : "false");
  if (status.kind === "clear") {
    panel.hidden = true;
    panel.className = "hex-match";
    panel.innerHTML = "";
    syncRequestComposer(panel.closest(".modal-body"));
    return;
  }
  panel.hidden = false;
  panel.className = `hex-match is-${status.kind}`;
  if (status.kind === "checking") {
    panel.innerHTML = `<p>Checking ${esc(status.hex)}…</p>`;
    syncRequestComposer(panel.closest(".modal-body"));
    return;
  }
  if (status.kind === "error") {
    panel.innerHTML = `<p>${esc(status.message)}</p>`;
    syncRequestComposer(panel.closest(".modal-body"));
    return;
  }
  if (status.kind === "swatch") {
    panel.innerHTML = `<p role="status">This color already exists in the swatch library as "${esc(status.swatch.name)}".</p>`;
    syncRequestComposer(panel.closest(".modal-body"));
    return;
  }
  const match = status.match;
  const shown = (match.images || []).slice(0, 3);
  const extra = Math.max(0, (match.images || []).length - shown.length);
  const thumbs = shown.map(image => {
    const label = referencePreviewLabel(image);
    return `<img src="/api/previews/${encodeURIComponent(image.id)}" alt="${esc(label)}" title="${esc(label)}" width="64" height="64">`;
  }).join("");
  const preview = thumbs
    ? `<span class="hex-match-images">${thumbs}${extra ? `<span class="hex-match-more">+${extra}</span>` : ""}</span>`
    : `<span class="hex-match-images"><span class="hex-match-placeholder">No image</span></span>`;
  panel.innerHTML = `<button class="hex-match-card" type="button" data-open-library-color="${esc(match.id)}">${preview}<span class="hex-match-copy"><strong>${esc(match.name)}</strong><small>Already in Approved colors</small><span class="hex-match-link">View this color</span></span></button>`;
  syncRequestComposer(panel.closest(".modal-body"));
}

async function openMatchedColor(colorId) {
  const modal = $("#modal");
  if (modal?.open) modal.close();
  if (!state.catalog?.colors?.some(color => color.id === colorId)) {
    await renderLibrary(state.user.role === "ADMIN" ? state.user.selectedClientId : undefined, { keepRoute: true });
  }
  state.view = "library";
  nav(workspaceNav());
  showColorDetail(colorId);
}

function bindHexMatch(root) {
  const input = root.querySelector('input[name="hexCode"]');
  const panel = root.querySelector("[data-hex-match]");
  if (!input || !panel) return;
  let token = 0;
  const lookup = debounce(async () => {
    const hex = requestHex(input.value);
    const current = ++token;
    if (!hex) {
      renderHexMatch(input, panel, { kind: "clear" });
      return;
    }
    renderHexMatch(input, panel, { kind: "checking", hex });
    try {
      const result = await api(hexMatchUrl(hex));
      if (current !== token) return;
      if (result.match) renderHexMatch(input, panel, { kind: "conflict", match: result.match });
      else if (result.swatch) renderHexMatch(input, panel, { kind: "swatch", swatch: result.swatch });
      else renderHexMatch(input, panel, { kind: "clear" });
    } catch (error) {
      if (current !== token) return;
      renderHexMatch(input, panel, { kind: "error", message: error.message || "Could not check this hex code." });
    }
  }, 250);
  input.addEventListener("input", () => {
    const hex = requestHex(input.value);
    renderHexMatch(input, panel, hex ? { kind: "checking", hex } : { kind: "clear" });
    lookup();
  });
  panel.addEventListener("click", event => {
    const link = event.target.closest("[data-open-library-color]");
    if (!link) return;
    openMatchedColor(link.dataset.openLibraryColor);
  });
  if (requestHex(input.value)) lookup();
}

function bindHexPrefix(root) {
  const input = root.querySelector('input[name="hexCode"]');
  if (!input) return;
  const format = () => {
    const start = input.selectionStart ?? input.value.length;
    const digitsBeforeCaret = input.value.slice(0, start).replace(/[^0-9a-f]/gi, "").length;
    const digits = input.value.replace(/[^0-9a-f]/gi, "").slice(0, 6);
    const next = `#${digits}`;
    if (input.value !== next) input.value = next;
    const caret = Math.max(1, Math.min(next.length, digitsBeforeCaret + 1));
    input.setSelectionRange(caret, caret);
  };
  input.addEventListener("input", format);
  input.addEventListener("keydown", event => {
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? 0;
    if ((event.key === "Backspace" || event.key === "Delete") && end <= 1) event.preventDefault();
    if (event.key === "ArrowLeft" && start <= 1 && start === end) event.preventDefault();
  });
  input.addEventListener("pointerup", () => {
    if (input.selectionStart === input.selectionEnd && input.selectionStart < 1) input.setSelectionRange(1, 1);
  });
}

function attachmentSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function bindRequestAttachments(root) {
  const input = root.querySelector("[data-request-files]");
  const panel = root.querySelector(".request-drop-panel");
  const drop = root.querySelector(".request-drop");
  const list = root.querySelector(".request-drop-list");
  const count = root.querySelector("[data-attachment-count]");
  if (!input || !drop || !list) return;
  const files = [];
  const urls = new Map();
  const seen = new Set();
  const fileKey = file => `${file.name}\0${file.size}\0${file.lastModified}`;
  const accept = /\.(jpe?g|png|tiff?|psd|psb)$/i;
  const render = () => {
    const transfer = new DataTransfer();
    files.forEach(file => transfer.items.add(file));
    input.files = transfer.files;
    if (count) count.textContent = `${files.length} / 12`;
    panel?.classList.toggle("has-files", files.length > 0);
    const section = root.querySelector("[data-upload-source]");
    section?.classList.toggle("has-files", files.length > 0);
    section?.classList.toggle("is-full", files.length >= 12);
    const title = drop.querySelector(".request-drop-copy strong");
    const hint = drop.querySelector(".request-drop-hint");
    const remaining = 12 - files.length;
    if (title) title.textContent = files.length ? "Add more" : "Add images";
    if (hint) hint.textContent = !files.length ? "Browse, drop, or paste" : remaining ? `${remaining} remaining` : "Limit reached";
    list.hidden = files.length === 0;
    list.replaceChildren(...files.map((file, index) => {
      const tile = document.createElement("article");
      tile.className = "request-file-tile";
      const thumb = document.createElement("span");
      thumb.className = "request-file-thumb";
      const image = document.createElement("img");
      image.alt = "";
      const previewable = /^(image\/jpeg|image\/png|image\/gif|image\/webp|image\/bmp)$/i.test(file.type) || /\.(jpe?g|png|gif|webp|bmp)$/i.test(file.name);
      if (previewable) {
        if (!urls.has(file)) urls.set(file, URL.createObjectURL(file));
        image.src = urls.get(file);
      } else {
        image.hidden = true;
        thumb.classList.add("is-file");
        thumb.dataset.ext = (file.name.split(".").pop() || "FILE").slice(0, 4).toUpperCase();
      }
      thumb.append(image);
      const copy = document.createElement("span");
      copy.className = "request-file-copy";
      const name = document.createElement("strong");
      name.textContent = file.name;
      name.title = file.name;
      const meta = document.createElement("small");
      meta.textContent = attachmentSize(file.size);
      copy.append(name, meta);
      const remove = document.createElement("button");
      remove.className = "request-file-remove";
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove ${file.name}`);
      remove.textContent = "×";
      remove.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        const removed = files.splice(index, 1)[0];
        if (removed) seen.delete(fileKey(removed));
        if (removed && urls.has(removed)) {
          URL.revokeObjectURL(urls.get(removed));
          urls.delete(removed);
        }
        render();
      };
      tile.append(thumb, copy, remove);
      return tile;
    }));
    syncRequestComposer(root);
  };
  const addFiles = incoming => {
    let skipped = false;
    for (const file of incoming) {
      if (!file || (!accept.test(file.name || "") && !String(file.type || "").startsWith("image/"))) {
        skipped = true;
        continue;
      }
      const named = file.name ? file : new File([file], `pasted-image-${files.length + 1}.png`, { type: file.type || "image/png" });
      const key = fileKey(named);
      if (seen.has(key)) continue;
      if (files.length >= 12) {
        toast("A request can include up to 12 images");
        break;
      }
      seen.add(key);
      files.push(named);
    }
    if (skipped) toast("Only JPG, PNG, TIFF, PSD, and PSB images can be attached");
    render();
  };
  input.addEventListener("change", () => {
    addFiles([...input.files]);
  });
  drop.addEventListener("click", event => {
    if (files.length < 12) return;
    event.preventDefault();
    toast("A request can include up to 12 images");
  });
  const dropTarget = panel || drop;
  dropTarget.addEventListener("dragover", event => {
    event.preventDefault();
    dropTarget.classList.add("is-dragover");
  });
  dropTarget.addEventListener("dragleave", event => {
    if (dropTarget.contains(event.relatedTarget)) return;
    dropTarget.classList.remove("is-dragover");
  });
  dropTarget.addEventListener("drop", event => {
    event.preventDefault();
    dropTarget.classList.remove("is-dragover");
    addFiles([...event.dataTransfer.files]);
  });
  root.addEventListener("paste", event => {
    const clipboard = [...(event.clipboardData?.items || [])];
    const pasted = clipboard.filter(item => item.kind === "file").map(item => item.getAsFile()).filter(Boolean);
    if (!pasted.length) return;
    event.preventDefault();
    addFiles(pasted);
  });
}

async function openColorRequestForm(prefill = {}) {
  const explore = Boolean(prefill.id);
  const initialHex = requestHex(prefill.hexCode) || "#";
  const sourceChooser = explore
    ? `<input type="hidden" name="sourceType" value="EXPLORE"><input type="hidden" name="sourcePixofixColorId" value="${esc(prefill.id)}"><section class="request-source-picked"><span class="request-generated-swatch" style="--request-color:${esc(initialHex)}"></span><div><strong>Explore swatch</strong></div></section>`
    : `<fieldset class="request-source-options"><legend>Swatch</legend><label class="request-source-choice"><input type="radio" name="sourceType" value="GENERATED" checked><span class="request-source-icon" aria-hidden="true">#</span><span><strong>Generate from hex</strong></span></label><label class="request-source-choice"><input type="radio" name="sourceType" value="UPLOADED"><span class="request-source-icon" aria-hidden="true">↑</span><span><strong>Upload images</strong></span></label></fieldset>`;
  openModal({
    eyebrow: explore ? "EXPLORE SWATCH" : "NEW REQUEST",
    title: "Request a color",
    submit: "Submit request",
    body: `<div class="request-composer">${sourceChooser}<div class="request-create-layout"><section class="request-create-fields"><p class="request-section-label">Color details</p><label><span>Hex code <abbr class="required-mark" title="Required">*</abbr> <span class="muted">Adobe RGB (1998)</span></span><input name="hexCode" value="${esc(initialHex)}" required maxlength="32" autocomplete="off" aria-required="true" aria-describedby="hexMatch" spellcheck="false" ${explore ? "readonly" : ""}></label><div id="hexMatch" class="hex-match" data-hex-match hidden></div><label><span>Color name <abbr class="required-mark" title="Required">*</abbr></span><input name="name" value="${esc(prefill.name || "")}" required maxlength="200"></label><label><span>Pantone <span class="optional-label">Optional</span></span><input name="pantone" maxlength="120"></label><label><span>Request note <span class="optional-label">Optional</span></span><textarea name="note" maxlength="5000"></textarea></label><p class="request-composer-status" data-composer-status role="status" hidden></p></section><aside class="request-visual" aria-label="Swatch"><div class="request-generated-preview" data-generated-preview><span>Preview</span><div id="requestGeneratedSwatch" class="request-generated-swatch" style="--request-color:${esc(initialHex.length === 7 ? initialHex : "#E9ECEF")}"></div><strong id="requestGeneratedHex">${esc(initialHex.length === 7 ? initialHex : "")}</strong><small>Adobe RGB (1998)</small></div><button class="request-explore-link" type="button" data-open-explore>Explore swatches</button><section class="request-attachments" data-upload-source hidden><div class="request-attachments-head"><span class="request-attachments-label">Images <abbr class="required-mark" title="Required">*</abbr></span><span class="request-attachments-count" data-attachment-count aria-live="polite">0 / 12</span></div><div class="request-drop-panel"><label class="request-drop"><input data-request-files name="files" type="file" accept=".jpg,.jpeg,.png,.tif,.tiff,.psd,.psb,image/*" multiple><span class="request-drop-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 16V7"/><path d="M8.2 10.2 12 6.4l3.8 3.8"/><path d="M5.5 16.2v1.1A1.7 1.7 0 0 0 7.2 19h9.6a1.7 1.7 0 0 0 1.7-1.7v-1.1"/></svg></span><span class="request-drop-copy"><strong>Add images</strong><small class="request-drop-hint">Browse, drop, or paste</small><small class="request-drop-dragging" aria-hidden="true">Drop to attach</small></span><span class="request-drop-types" aria-hidden="true"><span>JPG</span><span>PNG</span><span>TIFF</span><span>PSD</span><span>PSB</span></span></label><div class="request-drop-list" hidden></div></div></section></aside></div></div>`,
    onSubmit: async form => {
      const hexCode = requestHex(form.get("hexCode"));
      if (!hexCode) throw new Error("A hex code is required, such as #E76223");
      const existing = await api(hexMatchUrl(hexCode));
      if (existing.match) {
        const input = $("#modalBody input[name='hexCode']");
        const panel = $("#hexMatch");
        if (input && panel) renderHexMatch(input, panel, { kind: "conflict", match: existing.match });
        throw new Error(`Hex code ${existing.match.hexCode} already exists in Approved colors on ${existing.match.name}.`);
      }
      form.set("hexCode", hexCode);
      const sourceType = String(form.get("sourceType") || "GENERATED");
      const files = form.getAll("files").filter(file => file && file.size);
      if (sourceType === "UPLOADED" && !files.length) throw new Error("Add at least one swatch image");
      if (sourceType !== "UPLOADED") form.delete("files");
      if (state.user.role === "ADMIN") form.set("clientId", state.user.selectedClientId);
      const result = await api("/api/color-requests", { method: "POST", body: form });
      toast("Color request submitted");
      state.requestId = result.request.id;
      state.view = "request";
      await renderColorRequestDetail(result.request.id);
    }
  });
  const root = $("#modalBody");
  root.querySelector("[data-open-explore]")?.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    $("#modal").close();
    state.view = "pixofix";
    state.pixofixColorId = null;
    state.requestId = null;
    render();
  });
  bindRequestAttachments(root);
  bindHexPrefix(root);
  bindHexMatch(root);
  const hexInput = root.querySelector('input[name="hexCode"]');
  const nameInput = root.querySelector('input[name="name"]');
  const uploadSection = root.querySelector("[data-upload-source]");
  const exploreLink = root.querySelector("[data-open-explore]");
  const fileInput = root.querySelector("[data-request-files]");
  nameInput.maxLength = 120;
  let nameWasEdited = Boolean(prefill.name);
  let nameLookup = 0;
  nameInput.addEventListener("input", () => { nameWasEdited = true; syncRequestComposer(root); });
  const syncSource = () => {
    const type = root.querySelector('input[name="sourceType"]:checked')?.value || root.querySelector('input[name="sourceType"]')?.value || "GENERATED";
    const uploaded = type === "UPLOADED";
    if (uploadSection) uploadSection.hidden = !uploaded;
    if (exploreLink) exploreLink.hidden = uploaded || explore;
    if (fileInput) fileInput.required = uploaded;
    syncRequestComposer(root);
  };
  root.querySelectorAll('input[name="sourceType"]').forEach(input => input.addEventListener("change", syncSource));
  const updatePreview = debounce(async () => {
    const hex = requestHex(hexInput.value);
    const swatch = $("#requestGeneratedSwatch");
    const label = $("#requestGeneratedHex");
    if (swatch) swatch.style.setProperty("--request-color", hex || "#E9ECEF");
    if (label) label.textContent = hex || "";
    if (!hex || nameWasEdited || explore) return;
    const current = ++nameLookup;
    try {
      const suggestion = await api(`/api/pixofix/color-name?hexCode=${encodeURIComponent(hex)}`);
      if (current === nameLookup && !nameWasEdited) {
        nameInput.value = suggestion.name;
        syncRequestComposer(root);
      }
    } catch (_error) {}
  }, 180);
  hexInput.addEventListener("input", updatePreview);
  syncSource();
  updatePreview();
  syncRequestComposer(root);
}

function requestBackButton() {
  return '<button id="backToRequests" class="secondary request-back" type="button">← All requests</button>';
}

function showRequestDetail(content) {
  useFullPage();
  restoreNotificationCenter();
  $("#content").innerHTML = content;
  const back = $("#backToRequests");
  if (back) back.onclick = () => { state.view = "requests"; renderColorRequests(); };
}

async function renderColorRequestDetail(requestId) {
  state.view = "request";
  state.requestId = requestId;
  syncAppRoute();
  nav(workspaceNav());
  showRequestDetail(`<section class="request-status-page">${requestBackButton()}${requestStatusMessage("Loading request", "Fetching the swatch and delivery history.")}</section>`);
  $("#content").setAttribute("aria-busy", "true");
  try {
    const request = (await api(`/api/color-requests/${encodeURIComponent(requestId)}`)).request;
    drawColorRequestDetail(request);
  } catch (error) {
    showRequestDetail(`<section class="request-status-page">${requestBackButton()}${requestStatusMessage("Could not open this request", error.message, '<button id="retryRequest" class="secondary" type="button">Try again</button>')}</section>`);
    $("#retryRequest").onclick = () => renderColorRequestDetail(requestId);
  } finally {
    $("#content").removeAttribute("aria-busy");
  }
}

function deliveryCategoryName(delivery) {
  const kind = delivery?.referenceKind || "FULL";
  if (kind === "QUICK") return "Crop reference";
  if (kind === "OTHER") return delivery.referenceLabel || "Reference";
  return "Full reference";
}

function deliveryCategoryKey(delivery) {
  return `${delivery?.referenceKind || "FULL"}:${delivery?.referenceLabel || ""}`;
}

function latestReferenceFiles(files) {
  return [...files].sort((a, b) => {
    const byNumber = (b.delivery?.number || 0) - (a.delivery?.number || 0);
    if (byNumber) return byNumber;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });
}

function referenceTypeGroups(files) {
  const groups = new Map();
  for (const file of files) {
    const key = deliveryCategoryKey(file.delivery);
    if (!groups.has(key)) groups.set(key, { key, title: deliveryCategoryName(file.delivery), files: [] });
    groups.get(key).files.push(file);
  }
  return [...groups.values()]
    .map(group => ({ ...group, files: latestReferenceFiles(group.files) }))
    .sort((a, b) => new Date(b.files[0]?.createdAt || 0) - new Date(a.files[0]?.createdAt || 0));
}

function referenceGroupIsOpen(group, selectedKey) {
  const memory = state.requestReferenceOpen;
  if (memory && memory.requestId === state.activeColorRequest?.id) return memory.keys.has(group.key);
  const latestKey = group.files[0]?.key;
  return group.files.some(file => file.key === selectedKey && file.key !== latestKey);
}

function referenceVersionTree(group, groups, selectedKey) {
  const selected = group.files.some(file => file.key === selectedKey);
  const latest = group.files[0];
  const earlier = group.files.slice(1);
  const open = earlier.length > 0 && referenceGroupIsOpen(group, selectedKey);
  const panelId = `referenceVersions${groups.indexOf(group)}`;
  const labelId = `referenceType${groups.indexOf(group)}`;
  const chevron = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 6.5 8 10l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const heading = `<strong id="${labelId}">${esc(group.title)}</strong>`;
  const history = earlier.length
    ? `<button class="reference-tree-toggle" type="button" aria-expanded="${open ? "true" : "false"}" aria-controls="${panelId}" aria-label="Versions">${heading}<span class="reference-tree-more"><span class="reference-tree-count">${earlier.length}</span>${chevron}</span></button>`
    : heading;
  const panel = earlier.length
    ? `<div id="${panelId}" class="reference-tree-panel" role="region" aria-label="Versions"${open ? "" : " hidden"}><div class="reference-tree-clip"><div class="reference-tree-branch">${earlier.map(file => requestFileRow(file, selectedKey)).join("")}</div></div></div>`
    : "";
  return `<section class="reference-version-tree${open ? " is-open" : ""}${selected ? " has-selection" : ""}" data-reference-type="${esc(group.key)}" aria-labelledby="${labelId}"><header class="reference-tree-label">${history}</header><div class="reference-tree-latest">${requestFileRow(latest, selectedKey)}</div>${panel}</section>`;
}

function deliverySections(files, selectedKey) {
  const head = `<div class="request-section-head"><h3>References${files.length ? ` <span class="request-section-count">${files.length}</span>` : ""}</h3></div>`;
  if (!files.length) return `<section class="request-rail-section request-versions">${head}<p class="request-files-empty">No versions yet</p></section>`;
  const groups = referenceTypeGroups(files);
  const trees = groups.map(group => referenceVersionTree(group, groups, selectedKey)).join("");
  return `<section class="request-rail-section request-versions">${head}<div class="request-reference-groups">${trees}</div></section>`;
}

function generatedSwatchSource(source) {
  return /-swatch\.png$/i.test(source?.originalFilename || "");
}

function requestFiles(request) {
  const files = [];
  const sources = request.sources?.length ? request.sources : (request.source ? [request.source] : []);
  const uploads = sources.filter(source => !generatedSwatchSource(source));
  let uploadIndex = 0;
  sources.forEach(source => {
    const generated = generatedSwatchSource(source);
    if (!generated) uploadIndex += 1;
    files.push({
      key: source.id || "source",
      group: "Swatch",
      kind: generated ? "Generated swatch" : (uploads.length > 1 ? `Swatch ${uploadIndex}` : "Swatch"),
      title: generated ? "Generated swatch" : (uploads.length > 1 ? `Swatch ${uploadIndex}` : "Swatch"),
      status: generated ? "Adobe RGB (1998)" : (shownProfile(source.profileLabel) || "Attached"),
      statusClass: "pending",
      filename: source.originalFilename,
      profile: source.profileLabel || "",
      sizeBytes: source.sizeBytes,
      uploadedBy: source.uploadedBy || request.requestedBy || "",
      note: request.note || "",
      createdAt: source.createdAt,
      preview: `/api/color-requests/${encodeURIComponent(request.id)}/sources/${encodeURIComponent(source.id)}/preview`,
      display: `/api/color-requests/${encodeURIComponent(request.id)}/sources/${encodeURIComponent(source.id)}/display`,
      download: `/api/color-requests/${encodeURIComponent(request.id)}/sources/${encodeURIComponent(source.id)}`,
      comments: (request.comments || []).filter(comment => commentOnFile(comment, { key: source.id || "source" }))
    });
  });
  if (request.hexCode && !sources.some(generatedSwatchSource)) {
    const swatchUrl = `/api/color-requests/${encodeURIComponent(request.id)}/swatch`;
    files.push({
      key: "generated-swatch",
      group: "Swatch",
      kind: request.sourceType === "EXPLORE" ? "Explore swatch" : "Generated swatch",
      title: "Color swatch",
      status: "Adobe RGB (1998)",
      statusClass: "pending",
      filename: `${request.hexCode.slice(1)}-swatch.png`,
      profile: "Adobe RGB (1998)",
      sizeBytes: 0,
      uploadedBy: request.requestedBy || "",
      note: request.note || "",
      createdAt: request.createdAt,
      preview: swatchUrl,
      display: swatchUrl,
      download: `${swatchUrl}?download=1`,
      comments: (request.comments || []).filter(comment => commentOnFile(comment, { key: "generated-swatch" }))
    });
  }
  for (const delivery of request.deliveries) {
    files.push({
      key: delivery.id,
      group: "Deliveries",
      kind: `${deliveryCategoryName(delivery)} · Version ${delivery.number}`,
      title: `Version ${delivery.number}`,
      status: requestStatusLabel(delivery.status),
      statusClass: requestStatusClass(delivery.status),
      filename: delivery.originalFilename,
      profile: delivery.profileLabel,
      sizeBytes: delivery.sizeBytes,
      uploadedBy: delivery.uploadedBy || "",
      note: delivery.uploadNote || "",
      createdAt: delivery.createdAt,
      preview: `/api/color-requests/${encodeURIComponent(request.id)}/deliveries/${encodeURIComponent(delivery.id)}/preview`,
      display: `/api/color-requests/${encodeURIComponent(request.id)}/deliveries/${encodeURIComponent(delivery.id)}/display`,
      download: `/api/color-requests/${encodeURIComponent(request.id)}/deliveries/${encodeURIComponent(delivery.id)}`,
      comments: (request.comments || []).filter(comment => commentOnFile(comment, { key: delivery.id, delivery: true })),
      delivery
    });
  }
  return files;
}

function defaultRequestFile(files) {
  return files.find(file => file.delivery?.status === "IN_REVIEW")
    || files.find(file => file.delivery)
    || files[0]
    || null;
}

function requestPreviewMarkup(file, name) {
  if (!file) {
    return `<div id="colorPreviewLink" class="color-preview-link is-empty"><div id="colorPreviewViewport" class="color-preview-viewport"><div class="detail-placeholder"><strong>${esc(name)}</strong><small>No file to preview yet</small></div></div></div>`;
  }
  const display = file.display || file.preview;
  return `<div id="colorPreviewLink" class="color-preview-link has-preview-tools" data-full-src="${esc(display)}"><div id="colorPreviewViewport" class="color-preview-viewport"><p id="previewLoading" class="preview-loading" role="status">Loading full image…</p><img id="colorPreviewImage" src="${esc(display)}" alt="${esc(name)} ${esc(file.filename)}" decoding="async" draggable="false"><div id="previewPins" class="preview-pins" hidden></div></div><div class="preview-zoom" role="group" aria-label="Zoom"><button id="previewZoomOut" type="button" aria-label="Zoom out" disabled>−</button><output id="previewZoomLevel" for="previewZoomOut previewZoomIn">100%</output><button id="previewZoomIn" type="button" aria-label="Zoom in" disabled>+</button></div><div id="previewNavigator" class="preview-navigator" hidden><img id="previewNavigatorImage" alt="" src="${esc(file.preview)}" draggable="false"><div id="previewNavigatorFrame" class="preview-navigator-frame" tabindex="0" aria-label="Drag to move the zoomed area"></div></div>${previewActionBar(esc(display), true, true)}</div>`;
}

function compareChipLabel(file) {
  const version = String(file.title || "").match(/Version\s+(\d+)/i);
  if (version) return `V${version[1]}`;
  if (/^(generated|color|explore)\b/i.test(file.title || "")) return "Swatch";
  return file.title || file.kind || "File";
}

function requestTime(value) {
  return value ? `<time datetime="${esc(value)}" title="${esc(date(value))}">${esc(relativeDate(value))}</time>` : "";
}

function requestInitial(name) {
  return String(name || "?").trim().slice(0, 1).toUpperCase() || "?";
}

function requestFileRow(file, selectedKey, layout = "row") {
  const selected = file.key === selectedKey;
  const attributes = `type="button" data-request-file="${esc(file.key)}" data-preview="${esc(file.preview)}" data-display="${esc(file.display || file.preview)}" data-download="${esc(file.download)}" data-kind="${esc(file.kind)}" data-file="${esc(file.filename)}" data-status="${esc(file.status)}" data-status-class="${esc(file.statusClass)}" data-profile="${esc(file.profile)}" data-note="${esc(file.note)}" data-compare-short="${esc(compareChipLabel(file))}" data-compare-label="${esc(file.kind)}" data-compare-group="${esc(file.group === "Deliveries" ? "Versions" : file.group)}" aria-pressed="${selected ? "true" : "false"}"`;
  if (layout === "tile") {
    const caption = /^(Generated|Explore) swatch$/.test(file.kind) ? file.status : file.filename;
    return `<button class="request-version is-tile ${selected ? "is-selected" : ""}" ${attributes} title="${esc(file.filename)}"><img src="${file.preview}" alt="" loading="lazy" decoding="async" width="96" height="96"><span class="request-version-copy"><strong>${esc(file.title)}</strong><small>${esc(caption)}</small></span></button>`;
  }
  return `<button class="request-version ${selected ? "is-selected" : ""}" ${attributes}><img src="${file.preview}" alt="" loading="lazy" decoding="async" width="56" height="56"><span class="request-version-copy"><span class="request-version-title"><strong>${esc(file.title)}</strong>${requestTime(file.createdAt)}</span><small>${esc(file.filename)}</small></span><span class="pill ${file.statusClass}">${esc(file.status)}</span></button>`;
}

function requestSwatchSection(files, selectedKey) {
  if (!files.length) return "";
  return `<section class="request-rail-section request-version-group"><div class="request-section-head"><h3>Swatch <span class="request-section-count">${files.length}</span></h3></div><div class="request-swatch-grid">${files.map(file => requestFileRow(file, selectedKey, "tile")).join("")}</div></section>`;
}

function requestPendingDeliveries(request) {
  return (request?.deliveries || []).filter(delivery => delivery.status === "IN_REVIEW");
}

function requestReviewActions(file, request) {
  if (!file?.delivery || file.delivery.status !== "IN_REVIEW") return "";
  if (state.user.role === "CLIENT") {
    const approveLabel = requestPendingDeliveries(request).length > 1 ? "Approve all" : "Approve";
    return `<button class="primary" type="button" data-approve-request>${approveLabel}</button><button class="secondary" type="button" data-change-request>Request changes</button>`;
  }
  if (state.user.role === "ADMIN") return `<button class="secondary" type="button" data-withdraw-delivery="${esc(file.key)}">Withdraw</button>`;
  return "";
}

function requestStepActions(request, file) {
  const review = requestReviewActions(file, request);
  if (review) return review;
  const pending = requestPendingDeliveries(request);
  if (!pending.length || !["ADMIN", "CLIENT"].includes(state.user.role)) return "";
  const target = pending[0];
  return `<button class="secondary" type="button" data-jump-request-file="${esc(target.id)}">View version ${esc(target.number)}</button>`;
}

function latestChangeFeedback(request) {
  const event = [...(request.activity || [])].reverse().find(item => item.type === "CHANGES_REQUESTED");
  return String(event?.metadata?.comment || "").trim();
}

function requestNextStep(request) {
  const role = state.user.role;
  const admin = role === "ADMIN";
  const pending = requestPendingDeliveries(request);
  const pendingDetail = pending.length === 1
    ? `${deliveryCategoryName(pending[0])} · Version ${pending[0].number}`
    : pending.length ? `${pending.length} versions` : "";
  if (request.status === "APPROVED") return { tone: "done", title: "Approved", detail: "In Approved colors" };
  if (request.status === "AWAITING_DELIVERY") return { tone: admin ? "action" : "waiting", title: admin ? "Upload the first version" : "Awaiting first version", detail: "" };
  if (request.status === "CHANGES_REQUESTED") return { tone: admin ? "action" : "waiting", title: admin ? "Changes requested" : "Awaiting a new version", detail: "", quote: latestChangeFeedback(request) };
  if (request.status === "IN_PROGRESS" && pending.length) {
    const client = role === "CLIENT";
    return { tone: client ? "action" : "waiting", title: client ? "Ready for your review" : "Waiting for client review", detail: pendingDetail };
  }
  return { tone: "waiting", title: requestStatusLabel(request.status), detail: pendingDetail };
}

function requestNextStepMarkup(request, selected, canDeliver) {
  const step = requestNextStep(request);
  const primaryUpload = ["AWAITING_DELIVERY", "CHANGES_REQUESTED"].includes(request.status);
  const upload = canDeliver ? `<button id="uploadDelivery" class="${primaryUpload ? "primary" : "secondary"}" type="button">Upload version</button>` : "";
  const quote = step.quote ? `<blockquote class="request-next-quote">${esc(step.quote)}</blockquote>` : "";
  return `<section class="request-next" data-tone="${step.tone}" aria-label="Status"><div class="request-next-copy"><span class="request-next-icon" aria-hidden="true"></span><strong>${esc(step.title)}</strong>${step.detail ? `<small>${esc(step.detail)}</small>` : ""}</div>${quote}<div class="request-next-actions"><span id="requestReviewActions" class="request-review-actions">${requestStepActions(request, selected)}</span>${upload}</div></section>`;
}

function requestCodeChip(label, value) {
  const copyIcon = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 3.2A1.6 1.6 0 0 0 9 2.5H4.1a1.6 1.6 0 0 0-1.6 1.6V9a1.6 1.6 0 0 0 .7 1.3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
  return `<button class="request-code" type="button" data-copy-value="${esc(value)}" aria-label="Copy ${esc(label)} ${esc(value)}" title="Copy">${label === "hex code" ? "" : `<small>${esc(label)}</small>`}<span>${esc(value)}</span>${copyIcon}</button>`;
}

function requestHeadingMarkup(request) {
  const hex = requestHex(request.hexCode);
  const swatch = hex ? `<span class="request-heading-swatch" style="--request-color:${esc(hex)}" aria-hidden="true"></span>` : "";
  const codes = [hex && requestCodeChip("hex code", hex), request.pantone && requestCodeChip("Pantone", request.pantone)].filter(Boolean).join("");
  return `<header class="request-heading ${hex ? "" : "no-swatch"}">${swatch}<div class="request-heading-copy"><p class="eyebrow">COLOR REQUEST</p><div class="request-title"><h2>${esc(request.displayName)}</h2><span id="requestPreviewStatus" class="pill ${requestStatusClass(request.status)}">${esc(requestStatusLabel(request.status))}</span></div>${codes ? `<div class="request-codes">${codes}</div>` : ""}</div></header>`;
}

function requestRailTopMarkup(request) {
  const hex = requestHex(request.hexCode);
  return `<div class="request-rail-top"><button id="backToRequests" class="request-back request-back-link" type="button"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.8 3.5 5.3 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>All requests</span></button><div class="request-rail-top-title" aria-hidden="true">${hex ? `<span class="request-color-dot" style="--request-color:${esc(hex)}"></span>` : ""}<strong>${esc(request.displayName)}</strong></div><div class="request-activity-control"><button id="showRequestActivity" type="button" aria-expanded="false" aria-controls="requestActivityPanel" aria-label="Show activity"><img src="/icons/show-activity.png" alt="" width="22" height="22"><span class="request-activity-tip" aria-hidden="true">Show activity</span></button>${requestActivityPanelMarkup(request)}</div></div>`;
}

function commentTarget(file) {
  if (!file) return "Request";
  return file.delivery ? file.kind : "Request";
}

function requestCommentsMarkup(selected) {
  const target = commentTarget(selected);
  return `<section class="request-rail-section request-comments"><div class="request-section-head"><h3>Comments</h3><span id="commentTargetLabel" class="request-comment-target">${esc(target)}</span></div><div id="requestThread">${requestThread(selected)}</div><form id="commentForm" class="request-comment-form"><div class="request-comment-box"><label class="request-comment-field"><span id="commentFieldLabel" class="sr-only">Comment on ${esc(target)}</span><textarea name="body" rows="2" maxlength="5000" required placeholder="Add a comment" aria-keyshortcuts="Control+Enter"></textarea></label><button class="primary" type="submit" disabled>Post comment</button></div><input id="commentDeliveryId" name="deliveryId" type="hidden" value="${selected?.delivery ? esc(selected.key) : ""}"><p id="commentError" class="form-error" role="alert" hidden></p></form></section>`;
}

function requestStageMarkup(selected, request) {
  const status = selected ? `<span id="requestPreviewFileStatus" class="pill ${selected.statusClass}">${esc(selected.status)}</span>` : "";
  const download = selected ? `<a id="requestDownload" class="preview-caption-download" href="${selected.download}" target="_blank" rel="noopener" title="Download"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.5v8m-3-3 3 3 3-3M4.5 15.5h11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg><span>Download</span></a>` : "";
  return `<section class="color-page-preview request-stage">${requestPreviewMarkup(selected, request.displayName)}<div class="preview-caption"><div><span id="requestPreviewKind">${esc(selected?.kind || "No preview")}</span><strong id="requestPreviewFilename">${esc(selected?.filename || "No file available")}</strong></div><div class="preview-caption-actions">${status}${download}</div></div></section>`;
}

function commentHasPin(comment) {
  return Number.isFinite(Number(comment?.pinX)) && Number.isFinite(Number(comment?.pinY));
}

function commentOnFile(comment, file) {
  if (!file) return false;
  if (commentHasPin(comment)) {
    if (file.delivery) return comment.deliveryId === file.key;
    if (file.key === "generated-swatch") return !comment.deliveryId && !comment.sourceId;
    return comment.sourceId === file.key;
  }
  if (file.delivery) return comment.deliveryId === file.key;
  return !comment.deliveryId && !comment.sourceId;
}

function commentAnchor(file) {
  if (file?.delivery) return { deliveryId: file.key };
  if (file?.key && file.key !== "generated-swatch") return { sourceId: file.key };
  return {};
}

function currentRequestFile() {
  const request = state.activeColorRequest;
  if (!request) return null;
  return requestFiles(request).find(file => file.key === state.requestSelection?.key) || null;
}

function requestThread(file) {
  if (!file) return '<p class="request-thread-empty">No comments yet</p>';
  const note = file.delivery && file.note ? `<article class="request-message is-note"><div><strong>Version note</strong><p>${esc(file.note)}</p></div></article>` : "";
  const comments = file.comments.map(comment => {
    const placed = commentHasPin(comment) ? `<span class="request-pin-label">On image</span>` : "";
    return `<article class="request-message${placed ? " is-placed" : ""}" data-comment-id="${esc(comment.id)}" tabindex="0"><span class="request-avatar" data-party="${esc(commentParty(comment))}" aria-hidden="true">${esc(requestInitial(comment.authorName))}</span><div><p class="request-message-meta"><strong>${esc(comment.authorName)}</strong>${requestTime(comment.createdAt)}</p>${placed}<p>${esc(comment.body)}</p></div></article>`;
  }).join("");
  return `${note}${comments || '<p class="request-thread-empty">No comments yet</p>'}`;
}

function requestByteSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let amount = size;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || amount >= 10 ? 0 : 1;
  return `${amount.toFixed(digits)} ${units[unit]}`;
}

function requestSourceLabel(request) {
  if (request?.sourceType === "EXPLORE") return "Explore";
  if (request?.sourceType === "GENERATED") return "Generated";
  return "Uploaded";
}

function requestInfoRows(rows) {
  const items = rows.filter(row => String(row.value || "").trim());
  if (!items.length) return "";
  return `<dl class="request-info-list">${items.map(row => `<div><dt>${esc(row.label)}</dt><dd>${esc(row.value)}</dd></div>`).join("")}</dl>`;
}

function requestActivityInfoMarkup(request, file) {
  const note = String(request?.note || "").trim();
  const brief = `<div class="request-info-brief ${note ? "" : "is-empty"}"><p>${esc(note || "No brief added")}</p><p class="request-info-by"><span class="request-avatar" data-party="${esc(requestCreatorParty(request))}" aria-hidden="true">${esc(requestInitial(request?.requestedBy))}</span><span class="request-info-who"><strong>${esc(request?.requestedBy || "Unknown")}</strong>${requestTime(request?.createdAt)}</span></p></div>`;
  const requestRows = requestInfoRows([
    { label: "Status", value: requestStatusLabel(request?.status) },
    { label: "Name", value: request?.displayName },
    { label: "Hex", value: requestHex(request?.hexCode) },
    { label: "Pantone", value: request?.pantone },
    { label: "Source", value: requestSourceLabel(request) },
    { label: "Requested by", value: request?.requestedBy },
    { label: "Created", value: request?.createdAt ? date(request.createdAt) : "" },
    { label: "Updated", value: request?.updatedAt ? date(request.updatedAt) : "" }
  ]);
  const imageRows = file ? requestInfoRows([
    { label: "Type", value: file.kind },
    { label: "File", value: file.filename },
    { label: "Status", value: file.status && file.status !== file.profile ? file.status : "" },
    { label: "Profile", value: file.profile },
    { label: "Size", value: requestByteSize(file.sizeBytes) },
    { label: "Added", value: file.createdAt ? date(file.createdAt) : "" },
    { label: "Added by", value: file.uploadedBy },
    { label: "Note", value: file.delivery ? file.note : "" }
  ]) : '<p class="request-thread-empty">No image selected</p>';
  return `${brief}<div class="request-info-groups"><section><h5>Request</h5>${requestRows}</section><section><h5>Image</h5>${imageRows}</section></div>`;
}

function requestActivityLabel(type) {
  return ({
    REQUEST_CREATED: "created this request",
    REFERENCE_UPLOADED: "uploaded a reference version",
    REFERENCE_WITHDRAWN: "withdrew a reference version",
    CHANGES_REQUESTED: "requested changes",
    REQUEST_APPROVED: "approved the color",
    COMMENT_ADDED: "added a comment"
  })[type] || "updated this request";
}

function activityParty(role) {
  if (role === "ADMIN") return "admin";
  if (role === "CLIENT") return "client";
  return "unknown";
}

function commentParty(comment) {
  if (comment?.authorRole) return activityParty(comment.authorRole);
  const event = (state.activeColorRequest?.activity || []).find(item => item.type === "COMMENT_ADDED" && String(item.subjectId) === String(comment?.id));
  return activityParty(event?.actor?.role);
}

function requestCreatorParty(request) {
  const created = (request?.activity || []).find(event => event.type === "REQUEST_CREATED");
  return activityParty(created?.actor?.role);
}

function requestActivityKind(type) {
  return ({
    REQUEST_CREATED: "created",
    REFERENCE_UPLOADED: "upload",
    REFERENCE_WITHDRAWN: "withdrawn",
    CHANGES_REQUESTED: "changes",
    REQUEST_APPROVED: "approved",
    COMMENT_ADDED: "comment"
  })[type] || "update";
}

function activityHasPin(meta) {
  return meta?.pinX != null && meta?.pinY != null && Number.isFinite(Number(meta.pinX)) && Number.isFinite(Number(meta.pinY));
}

function requestActivityDetail(event) {
  const meta = event?.metadata || {};
  if (event?.type === "REFERENCE_UPLOADED") {
    const version = meta.version ? `Version ${meta.version}` : "";
    return [meta.referenceLabel, version, meta.filename].filter(Boolean).join(" · ");
  }
  if (event?.type === "CHANGES_REQUESTED") return meta.comment || "";
  if (event?.type === "COMMENT_ADDED") return meta.body || meta.comment || "";
  if (event?.type === "REFERENCE_WITHDRAWN") return meta.filename || "";
  return "";
}

function requestActivityContext(event, files) {
  if (event?.type !== "COMMENT_ADDED") return "";
  const meta = event.metadata || {};
  const id = meta.deliveryId || meta.sourceId || "";
  const file = id ? files.find(item => item.key === id) : null;
  const where = file ? (file.delivery ? file.kind : file.title) : (id ? "" : "Request");
  return [where, activityHasPin(meta) ? "On image" : ""].filter(Boolean).join(" · ");
}

function requestActivityMarkup(activity = [], request) {
  const events = [...activity].reverse();
  if (!events.length) return '<p class="request-thread-empty">No history yet</p>';
  const files = request ? requestFiles(request) : [];
  return events.map(event => {
    const actor = event.actor?.name || event.metadata?.actorName || "Former user";
    const detail = requestActivityDetail(event);
    const context = requestActivityContext(event, files);
    const quoted = ["COMMENT_ADDED", "CHANGES_REQUESTED"].includes(event.type) && detail;
    const contextMarkup = context ? `<p class="request-activity-context">${esc(context)}</p>` : "";
    const body = quoted
      ? `<blockquote>${esc(detail)}</blockquote>`
      : (detail ? `<p class="request-activity-detail">${esc(detail)}</p>` : "");
    return `<article class="request-activity-item" data-kind="${esc(requestActivityKind(event.type))}" data-party="${esc(activityParty(event.actor?.role))}"><span class="request-avatar" data-party="${esc(activityParty(event.actor?.role))}" aria-hidden="true">${esc(requestInitial(actor))}</span><div><p class="request-activity-line"><strong>${esc(actor)}</strong> <span class="request-activity-verb">${esc(requestActivityLabel(event.type))}</span></p>${contextMarkup}${body}<time datetime="${esc(event.createdAt || "")}">${esc(date(event.createdAt))}</time></div></article>`;
  }).join("");
}

function requestActivityPanelMarkup(request) {
  const file = currentRequestFile() || defaultRequestFile(requestFiles(request));
  return `<div id="requestActivityPanel" class="request-activity-panel" role="dialog" aria-labelledby="requestActivityTitle" tabindex="-1" hidden><header><h3 id="requestActivityTitle">Activity</h3><button type="button" data-close-activity aria-label="Close">×</button></header><div class="request-activity-body"><section class="request-activity-section" aria-labelledby="requestActivityInfoTitle"><h4 id="requestActivityInfoTitle">Information</h4><div id="requestActivityInfo">${requestActivityInfoMarkup(request, file)}</div><div class="request-activity-head"><h4 id="requestActivityHistoryTitle" class="request-activity-subhead">History</h4><p class="request-activity-legend"><span data-party="admin">Pixofix</span><span data-party="client">Client</span></p></div><div class="request-activity-list">${requestActivityMarkup(request?.activity, request)}</div></section></div></div>`;
}

function placeRequestActivityPanel() {
  const button = $("#showRequestActivity");
  const panel = $("#requestActivityPanel");
  if (!button || !panel || panel.hidden) return;
  const rect = button.getBoundingClientRect();
  const width = Math.min(420, window.innerWidth - 24);
  const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
  const top = Math.max(12, rect.bottom + 8);
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.width = `${width}px`;
  panel.style.maxHeight = `${Math.max(220, Math.min(680, window.innerHeight - top - 12))}px`;
}

function bindRequestReview(request) {
  document.querySelectorAll("[data-approve-request]").forEach(button => { button.onclick = () => decideRequest(request, "approve"); });
  document.querySelectorAll("[data-change-request]").forEach(button => { button.onclick = () => decideRequest(request, "changes"); });
  document.querySelectorAll("[data-withdraw-delivery]").forEach(button => {
    button.onclick = () => withdrawDelivery(request, button.dataset.withdrawDelivery);
  });
  document.querySelectorAll("[data-jump-request-file]").forEach(button => {
    button.onclick = () => {
      const row = document.querySelector(`[data-request-file="${CSS.escape(button.dataset.jumpRequestFile)}"]`);
      if (!row) return;
      selectRequestFile(row);
      row.scrollIntoView({ block: "nearest", behavior: "smooth" });
      row.focus({ preventScroll: true });
    };
  });
}

async function copyRequestValue(button) {
  const value = button.dataset.copyValue;
  try {
    await navigator.clipboard.writeText(value);
    button.classList.add("is-copied");
    clearTimeout(button.copyTimer);
    button.copyTimer = setTimeout(() => button.classList.remove("is-copied"), 1400);
    toast(`Copied ${value}`);
  } catch (_error) {
    toast("Could not copy");
  }
}

function bindRequestRail() {
  const rail = $(".request-rail");
  if (!rail) return;
  rail.querySelectorAll("[data-copy-value]").forEach(button => { button.onclick = () => copyRequestValue(button); });
  state.requestRailObserver?.disconnect();
  const top = rail.querySelector(".request-rail-top");
  const heading = rail.querySelector(".request-heading");
  if (!top || !heading || !("IntersectionObserver" in window)) return;
  state.requestRailObserver = new IntersectionObserver(([entry]) => {
    top.classList.toggle("is-condensed", !entry.isIntersecting);
  }, { root: rail, rootMargin: `-${top.offsetHeight}px 0px 0px 0px` });
  state.requestRailObserver.observe(heading);
}

function bindRequestComposer(request) {
  const form = $("#commentForm");
  const field = form?.querySelector("textarea");
  const button = form?.querySelector('button[type="submit"]');
  if (!form || !field || !button) return;
  const sync = () => {
    button.disabled = !field.value.trim();
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 220)}px`;
  };
  field.addEventListener("input", sync);
  field.addEventListener("keydown", event => {
    if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    if (!button.disabled) form.requestSubmit();
  });
  form.onsubmit = event => submitRequestComment(event, request);
}

function closeRequestActivity() {
  const panel = $("#requestActivityPanel");
  const button = $("#showRequestActivity");
  if (panel) panel.hidden = true;
  button?.setAttribute("aria-expanded", "false");
  const home = document.querySelector(".request-activity-control");
  if (panel && home && panel.parentElement !== home) home.append(panel);
}

function bindRequestActivity() {
  const button = $("#showRequestActivity");
  const panel = $("#requestActivityPanel");
  if (!button || !panel) return;
  const setOpen = open => {
    if (!open) {
      closeRequestActivity();
      return;
    }
    document.body.append(panel);
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    placeRequestActivityPanel();
    panel.focus({ preventScroll: true });
  };
  button.onclick = event => {
    event.stopPropagation();
    setOpen(panel.hidden);
  };
  if (location.hash === "#activity") setOpen(true);
  panel.querySelector("[data-close-activity]").onclick = event => {
    event.stopPropagation();
    setOpen(false);
  };
  if (document.documentElement.dataset.requestActivityBound === "true") return;
  document.documentElement.dataset.requestActivityBound = "true";
  document.addEventListener("click", event => {
    const current = $("#requestActivityPanel");
    if (!current || current.hidden) return;
    if (event.target.closest("#requestActivityPanel, #showRequestActivity, [data-request-file]")) return;
    closeRequestActivity();
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    const current = $("#requestActivityPanel");
    if (!current || current.hidden) return;
    event.stopImmediatePropagation();
    closeRequestActivity();
  }, true);
  document.addEventListener("scroll", () => placeRequestActivityPanel(), true);
  window.addEventListener("resize", () => placeRequestActivityPanel());
}
function syncPreviewPinLayer() {
  const image = $("#colorPreviewImage");
  const layer = $("#previewPins");
  const stage = $("#colorPreviewLink");
  if (!image || !layer) return;
  const ready = image.classList.contains("is-fitted") && !stage?.classList.contains("is-comparing");
  layer.hidden = !ready;
  layer.style.width = image.style.width;
  layer.style.height = image.style.height;
  layer.style.transform = image.style.transform;
}

function paintPreviewPins(file) {
  const layer = $("#previewPins");
  if (!layer) return;
  const pins = (file?.comments || []).filter(commentHasPin);
  layer.replaceChildren(...pins.map((comment, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "preview-pin";
    button.dataset.previewPin = comment.id;
    button.style.left = `${Number(comment.pinX)}%`;
    button.style.top = `${Number(comment.pinY)}%`;
    button.style.animationDelay = `${Math.min(index, 8) * 55}ms`;
    const settle = () => button.classList.add("is-settled");
    button.addEventListener("animationend", event => {
      if (event.animationName === "preview-pin-in") settle();
    });
    button.addEventListener("pointerenter", settle, { once: true });
    button.title = `${comment.authorName}: ${comment.body}`;
    button.setAttribute("aria-label", `Comment by ${comment.authorName}`);
    button.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="5.4" r="2.1" fill="currentColor"/><path d="M3.4 13c.7-2.1 2.3-3.1 4.6-3.1s3.9 1 4.6 3.1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
    return button;
  }));
  syncPreviewPinLayer();
}

function revealRequestComment(commentId) {
  document.querySelectorAll(".preview-pin.is-current, .request-message.is-current").forEach(node => node.classList.remove("is-current"));
  const pin = document.querySelector(`[data-preview-pin="${CSS.escape(commentId)}"]`);
  const card = document.querySelector(`[data-comment-id="${CSS.escape(commentId)}"]`);
  pin?.classList.add("is-current", "is-settled");
  if (!card) return;
  card.classList.add("is-current");
  card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  card.focus({ preventScroll: true });
}

function setPreviewCommentMode(on) {
  const stage = $("#colorPreviewLink");
  const button = $("#previewComment");
  if (!stage || !button) return;
  stage.classList.toggle("is-commenting", on);
  button.setAttribute("aria-pressed", on ? "true" : "false");
  if (!on) $("#previewCommentBox")?.remove();
}

function openPreviewCommentComposer(request, pinX, pinY, clientX, clientY) {
  $("#previewCommentBox")?.remove();
  const stage = $("#colorPreviewLink");
  if (!stage) return;
  const form = document.createElement("form");
  form.id = "previewCommentBox";
  form.className = "preview-comment-box";
  form.innerHTML = `<span class="preview-comment-avatar" aria-hidden="true">${esc(requestInitial(state.user?.displayName))}</span><label class="preview-comment-field"><span class="sr-only">Comment</span><textarea name="body" rows="2" maxlength="5000" required placeholder="Add a comment"></textarea></label><button class="primary" type="submit" disabled>Send</button>`;
  stage.append(form);
  const field = form.querySelector("textarea");
  const submit = form.querySelector("button");
  const place = () => {
    const bounds = stage.getBoundingClientRect();
    const width = form.offsetWidth;
    const height = form.offsetHeight;
    let left = clientX - bounds.left + 18;
    let top = clientY - bounds.top - height / 2;
    if (left + width > bounds.width - 12) left = clientX - bounds.left - width - 36;
    left = Math.max(22, Math.min(left, bounds.width - width - 12));
    top = Math.max(12, Math.min(top, bounds.height - height - 12));
    form.style.left = `${left}px`;
    form.style.top = `${top}px`;
  };
  place();
  const sync = () => {
    submit.disabled = !field.value.trim();
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 160)}px`;
    place();
  };
  field.addEventListener("input", sync);
  field.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      setPreviewCommentMode(false);
      return;
    }
    if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    if (!submit.disabled) form.requestSubmit();
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const body = field.value.trim();
    if (!body || !request) return;
    submit.disabled = true;
    submit.textContent = "Sending…";
    const anchor = commentAnchor(currentRequestFile());
    let focusId = "";
    try {
      const result = await api(`/api/color-requests/${encodeURIComponent(request.id)}/comments`, {
        method: "POST",
        body: JSON.stringify({ body, ...anchor, pinX, pinY })
      });
      focusId = result.comment?.id || "";
    } catch (error) {
      toast(error.message);
      submit.disabled = false;
      submit.textContent = "Send";
      return;
    }
    toast("Comment added");
    try {
      await refreshRequestDetail(request.id);
      if (focusId) revealRequestComment(focusId);
    } catch (_error) {
      await renderColorRequestDetail(request.id);
    }
  });
  field.focus();
}

function bindPreviewComments(request) {
  const stage = $("#colorPreviewLink");
  const button = $("#previewComment");
  if (!stage || !button) return;
  stage._syncPreviewPins = syncPreviewPinLayer;
  stage._exitPreviewComment = () => setPreviewCommentMode(false);
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    const next = button.getAttribute("aria-pressed") !== "true";
    if (next) setPreviewCompare(false);
    setPreviewCommentMode(next);
  });
  stage.addEventListener("pointerdown", event => {
    if (!stage.classList.contains("is-commenting") || event.button !== 0) return;
    if (event.target.closest(".preview-actions, .preview-zoom, .preview-navigator, .preview-comment-box, .preview-pin")) return;
    const image = $("#colorPreviewImage");
    if (!image?.classList.contains("is-fitted")) return;
    const rect = image.getBoundingClientRect();
    const pinX = (event.clientX - rect.left) / rect.width * 100;
    const pinY = (event.clientY - rect.top) / rect.height * 100;
    if (!(pinX >= 0 && pinX <= 100 && pinY >= 0 && pinY <= 100)) return;
    event.preventDefault();
    event.stopPropagation();
    openPreviewCommentComposer(request, pinX, pinY, event.clientX, event.clientY);
  }, true);
  stage.addEventListener("click", event => {
    const pin = event.target.closest("[data-preview-pin]");
    if (!pin) return;
    event.preventDefault();
    event.stopPropagation();
    revealRequestComment(pin.dataset.previewPin);
  });
  const thread = $("#requestThread");
  if (thread && thread.dataset.pinBound !== "true") {
    thread.dataset.pinBound = "true";
    thread.addEventListener("click", event => {
      const card = event.target.closest("[data-comment-id]");
      if (card) revealRequestComment(card.dataset.commentId);
    });
  }
  if (document.documentElement.dataset.previewCommentKeys !== "true") {
    document.documentElement.dataset.previewCommentKeys = "true";
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape" || !$("#colorPreviewLink")?.classList.contains("is-commenting")) return;
      setPreviewCommentMode(false);
    });
  }
  paintPreviewPins(currentRequestFile());
}

function drawColorRequestDetail(request) {
  document.querySelector("body > #requestActivityPanel")?.remove();
  const previousRail = document.querySelector(".request-rail");
  const keepScroll = previousRail && state.activeColorRequest?.id === request.id ? previousRail.scrollTop : 0;
  const files = requestFiles(request);
  const remembered = state.requestSelection?.requestId === request.id ? state.requestSelection.key : "";
  const selected = files.find(file => file.key === remembered) || defaultRequestFile(files);
  state.activeColorRequest = request;
  state.requestSelection = { requestId: request.id, key: selected?.key || "" };
  const canDeliver = state.user.role === "ADMIN" && request.status !== "APPROVED";
  const rail = [
    requestRailTopMarkup(request),
    requestHeadingMarkup(request),
    requestNextStepMarkup(request, selected, canDeliver),
    requestSwatchSection(files.filter(file => !file.delivery), selected?.key),
    deliverySections(files.filter(file => file.delivery), selected?.key),
    requestCommentsMarkup(selected)
  ].join("");
  showRequestDetail(`<article class="color-page request-room">${requestStageMarkup(selected, request)}<aside class="color-page-info request-rail">${rail}</aside></article>`);
  if ($("#uploadDelivery")) $("#uploadDelivery").onclick = () => openDeliveryForm(request);
  bindRequestReview(request);
  document.querySelectorAll("[data-request-file]").forEach(row => { row.onclick = () => selectRequestFile(row); });
  bindReferenceTypes();
  bindRequestComposer(request);
  bindColorPreview();
  bindRequestActivity();
  bindRequestRail();
  bindPreviewComments(request);
  if (keepScroll) $(".request-rail").scrollTop = keepScroll;
}

async function refreshRequestDetail(requestId) {
  const request = (await api(`/api/color-requests/${encodeURIComponent(requestId)}`)).request;
  drawColorRequestDetail(request);
}

function selectRequestFile(row) {
  document.querySelectorAll("[data-request-file]").forEach(item => {
    const on = item === row;
    item.classList.toggle("is-selected", on);
    item.setAttribute("aria-pressed", on ? "true" : "false");
  });
  const display = row.dataset.display || row.dataset.preview;
  const image = $("#colorPreviewImage");
  const nextSrc = new URL(display, location.href).href;
  if (image && image.src !== nextSrc) {
    image.classList.remove("is-fitted");
    const loading = $("#previewLoading");
    if (loading) {
      loading.hidden = false;
      loading.textContent = "Loading full image…";
    }
    image.src = display;
  }
  if (image) image.alt = row.dataset.file;
  const navigatorImage = $("#previewNavigatorImage");
  if (navigatorImage) navigatorImage.src = row.dataset.preview;
  const open = $("#previewOpenFull");
  if (open) open.href = display;
  bindPreviewCompare();
  const stage = $("#colorPreviewLink");
  if (stage) stage.dataset.fullSrc = display;
  $("#requestPreviewKind").textContent = row.dataset.kind;
  $("#requestPreviewFilename").textContent = row.dataset.file;
  const fileStatus = $("#requestPreviewFileStatus");
  if (fileStatus) {
    fileStatus.className = `pill ${row.dataset.statusClass || ""}`;
    fileStatus.textContent = row.dataset.status || "";
  }
  const download = $("#requestDownload");
  if (download) download.href = row.dataset.download;
  const request = state.activeColorRequest;
  const key = row.dataset.requestFile;
  const file = requestFiles(request).find(item => item.key === key) || {
    delivery: key !== "source",
    profile: row.dataset.profile,
    note: row.dataset.note,
    title: row.querySelector("strong")?.textContent || "this version",
    comments: []
  };
  if (state.requestSelection) state.requestSelection.key = key;
  const activityInfo = $("#requestActivityInfo");
  if (activityInfo && request) activityInfo.innerHTML = requestActivityInfoMarkup(request, currentRequestFile() || file);
  const commentDelivery = $("#commentDeliveryId");
  const commentLabel = $("#commentTargetLabel");
  const fieldLabel = $("#commentFieldLabel");
  if (commentDelivery) commentDelivery.value = file.delivery ? key : "";
  if (commentLabel) commentLabel.textContent = commentTarget(file);
  if (fieldLabel) fieldLabel.textContent = `Comment on ${commentTarget(file)}`;
  const thread = $("#requestThread");
  if (thread) thread.innerHTML = requestThread(file);
  const actions = $("#requestReviewActions");
  if (actions) {
    actions.innerHTML = requestStepActions(request, file);
    bindRequestReview(request);
  }
  $("#previewCommentBox")?.remove();
  paintPreviewPins(currentRequestFile());
  revealReferenceType(key);
}

function rememberReferenceOpen(key, open) {
  const requestId = state.activeColorRequest?.id;
  if (!state.requestReferenceOpen || state.requestReferenceOpen.requestId !== requestId) {
    state.requestReferenceOpen = { requestId, keys: new Set() };
  }
  if (open) state.requestReferenceOpen.keys.add(key);
  else state.requestReferenceOpen.keys.delete(key);
}

function setReferenceGroupOpen(tree, open) {
  const button = tree.querySelector(".reference-tree-toggle");
  const panel = tree.querySelector(".reference-tree-panel");
  if (!button || !panel) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  button.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    panel.hidden = false;
    if (reduce || tree.classList.contains("is-open")) {
      tree.classList.add("is-open");
      return;
    }
    requestAnimationFrame(() => tree.classList.add("is-open"));
    return;
  }
  tree.classList.remove("is-open");
  const hide = () => { if (!tree.classList.contains("is-open")) panel.hidden = true; };
  if (reduce) {
    hide();
    return;
  }
  const timer = window.setTimeout(hide, 280);
  panel.addEventListener("transitionend", event => {
    if (event.target !== panel || event.propertyName !== "grid-template-rows") return;
    window.clearTimeout(timer);
    hide();
  }, { once: true });
}

function revealReferenceType(key) {
  const root = document.querySelector(".request-reference-groups");
  if (!root || !key) return;
  const tree = [...root.querySelectorAll(".reference-version-tree")].find(item => item.querySelector(`[data-request-file="${CSS.escape(key)}"]`));
  if (!tree) return;
  root.querySelectorAll(".reference-version-tree").forEach(item => item.classList.toggle("has-selection", item === tree));
  const row = tree.querySelector(`[data-request-file="${CSS.escape(key)}"]`);
  const show = () => row?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  const inHistory = Boolean(row?.closest(".reference-tree-panel"));
  if (!inHistory) {
    show();
    return;
  }
  rememberReferenceOpen(tree.dataset.referenceType, true);
  const wasOpen = tree.classList.contains("is-open");
  setReferenceGroupOpen(tree, true);
  if (wasOpen) {
    show();
    return;
  }
  panelTransition(tree, show);
}

function panelTransition(tree, done) {
  const panel = tree.querySelector(".reference-tree-panel");
  if (!panel || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    requestAnimationFrame(done);
    return;
  }
  const timer = window.setTimeout(done, 280);
  panel.addEventListener("transitionend", event => {
    if (event.target !== panel || event.propertyName !== "grid-template-rows") return;
    window.clearTimeout(timer);
    done();
  }, { once: true });
}

function bindReferenceTypes() {
  const root = document.querySelector(".request-reference-groups");
  if (!root) return;
  const requestId = state.activeColorRequest?.id;
  const fresh = !state.requestReferenceOpen || state.requestReferenceOpen.requestId !== requestId;
  if (fresh) state.requestReferenceOpen = { requestId, keys: new Set() };
  root.querySelectorAll(".reference-version-tree").forEach(tree => {
    const key = tree.dataset.referenceType;
    if (fresh && tree.classList.contains("is-open")) state.requestReferenceOpen.keys.add(key);
    const button = tree.querySelector(".reference-tree-toggle");
    if (!button) return;
    button.onclick = () => {
      const open = button.getAttribute("aria-expanded") !== "true";
      setReferenceGroupOpen(tree, open);
      rememberReferenceOpen(key, open);
    };
  });
}

function openDeliveryForm(request) {
  const categories = [];
  const seen = new Set();
  for (const delivery of request.deliveries || []) {
    const key = deliveryCategoryKey(delivery);
    if (seen.has(key)) continue;
    seen.add(key);
    categories.push(delivery);
  }
  let selectedExisting = false;
  const existing = categories.map(delivery => {
    const blocked = (request.deliveries || []).some(item => deliveryCategoryKey(item) === deliveryCategoryKey(delivery) && item.status === "IN_REVIEW");
    const checked = !blocked && !selectedExisting;
    if (checked) selectedExisting = true;
    return `<label class="upload-target"><input type="radio" name="targetReference" value="${esc(deliveryCategoryKey(delivery))}" ${checked ? "checked" : ""} ${blocked ? "disabled" : ""}><span class="upload-target-image"><i>${esc(deliveryCategoryName(delivery).slice(0, 1))}</i></span><span><strong>${esc(deliveryCategoryName(delivery))}</strong><small>${blocked ? "Waiting for review" : "Add another version"}</small></span><b aria-hidden="true">✓</b></label>`;
  }).join("");
  const newChecked = selectedExisting ? "" : "checked";
  openModal({
    eyebrow: "REFERENCE UPLOAD",
    title: `Upload for ${request.displayName}`,
    submit: "Send for approval",
    body: `<div class="upload-form"><fieldset><legend><span>1</span><div><strong>Choose destination</strong></div></legend><div class="upload-targets">${existing}<label class="upload-target upload-target-new"><input type="radio" name="targetReference" value="__new" ${newChecked}><span class="upload-target-image"><i>+</i></span><span><strong>Add new reference</strong><small>Create a new reference type</small></span><b aria-hidden="true">✓</b></label></div><div id="newReferenceFields" class="new-reference-fields"><label>Reference type<select id="newReferenceType" name="kind"><option value="FULL">Full reference</option><option value="QUICK">Crop reference</option><option value="OTHER">Add new reference type</option></select></label><label id="customReferenceTypeFields" hidden>New reference type<input id="newReferenceTypeName" name="label" maxlength="80"></label></div></fieldset><fieldset><legend><span>2</span><div><strong>Add the image</strong><small>Supported: JPG, PNG, TIFF, PSD, and PSB.</small></div></legend><label class="upload-file"><input id="versionFile" name="file" type="file" accept=".jpg,.jpeg,.png,.tif,.tiff,.psd,.psb" required><span class="upload-file-icon" aria-hidden="true">↑</span><span><strong>Choose an image file</strong><small id="selectedFileName">Click to browse from your computer</small></span></label></fieldset><fieldset><legend><span>3</span><div><strong>Version note</strong><small>Optional</small></div></legend><textarea name="uploadNote"></textarea></fieldset></div>`,
    onSubmit: async form => {
      const target = form.get("targetReference");
      if (target && target !== "__new") {
        const separator = String(target).indexOf(":");
        form.set("kind", String(target).slice(0, separator));
        const label = String(target).slice(separator + 1);
        if (label) form.set("label", label);
        else form.delete("label");
      } else if (form.get("kind") === "OTHER") {
        const customType = String(form.get("label") || "").trim();
        if (!customType) throw new Error("Enter a name for the new reference type");
        form.set("label", customType);
      } else form.delete("label");
      form.delete("targetReference");
      const result = await api(`/api/color-requests/${encodeURIComponent(request.id)}/deliveries`, { method: "POST", body: form });
      toast("Delivery sent for approval");
      drawColorRequestDetail(result.request);
    }
  });
  const fileInput = $("#versionFile");
  const newFields = $("#newReferenceFields");
  const newType = $("#newReferenceType");
  const customTypeFields = $("#customReferenceTypeFields");
  const customTypeName = $("#newReferenceTypeName");
  const syncNewReferenceFields = () => {
    const isNew = document.querySelector('input[name="targetReference"]:checked')?.value === "__new";
    const isCustom = isNew && newType.value === "OTHER";
    newFields.hidden = !isNew;
    newType.disabled = !isNew;
    customTypeFields.hidden = !isCustom;
    customTypeName.disabled = !isCustom;
    customTypeName.required = isCustom;
  };
  document.querySelectorAll('input[name="targetReference"]').forEach(input => { input.onchange = syncNewReferenceFields; });
  newType.onchange = syncNewReferenceFields;
  syncNewReferenceFields();
  fileInput.onchange = () => { $("#selectedFileName").textContent = fileInput.files[0]?.name || "Click to browse from your computer"; };
}

async function decideRequest(request, action) {
  const approval = action === "approve";
  if (!approval) return openChangesForm(request);
  const accepted = await confirmAction({ eyebrow: "APPROVE DELIVERY", title: "Approve these deliveries?", message: "Each reference waiting for review becomes the approved file for that category.", confirmLabel: "Approve", icon: "✓" });
  if (!accepted) return;
  const buttons = [...document.querySelectorAll("[data-approve-request],[data-change-request]")];
  buttons.forEach(button => { button.disabled = true; });
  try {
    const result = await api(`/api/color-requests/${encodeURIComponent(request.id)}/${action}`, { method: "POST", body: "{}" });
    if (result.sync?.status === "FAILED") toast(`Approved, but local sync failed: ${result.sync.error}`);
    else toast("Delivery approved and added to Approved colors");
    drawColorRequestDetail(result.request);
  } catch (error) {
    toast(error.message);
    buttons.forEach(button => { button.disabled = false; });
  }
}

function openChangesForm(request) {
  openModal({
    eyebrow: "REQUEST CHANGES",
    title: "What needs to change?",
    submit: "Send feedback",
    body: `<label>Changes needed<textarea name="comment" maxlength="5000" required autofocus></textarea></label>`,
    onSubmit: async form => {
      const comment = String(form.get("comment") || "").trim();
      if (!comment) throw new Error("Describe the changes needed");
      const result = await api(`/api/color-requests/${encodeURIComponent(request.id)}/changes`, {
        method: "POST",
        body: JSON.stringify({ comment })
      });
      toast("Changes requested with feedback");
      drawColorRequestDetail(result.request);
    }
  });
}

async function withdrawDelivery(request, deliveryId) {
  const accepted = await confirmAction({
    eyebrow: "WITHDRAW DELIVERY",
    title: "Withdraw this delivery?",
    message: "The client will no longer be asked to approve this file. It stays available to download.",
    confirmLabel: "Withdraw",
    icon: "↶"
  });
  if (!accepted) return;
  const button = document.querySelector(`[data-withdraw-delivery="${deliveryId}"]`);
  if (button) button.disabled = true;
  try {
    const result = await api(`/api/color-requests/${encodeURIComponent(request.id)}/deliveries/${encodeURIComponent(deliveryId)}/withdraw`, { method: "POST", body: "{}" });
    toast("Delivery withdrawn");
    drawColorRequestDetail(result.request);
  } catch (error) {
    toast(error.message);
    if (button) button.disabled = false;
  }
}

async function submitRequestComment(event, request) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const errorBox = $("#commentError");
  const body = String(new FormData(form).get("body") || "").trim();
  const deliveryId = String(new FormData(form).get("deliveryId") || "");
  errorBox.hidden = true;
  button.disabled = true;
  button.textContent = "Posting…";
  try {
    await api(`/api/color-requests/${encodeURIComponent(request.id)}/comments`, {
      method: "POST",
      body: JSON.stringify({ body, deliveryId: deliveryId || undefined })
    });
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
    button.disabled = false;
    button.textContent = "Post comment";
    return;
  }
  toast("Comment added");
  try {
    await refreshRequestDetail(request.id);
    $("#requestThread")?.lastElementChild?.scrollIntoView({ block: "nearest" });
  } catch (_error) {
    await renderColorRequestDetail(request.id);
  }
}
