function pixofixStatus(title, message, role, action) {
  return `<section class="panel pixofix-status" role="${role}"><strong>${esc(title)}</strong><p>${esc(message)}</p>${action || ""}</section>`;
}

function bindAddPixofixColor() {
  const button = $("#addPixofixColor");
  if (button) button.onclick = openAddPixofixColor;
}

const PIXOFIX_NAME_HINT = "Suggested in Adobe RGB (1998). You can edit it.";
const PIXOFIX_PROFILE_NOTE = globalThis.ADOBE_RGB_NAME || "Adobe RGB (1998)";

function pixofixNormalizeHex(value) {
  const match = String(value || "").trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return "";
  let hex = match[1].toUpperCase();
  if (hex.length === 3) hex = hex.split("").map(char => char + char).join("");
  return `#${hex}`;
}

function pixofixHexReady(value) {
  return Boolean(pixofixNormalizeHex(value));
}

function renderPixofixExists(hexInput) {
  const notice = $("#pixofixExists");
  const submit = $("#modalSubmit");
  if (!notice || !hexInput) return;
  const hexCode = pixofixNormalizeHex(hexInput.value);
  const setSubmit = disabled => {
    if (submit) submit.disabled = disabled;
  };
  notice.className = "pixofix-exists";
  hexInput.classList.remove("is-invalid");
  hexInput.setAttribute("aria-invalid", "false");
  if (!hexCode) {
    notice.hidden = true;
    notice.textContent = "";
    setSubmit(false);
    return;
  }
  if (!Array.isArray(state.pixofixColors)) {
    notice.hidden = false;
    notice.textContent = state.pixofixCatalogError
      ? "Could not check whether this color is already in Explore swatches."
      : "Checking Explore swatches…";
    if (!state.pixofixCatalogError) notice.classList.add("is-checking");
    setSubmit(true);
    return;
  }
  const existing = state.pixofixColors.find(color => color.hexCode === hexCode);
  if (!existing) {
    notice.hidden = true;
    notice.textContent = "";
    setSubmit(false);
    return;
  }
  notice.hidden = false;
  notice.textContent = "This color already exists.";
  hexInput.classList.add("is-invalid");
  hexInput.setAttribute("aria-invalid", "true");
  setSubmit(true);
}

function refreshOpenPixofixExists() {
  const modal = $("#modal");
  const hexInput = $("#modalForm")?.querySelector('[name="hexCode"]');
  if (!modal?.open || !hexInput || !$("#pixofixExists")) return;
  renderPixofixExists(hexInput);
}

function openAddPixofixColor() {
  openModal({
    eyebrow: "SWATCHES",
    title: "Add color",
    submit: "Add color",
    body: `<label>Hex code<input name="hexCode" placeholder="#E76223" required autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="pixofixProfile pixofixExists"></label><p id="pixofixProfile" class="muted">${PIXOFIX_PROFILE_NOTE}. Hex values use this profile.</p><p id="pixofixExists" class="pixofix-exists" aria-live="polite" hidden></p><label>Color name<input name="name" required maxlength="120" autocomplete="off" placeholder="Suggested from the hex" aria-describedby="pixofixNameHint"></label><p id="pixofixNameHint" class="muted" aria-live="polite">${PIXOFIX_NAME_HINT}</p>`,
    onSubmit: async form => {
      const hexCode = String(form.get("hexCode") || "");
      const name = String(form.get("name") || "").trim();
      if (!name) throw new Error("Color name is required");
      await api("/api/pixofix/colors", { method: "POST", body: JSON.stringify({ hexCode, name }) });
      toast("Color added");
      await renderPixofixLibrary();
    }
  });
  bindPixofixColorName($("#modalForm"));
}

let pixofixSubmitGuard = null;

function bindPixofixColorName(form) {
  const hexInput = form?.querySelector('[name="hexCode"]');
  const nameInput = form?.querySelector('[name="name"]');
  const hint = form?.querySelector("#pixofixNameHint");
  if (!hexInput || !nameInput || !hint) return;
  let requestId = 0;
  let suggested = "";
  let dirty = false;
  const setHint = text => {
    hint.textContent = text;
  };
  nameInput.addEventListener("input", () => {
    dirty = nameInput.value.trim() !== suggested;
  });
  if (pixofixSubmitGuard) form.removeEventListener("submit", pixofixSubmitGuard, true);
  pixofixSubmitGuard = event => {
    const currentHex = event.currentTarget?.querySelector('[name="hexCode"]');
    if (!currentHex) return;
    renderPixofixExists(currentHex);
    if ($("#pixofixExists")?.hidden) return;
    event.preventDefault();
    event.stopPropagation();
  };
  form.addEventListener("submit", pixofixSubmitGuard, true);
  hexInput.addEventListener("input", async () => {
    const raw = hexInput.value;
    const id = ++requestId;
    renderPixofixExists(hexInput);
    if (!pixofixHexReady(raw)) {
      if (!dirty) {
        suggested = "";
        nameInput.value = "";
        nameInput.placeholder = "Suggested from the hex";
      }
      setHint(PIXOFIX_NAME_HINT);
      return;
    }
    if (!dirty) {
      nameInput.value = "";
      nameInput.placeholder = "Suggesting name…";
      setHint("Suggesting a name…");
    }
    try {
      const result = await api(`/api/pixofix/color-name?hexCode=${encodeURIComponent(raw.trim())}`);
      if (id !== requestId) return;
      suggested = String(result.name || "");
      if (!dirty) nameInput.value = suggested;
      nameInput.placeholder = "Suggested from the hex";
      setHint(PIXOFIX_NAME_HINT);
    } catch (_error) {
      if (id !== requestId) return;
      if (!dirty) {
        suggested = "";
        nameInput.value = "";
      }
      nameInput.placeholder = "Suggested from the hex";
      setHint("Could not suggest a name. Type one to continue.");
    }
  });
}

function markPixofixList() {
  document.querySelector(".page")?.classList.add("is-pixofix");
}

function resetPixofixFilters() {
  state.pixofixQuery = "";
  state.pixofixShade = "";
  syncAppRoute("replace");
  const search = $("#pixofixSearch");
  if (search) search.value = "";
  drawPixofixColors();
  search?.focus();
}

function ensurePixofixShell(shade, query) {
  if ($("#pixofixGrid")) return;
  $("#content").innerHTML = `<div class="pixofix-controls"><div class="pixofix-find"><div class="toolbar pixofix-toolbar"><label class="search-field"><svg class="search-field-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.25" fill="none" stroke="currentColor" stroke-width="1.8"></circle><path d="M16 16.5 20 20.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path></svg><input id="pixofixSearch" placeholder="Search hex" aria-label="Search hex" value="${esc(query)}"></label></div><div class="pixofix-meta"><p id="pixofixResultSummary" class="color-result-summary" aria-live="polite"></p><button id="clearPixofixFilters" class="pixofix-clear" type="button" hidden>Clear filters</button></div></div>${shadeFiltersMarkup(shade)}</div><div id="pixofixGrid" class="pixofix-grid"></div>`;
  $("#pixofixSearch").oninput = () => {
    state.pixofixQuery = $("#pixofixSearch").value;
    drawPixofixColors();
  };
  document.querySelectorAll("#content .shade-filters [data-shade]").forEach(button => {
    button.onclick = () => {
      const next = button.dataset.shade;
      state.pixofixShade = normalizeShadeId(state.pixofixShade) === next ? "" : next;
      syncAppRoute("replace");
      drawPixofixColors();
    };
  });
  $("#clearPixofixFilters").onclick = resetPixofixFilters;
}

function showPixofixLoadError(error) {
  const html = pixofixStatus("Could not load swatches", error.message || "Explore swatches could not be loaded.", "alert", '<button id="retryPixofix" class="secondary" type="button">Try again</button>');
  const grid = $("#pixofixGrid");
  if (grid) {
    grid.removeAttribute("aria-busy");
    grid.innerHTML = html;
  } else {
    $("#content").removeAttribute("aria-busy");
    $("#content").innerHTML = html;
  }
  $("#retryPixofix").onclick = () => renderPixofixLibrary();
}

async function renderPixofixLibrary() {
  const detailId = state.pixofixColorId;
  state.view = "pixofix";
  if (!detailId) syncAppRoute();
  nav(workspaceNav());
  const addButton = state.user.role === "ADMIN" ? '<button id="addPixofixColor" class="primary" type="button">Add color</button>' : "";
  if (detailId) page("SWATCHES", "Explore swatches", "Swatch", "");
  else {
    page("SWATCHES", "Explore swatches", "A shared set of flat Adobe RGB (1998) swatches. Every client can view it.", addButton);
    bindAddPixofixColor();
    markPixofixList();
    ensurePixofixShell(normalizeShadeId(state.pixofixShade), state.pixofixQuery || "");
  }
  const loading = pixofixStatus("Loading swatches", "Fetching swatches.", "status");
  const grid = $("#pixofixGrid");
  if (grid) {
    const summary = $("#pixofixResultSummary");
    if (summary) summary.textContent = "";
    const inlineClear = $("#clearPixofixFilters");
    if (inlineClear) inlineClear.hidden = true;
    grid.setAttribute("aria-busy", "true");
    grid.innerHTML = loading;
  } else {
    $("#content").innerHTML = loading;
    $("#content").setAttribute("aria-busy", "true");
  }
  try {
    const payload = await api("/api/pixofix/colors");
    state.pixofixColors = payload.colors || [];
    state.pixofixCatalogError = false;
    refreshOpenPixofixExists();
    if (detailId && state.pixofixColors.some(color => color.id === detailId)) return renderPixofixDetail(detailId);
    if (detailId) {
      state.pixofixColorId = null;
      syncAppRoute();
      page("SWATCHES", "Explore swatches", "A shared set of flat Adobe RGB (1998) swatches. Every client can view it.", addButton);
      bindAddPixofixColor();
      markPixofixList();
    }
    drawPixofixColors();
  } catch (error) {
    if (!Array.isArray(state.pixofixColors)) state.pixofixCatalogError = true;
    showPixofixLoadError(error);
    refreshOpenPixofixExists();
  }
}

function drawPixofixColors() {
  const colors = state.pixofixColors || [];
  const query = state.pixofixQuery || "";
  const normalized = query.trim().toLowerCase();
  const shade = normalizeShadeId(state.pixofixShade);
  const visible = colors.filter(color => {
    const matchesQuery = !normalized || `${color.name} ${color.hexCode}`.toLowerCase().includes(normalized);
    return matchesQuery && (!shade || shadeIdForColor(color) === shade);
  }).sort(comparePixofixColors);
  markPixofixList();
  ensurePixofixShell(shade, query);
  $("#content").removeAttribute("aria-busy");
  const summary = $("#pixofixResultSummary");
  const shadeName = shadeLabel(shade);
  summary.textContent = visible.length === colors.length
    ? `${colors.length} color${colors.length === 1 ? "" : "s"}`
    : `Showing ${visible.length} of ${colors.length}${shadeName ? ` · ${shadeName}` : ""}`;
  const clearFilters = Boolean(shade || normalized);
  const inlineClear = $("#clearPixofixFilters");
  if (inlineClear) inlineClear.hidden = !(clearFilters && visible.length);
  const emptyCopy = !colors.length
    ? "No swatches yet."
    : shade && normalized
      ? `No ${shadeName.toLowerCase()} shades match “${esc(query.trim())}”.`
      : shade
        ? `No ${shadeName.toLowerCase()} shades in Explore swatches.`
        : `No colors match “${esc(query.trim())}”.`;
  const grid = $("#pixofixGrid");
  grid.classList.remove("is-settled");
  grid.removeAttribute("aria-busy");
  grid.innerHTML = visible.length
    ? visible.map((color, index) => `<article class="pixofix-card${color.saved ? " is-saved" : ""}" data-pixofix-id="${esc(color.id)}" style="--pixofix-i:${Math.min(index, 10)}"><button class="pixofix-open" type="button" data-pixofix-color="${esc(color.id)}" aria-label="View ${esc(color.name)}"><span class="pixofix-swatch"${pixofixSwatchBackground(color.hexCode)}><img src="${esc(color.swatchUrl)}" alt="" width="240" height="160" decoding="async" loading="lazy"></span><span class="pixofix-hex-label">${esc(color.hexCode)}</span><span class="pixofix-name">${esc(color.name)}</span></button>${pixofixActions(color)}</article>`).join("")
    : `<div class="panel empty pixofix-empty"><p>${emptyCopy}</p>${clearFilters ? `<button id="clearPixofixSearch" class="secondary" type="button">${shade ? "Show all colors" : "Clear search"}</button>` : ""}</div>`;
  paintShadeFilters(shade);
  const clear = $("#clearPixofixSearch");
  if (clear) clear.onclick = resetPixofixFilters;
  grid.querySelectorAll("[data-pixofix-color]").forEach(button => {
    button.onclick = () => renderPixofixDetail(button.dataset.pixofixColor);
  });
  bindPixofixActions(grid);
}

function pixofixHeartIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19.2 10.85 18.15C6.4 14.15 3.5 11.55 3.5 8.35 3.5 5.75 5.5 3.8 8.05 3.8c1.45 0 2.85.68 3.95 1.78 1.1-1.1 2.5-1.78 3.95-1.78 2.55 0 4.55 1.95 4.55 4.55 0 3.2-2.9 5.8-7.35 9.8L12 19.2z"></path></svg>`;
}

function pixofixCopyIcon(key) {
  const mask = `pixofix-copy-${String(key).replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return `<svg class="pixofix-copy-glyph" viewBox="0 0 24 24" aria-hidden="true"><mask id="${mask}" maskUnits="userSpaceOnUse"><rect width="24" height="24" fill="#fff" stroke="none"></rect><rect x="8.2" y="8.2" width="14.2" height="14.2" rx="2.4" fill="#000" stroke="none"></rect></mask><rect x="2.2" y="2.2" width="12.2" height="12.2" rx="2" mask="url(#${mask})"></rect><rect x="8.8" y="8.8" width="13" height="13" rx="2"></rect></svg><svg class="pixofix-copied-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 12.2 10.2 16 17.5 8"></path></svg>`;
}

function pixofixDownloadIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v9.2"></path><path d="M8.1 10.1 12 14l3.9-3.9"></path><path d="M5 16.6v1.6A1.8 1.8 0 0 0 6.8 20h10.4a1.8 1.8 0 0 0 1.8-1.8v-1.6"></path></svg>`;
}

function pixofixActions(color, stage = false) {
  const saved = Boolean(color.saved);
  const download = stage ? `<button class="pixofix-action pixofix-download" type="button" data-pixofix-download="${esc(color.id)}" aria-label="Download ${esc(color.name)}">${pixofixDownloadIcon()}<span class="pixofix-action-label">Download</span></button>` : "";
  return `<div class="pixofix-actions${stage ? " is-stage" : ""}">${download}<button class="pixofix-action pixofix-copy" type="button" data-pixofix-copy="${esc(color.hexCode)}" aria-label="Copy hex ${esc(color.hexCode)}">${pixofixCopyIcon(color.id)}<span class="pixofix-action-label">Copy hex</span></button><button class="pixofix-action pixofix-save" type="button" data-pixofix-save="${esc(color.id)}" aria-pressed="${saved ? "true" : "false"}" aria-label="${saved ? "Saved" : "Save"}">${pixofixHeartIcon()}<span class="pixofix-action-label">${saved ? "Saved" : "Save"}</span></button></div>`;
}

function bindPixofixActions(root) {
  if (!root) return;
  root.querySelectorAll("[data-pixofix-copy]").forEach(button => {
    button.onclick = event => {
      event.stopPropagation();
      copyPixofixHex(button.dataset.pixofixCopy, button);
    };
  });
  root.querySelectorAll("[data-pixofix-save]").forEach(button => {
    button.onclick = event => {
      event.stopPropagation();
      togglePixofixSave(button);
    };
  });
  root.querySelectorAll("[data-pixofix-download]").forEach(button => {
    button.onclick = event => {
      event.stopPropagation();
      downloadPixofixSwatch(button);
    };
  });
  root.querySelectorAll("[data-pixofix-delete]").forEach(button => {
    button.onclick = event => {
      event.stopPropagation();
      deletePixofixColor(button.dataset.pixofixDelete, button);
    };
  });
}

function comparePixofixColors(a, b) {
  return Number(Boolean(b.saved)) - Number(Boolean(a.saved)) || a.name.localeCompare(b.name) || a.hexCode.localeCompare(b.hexCode);
}

function paintPixofixSaved(button, saved) {
  button.disabled = false;
  button.removeAttribute("aria-busy");
  button.setAttribute("aria-pressed", saved ? "true" : "false");
  button.setAttribute("aria-label", saved ? "Saved" : "Save");
  const label = button.querySelector(".pixofix-action-label");
  if (label) label.textContent = saved ? "Saved" : "Save";
  button.closest(".pixofix-card")?.classList.toggle("is-saved", saved);
}

function reorderPixofixCards() {
  const grid = $("#pixofixGrid");
  if (!grid) return;
  const colors = new Map((state.pixofixColors || []).map(color => [color.id, color]));
  const cards = [...grid.querySelectorAll(".pixofix-card")].sort((a, b) => {
    const left = colors.get(a.dataset.pixofixId);
    const right = colors.get(b.dataset.pixofixId);
    if (!left || !right) return 0;
    return comparePixofixColors(left, right);
  });
  grid.classList.add("is-settled");
  for (const card of cards) grid.appendChild(card);
}

async function togglePixofixSave(button) {
  if (!button || button.disabled) return;
  const id = button.dataset.pixofixSave;
  const next = button.getAttribute("aria-pressed") !== "true";
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    const result = await api(`/api/pixofix/colors/${id}/save`, { method: "POST", body: JSON.stringify({ saved: next }) });
    const color = (state.pixofixColors || []).find(item => item.id === id);
    if (color) color.saved = Boolean(result.saved);
    paintPixofixSaved(button, Boolean(result.saved));
    if (button.closest("#pixofixGrid")) reorderPixofixCards();
    toast(result.saved ? "Swatch saved" : "Swatch removed from saved");
  } catch (error) {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    toast(error.message || "Could not save this swatch");
  }
}

async function deletePixofixColor(id, button) {
  const color = (state.pixofixColors || []).find(item => item.id === id);
  const confirmed = await confirmAction({
    eyebrow: "DELETE SWATCH",
    title: `Delete ${color?.name || "this swatch"}?`,
    message: "This permanently removes the swatch from Explore swatches. This cannot be undone.",
    confirmLabel: "Delete this swatch",
    tone: "danger",
    icon: "!",
    challenge: "delete"
  });
  if (!confirmed) return;
  const textDelete = button && button.id === "deletePixofixColor";
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    if (textDelete) button.textContent = "Deleting…";
  }
  try {
    await api(`/api/pixofix/colors/${id}/delete`, { method: "POST", body: JSON.stringify({ confirmation: "delete" }) });
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      if (textDelete) button.textContent = "Delete swatch";
    }
    toast(error.message || "Could not delete this swatch");
    return;
  }
  toast("Swatch deleted");
  state.pixofixColors = (state.pixofixColors || []).filter(item => item.id !== id);
  if (state.pixofixColorId === id) {
    state.pixofixColorId = null;
    syncAppRoute();
    await renderPixofixLibrary();
    return;
  }
  drawPixofixColors();
}

function pixofixDownloadName(name) {
  const base = String(name || "swatch").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return `${base || "swatch"}.png`;
}

async function downloadPixofixSwatch(button) {
  if (!button || button.disabled) return;
  const color = (state.pixofixColors || []).find(item => item.id === button.dataset.pixofixDownload);
  if (!color?.swatchUrl) return;
  const label = button.querySelector(".pixofix-action-label");
  const ariaLabel = button.getAttribute("aria-label");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.setAttribute("aria-label", "Downloading");
  if (label) label.textContent = "Downloading…";
  try {
    const response = await fetch(color.swatchUrl, { credentials: "same-origin" });
    if (!response.ok) throw new Error("Could not download this swatch");
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = pixofixDownloadName(color.name);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    toast(error.message || "Could not download this swatch");
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    if (ariaLabel) button.setAttribute("aria-label", ariaLabel);
    if (label) label.textContent = "Download";
  }
}

async function copyPixofixHex(hex, button) {
  if (!hex || !button || button.disabled) return;
  const label = button.getAttribute("aria-label") || "Copy hex";
  const statusLabel = button.querySelector(".pixofix-hex-copy-label");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  const actionLabel = button.querySelector(".pixofix-action-label");
  button.classList.add("is-copied");
  if (statusLabel) statusLabel.textContent = "Copying…";
  if (actionLabel) actionLabel.textContent = "Copying…";
  try {
    await navigator.clipboard.writeText(hex);
    button.setAttribute("aria-label", "Copied");
    if (statusLabel) statusLabel.textContent = "Copied";
    if (actionLabel) actionLabel.textContent = "Copied";
    toast("Hex code copied");
    setTimeout(() => {
      button.classList.remove("is-copied");
      button.setAttribute("aria-label", label);
      if (statusLabel) statusLabel.textContent = "Copy";
      if (actionLabel) actionLabel.textContent = "Copy hex";
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }, 900);
  } catch (_error) {
    button.classList.remove("is-copied");
    button.setAttribute("aria-label", label);
    if (statusLabel) statusLabel.textContent = "Copy";
    if (actionLabel) actionLabel.textContent = "Copy hex";
    button.disabled = false;
    button.removeAttribute("aria-busy");
    toast("Could not copy the hex code");
  }
}

function pixofixSwatchBackground(hex) {
  const css = typeof globalThis.adobeRgbCss === "function" ? globalThis.adobeRgbCss(hex) : "";
  return css ? ` style="background:${css}"` : "";
}

function pixofixRgb(hex) {
  const match = String(hex || "").trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) return "";
  return [0, 2, 4].map(index => String(Number.parseInt(match[1].slice(index, index + 2), 16))).join(", ");
}

function pixofixDistance(leftHex, rightHex) {
  const left = globalThis.labFromHex?.(leftHex);
  const right = globalThis.labFromHex?.(rightHex);
  if (!left || !right || typeof globalThis.deltaE00 !== "function") return Number.POSITIVE_INFINITY;
  return globalThis.deltaE00(left, right);
}

function pixofixRelatedMarkup(color) {
  const shade = shadeIdForColor(color);
  const label = shadeLabel(shade).toLowerCase();
  const related = (state.pixofixColors || [])
    .filter(item => item.id !== color.id && shade && shadeIdForColor(item) === shade)
    .sort((a, b) => pixofixDistance(color.hexCode, a.hexCode) - pixofixDistance(color.hexCode, b.hexCode) || a.name.localeCompare(b.name))
    .slice(0, 8);
  if (!related.length || !label) return "";
  return `<section class="pixofix-related"><div class="pixofix-related-head"><h3>More ${esc(label)}</h3><p>Closest Adobe RGB matches.</p></div><div class="pixofix-related-row">${related.map((item, index) => `<button class="pixofix-related-card" type="button" data-pixofix-color="${esc(item.id)}" data-pixofix-swatch="${esc(item.swatchUrl)}" data-pixofix-name="${esc(item.name)}" style="--pixofix-i:${index}" aria-label="View ${esc(item.name)}"><span class="pixofix-related-media"${pixofixSwatchBackground(item.hexCode)}><img src="${esc(item.swatchUrl)}" alt="" width="160" height="106" decoding="async"><span class="pixofix-related-hex">${esc(item.hexCode)}</span></span><span>${esc(item.name)}</span></button>`).join("")}</div></section>`;
}

function bindPixofixPreview(color) {
  const stage = document.querySelector(".pixofix-stage");
  const image = stage?.querySelector("img");
  const title = stage?.querySelector(".pixofix-stage-title");
  const live = document.querySelector(".pixofix-live");
  const related = document.querySelector(".pixofix-related");
  if (!stage || !image || !title || !related) return;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let swapToken = 0;
  let current = null;
  const show = button => {
    if (!button || current === button) return;
    current = button;
    related.querySelectorAll(".pixofix-related-card").forEach(card => card.classList.toggle("is-active", card === button));
    image.src = button.dataset.pixofixSwatch || color.swatchUrl;
    title.textContent = button.dataset.pixofixName || color.name;
    stage.classList.add("is-preview");
    if (live) live.textContent = `Previewing ${button.dataset.pixofixName || "shade"}`;
    if (reduceMotion) return;
    swapToken += 1;
    const token = swapToken;
    stage.classList.remove("is-swapping");
    void stage.offsetWidth;
    stage.classList.add("is-swapping");
    window.setTimeout(() => {
      if (token === swapToken) stage.classList.remove("is-swapping");
    }, 240);
  };
  const restore = () => {
    current = null;
    related.querySelectorAll(".pixofix-related-card").forEach(card => card.classList.remove("is-active"));
    image.src = color.swatchUrl;
    title.textContent = color.name;
    stage.classList.remove("is-preview", "is-swapping");
    if (live) live.textContent = "";
  };
  related.addEventListener("pointermove", event => {
    show(event.target.closest(".pixofix-related-card"));
  });
  related.querySelectorAll("[data-pixofix-color]").forEach(button => {
    button.onfocus = () => show(button);
    button.onclick = () => renderPixofixDetail(button.dataset.pixofixColor);
  });
  related.onmouseleave = () => {
    if (related.contains(document.activeElement)) return;
    restore();
  };
  related.addEventListener("focusout", event => {
    if (!related.contains(event.relatedTarget)) restore();
  });
}

function renderPixofixDetail(colorId) {
  const color = (state.pixofixColors || []).find(item => item.id === colorId);
  if (!color) return renderPixofixLibrary();
  state.view = "pixofix";
  state.pixofixColorId = colorId;
  syncAppRoute();
  page("SWATCHES", color.name, PIXOFIX_PROFILE_NOTE, '<button id="backToPixofix" class="secondary" type="button">← Explore swatches</button>');
  $("#content").removeAttribute("aria-busy");
  const shadeId = shadeIdForColor(color);
  const family = (globalThis.COLOR_SHADES || []).find(item => item.id === shadeId);
  const rgb = pixofixRgb(color.hexCode);
  const familyMarkup = family ? `<p class="pixofix-family"><span class="shade-dot" style="${typeof shadeDotStyle === "function" ? shadeDotStyle(family.dot) : `--shade-dot:${family.dot}`}"></span>${esc(family.label)}</p>` : "";
  const stageClass = `pixofix-stage${color.saved ? " is-saved" : ""}`;
  const deleteMarkup = state.user.role === "ADMIN" ? `<button id="deletePixofixColor" class="secondary pixofix-delete-swatch" type="button" data-pixofix-delete="${esc(color.id)}">Delete swatch</button>` : "";
  const specHead = familyMarkup || deleteMarkup ? `<div class="pixofix-spec-head">${familyMarkup}</div>` : "";
  const hexCopy = `<button id="copyPixofixHex" class="pixofix-hex-copy" type="button" data-pixofix-copy="${esc(color.hexCode)}" aria-label="Copy hex ${esc(color.hexCode)}">${pixofixCopyIcon(`${color.id}-hex`)}<span class="pixofix-hex-copy-label">Copy</span></button>`;
  const profile = esc(color.profile || PIXOFIX_PROFILE_NOTE);
  const canRequest = state.user.role === "CLIENT" || state.user.selectedClientId;
  const requestAction = canRequest ? '<button id="requestPixofixColor" class="primary pixofix-request-color" type="button">Request this color</button>' : "";
  $("#content").innerHTML = `<article class="pixofix-detail"><figure class="${stageClass}"${pixofixSwatchBackground(color.hexCode)}><img src="${esc(color.swatchUrl)}" alt="" width="640" height="640" decoding="async"><figcaption class="pixofix-stage-name"><span class="pixofix-preview-label">Preview</span><span class="pixofix-stage-title-row"><span class="pixofix-stage-title">${esc(color.name)}</span>${pixofixActions(color, true)}</span></figcaption></figure><section class="pixofix-spec" aria-label="${esc(color.name)} values">${specHead}${deleteMarkup}<dl class="pixofix-facts"><div><dt>Profile</dt><dd>${profile}</dd></div><div><dt>Hex</dt><dd class="pixofix-hex-line"><span class="pixofix-hex">${esc(color.hexCode)}</span>${hexCopy}</dd></div>${rgb ? `<div><dt>Adobe RGB</dt><dd>${esc(rgb)}</dd></div>` : ""}</dl>${requestAction}${pixofixRelatedMarkup(color)}</section><p class="pixofix-live" aria-live="polite"></p></article>`;
  bindPixofixPreview(color);
  bindPixofixActions($("#content"));
  if ($("#requestPixofixColor")) $("#requestPixofixColor").onclick = () => openColorRequestForm(color);
  $("#backToPixofix").onclick = () => {
    state.pixofixColorId = null;
    syncAppRoute();
    const addButton = state.user.role === "ADMIN" ? '<button id="addPixofixColor" class="primary" type="button">Add color</button>' : "";
    page("SWATCHES", "Explore swatches", "A shared set of flat Adobe RGB (1998) swatches. Every client can view it.", addButton);
    bindAddPixofixColor();
    drawPixofixColors();
  };
}
