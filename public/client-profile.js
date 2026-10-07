function adminOpenProfile(clientId) {
  const listed = (state.clients || []).find(client => client.id === clientId);
  if (listed) rememberSelectedClient(listed);
  state.user = { ...state.user, selectedClientId: clientId };
  state.view = "profile";
  return renderClientProfile();
}

function profileStatus(title, message, role, action) {
  return `<section class="panel profile-status" role="${role}"><strong>${esc(title)}</strong><p>${esc(message)}</p>${action || ""}</section>`;
}

async function renderClientProfile() {
  const admin = state.user.role === "ADMIN";
  if (admin && !state.user.selectedClientId) {
    state.view = "clients";
    nav(workspaceNav());
    return renderClients();
  }
  state.view = "profile";
  syncAppRoute();
  nav(workspaceNav());
  page("PROFILE", "Company profile", admin ? "Manage the Gmail accounts authorized for this client." : "View your company and its authorized representatives.", "");
  $("#content").setAttribute("aria-busy", "true");
  $("#content").innerHTML = profileStatus("Loading company profile", "Fetching authorized representatives and access requests.", "status");
  const url = admin ? `/api/admin/clients/${encodeURIComponent(state.user.selectedClientId)}/profile` : "/api/client/profile";
  try {
    drawClientProfile(await api(url), admin);
  } catch (error) {
    page("PROFILE", "Company profile", "The profile could not be loaded.", "");
    $("#content").innerHTML = profileStatus("Could not load profile", error.message || "Try again.", "alert", '<button id="retryProfile" class="secondary" type="button">Try again</button>');
    $("#retryProfile").onclick = () => renderClientProfile();
  } finally {
    $("#content").removeAttribute("aria-busy");
  }
}

function drawClientProfile(profile, admin) {
  syncSelectedClientNav(profile.client);
  const people = profile.users || [];
  const requests = profile.requests || [];
  const pendingRequests = requests.filter(request => request.status === "PENDING");
  const reviewedRequests = requests.filter(request => request.status !== "PENDING");
  const activeCount = people.filter(person => person.active).length;
  const connectedCount = people.filter(person => person.googleConnected).length;
  page(
    profile.client.code,
    profile.client.name,
    admin ? "Manage the Gmail accounts authorized for this client." : "Your company profile and authorized representatives.",
    ""
  );
  const pendingStat = admin ? `<div class="stat"><strong>${pendingRequests.length}</strong><span>Pending requests</span></div>` : "";
  const addRepresentative = admin ? `<button id="addPerson" class="primary profile-add" type="button">Add representative</button>` : "";
  const stats = `<section class="stats"><div class="stat"><strong>${people.length}</strong><span>Representatives</span></div><div class="stat"><strong>${activeCount}</strong><span>Authorized</span></div><div class="stat"><strong>${connectedCount}</strong><span>Google connected</span></div>${pendingStat}</section>`;
  const peopleMarkup = people.length
    ? people.map(person => profilePersonMarkup(person, admin)).join("")
    : '<div class="panel empty">No representatives have been authorized yet.</div>';
  const requestMarkup = admin
    ? `<section class="profile-section"><div class="profile-section-heading"><div><p class="eyebrow">ACCESS CONTROL</p><h3>Pending requests</h3></div><span>${pendingRequests.length}</span></div><div class="profile-requests">${pendingRequests.length ? pendingRequests.map(profileRequestMarkup).join("") : '<div class="panel workflow-empty workflow-empty-compact"><span class="workflow-empty-icon" aria-hidden="true">✓</span><h3>No pending requests</h3><p>New representative requests will appear here for review.</p></div>'}</div></section><section class="profile-section profile-access-history"><div class="profile-section-heading"><div><p class="eyebrow">REVIEW HISTORY</p><h3>Reviewed requests</h3></div><span>${reviewedRequests.length}</span></div><div class="profile-requests">${reviewedRequests.length ? reviewedRequests.map(profileClientRequestMarkup).join("") : '<div class="panel workflow-empty workflow-empty-compact"><span class="workflow-empty-icon" aria-hidden="true">↻</span><h3>No review history yet</h3><p>Authorized and dismissed requests will remain visible here.</p></div>'}</div></section>`
    : `<section class="profile-client-grid"><form id="requestPerson" class="panel profile-request-form"><div class="profile-form-heading"><p class="eyebrow">NEW REPRESENTATIVE</p><h3>Request access for a colleague</h3><p class="muted">Pixofix will verify the request before this Google account can sign in.</p></div><label><span>Full name <abbr class="required-mark" title="Required">*</abbr></span><input name="displayName" required maxlength="120" autocomplete="name" placeholder="e.g. Karim Rahman"></label><label><span>Google email address <abbr class="required-mark" title="Required">*</abbr></span><input name="email" type="email" required maxlength="320" autocomplete="email" placeholder="name@company.com"><small class="field-hint">Use the exact address they use with Google.</small></label><label><span>Reason or role <small class="optional-label">Optional</small></span><textarea name="note" maxlength="500" placeholder="For example: Color reviewer for the apparel team"></textarea></label><p id="requestPersonError" class="profile-error" role="alert" hidden></p><div class="profile-actions"><button id="requestPersonSubmit" class="primary" type="submit">Send access request</button></div></form><section class="profile-section profile-access-history"><div class="profile-section-heading"><div><p class="eyebrow">REQUEST HISTORY</p><h3>Access requests</h3></div><span>${requests.length}</span></div><div class="profile-requests">${requests.length ? requests.map(profileClientRequestMarkup).join("") : '<div class="panel workflow-empty workflow-empty-compact"><span class="workflow-empty-icon" aria-hidden="true">@</span><h3>No access requests yet</h3><p>Requests you send will appear here with their review status.</p></div>'}</div></section></section>`;
  $("#content").innerHTML = `${stats}<section id="profilePeople" class="profile-section"><div class="profile-section-heading"><div><p class="eyebrow">AUTHORIZED GMAILS</p><h3>Representatives</h3></div>${addRepresentative}</div><div class="profile-people">${peopleMarkup}</div></section>${requestMarkup}`;
  focusLinkedProfileTarget();
  if (admin) bindAdminProfile(profile);
  else bindClientProfileRequest();
}

function focusLinkedProfileTarget() {
  const raw = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  if (!raw) return;
  let id = raw;
  try { id = decodeURIComponent(raw); } catch (_error) {}
  const node = document.getElementById(id);
  if (!node) return;
  node.classList.add("is-linked");
  node.scrollIntoView({ block: "center" });
}

function profilePersonMarkup(person, admin) {
  const accessLabel = person.active ? "Authorized" : "Access paused";
  const googleLabel = person.googleConnected ? "Google connected" : "First sign-in pending";
  const lastSeen = person.lastLoginAt ? `Last sign-in ${relativeDate(person.lastLoginAt)}` : "Has not signed in yet";
  const lastSeenTitle = person.lastLoginAt ? date(person.lastLoginAt) : "";
  const actions = admin
    ? `<div class="profile-actions"><button class="secondary" type="button" data-edit-person="${esc(person.id)}">Edit</button><button class="secondary${person.active ? " danger" : ""}" type="button" data-person-active="${esc(person.id)}" data-next-active="${person.active ? "false" : "true"}">${person.active ? "Pause access" : "Restore access"}</button></div>`
    : "";
  return `<article id="person-${esc(person.id)}" class="panel profile-person"><span class="profile-avatar" aria-hidden="true">${esc(String(person.displayName || person.email).slice(0, 1).toUpperCase())}</span><div class="profile-person-copy"><h3>${esc(person.displayName)}</h3><p class="card-meta">${esc(person.email)}</p><small title="${esc(lastSeenTitle)}">${esc(lastSeen)}</small></div><div class="profile-meta"><span class="pill ${person.active ? "" : "inactive"}">${accessLabel}</span><span class="pill ${person.googleConnected ? "" : "waiting"}">${googleLabel}</span></div>${actions}</article>`;
}

function profileRequestMarkup(request) {
  const asked = request.requestedBy ? `Requested by ${request.requestedBy} · ${relativeDate(request.createdAt)}` : relativeDate(request.createdAt);
  return `<article id="access-${esc(request.id)}" class="panel profile-request"><div><h3>${esc(request.displayName)}</h3><p class="card-meta">${esc(request.email)}</p><p class="card-meta">${esc(asked)}</p>${request.note ? `<p class="profile-note">${esc(request.note)}</p>` : ""}</div><div class="profile-actions"><button class="primary" type="button" data-resolve-request="${esc(request.id)}" data-resolve-status="AUTHORIZED">Authorize Gmail</button><button class="secondary" type="button" data-resolve-request="${esc(request.id)}" data-resolve-status="DISMISSED">Dismiss</button></div></article>`;
}

function profileClientRequestMarkup(request) {
  const label = ({ PENDING: "Pending review", AUTHORIZED: "Authorized", DISMISSED: "Dismissed" })[request.status] || request.status;
  const requester = request.requestedBy ? ` by ${esc(request.requestedBy)}` : "";
  const reviewer = request.resolvedBy ? ` · Reviewed by ${esc(request.resolvedBy)}` : "";
  return `<article id="access-${esc(request.id)}" class="panel profile-request profile-request-compact"><div><h3>${esc(request.displayName)}</h3><p class="card-meta">${esc(request.email)}</p><small title="${esc(date(request.createdAt))}">Requested ${esc(relativeDate(request.createdAt))}${requester}${reviewer}</small>${request.note ? `<p class="profile-note">${esc(request.note)}</p>` : ""}</div><span class="pill ${String(request.status || "").toLowerCase()}">${esc(label)}</span></article>`;
}

function bindAdminProfile(profile) {
  $("#addPerson").onclick = () => openAddPerson(profile);
  document.querySelectorAll("[data-edit-person]").forEach(button => {
    button.onclick = () => openEditPerson(profile, profile.users.find(person => person.id === button.dataset.editPerson));
  });
  document.querySelectorAll("[data-person-active]").forEach(button => {
    button.onclick = () => setPersonActive(button, profile);
  });
  document.querySelectorAll("[data-resolve-request]").forEach(button => {
    button.onclick = () => resolveAccessRequest(button, profile);
  });
}

function personFields(person = {}) {
  return `<label>Name<input name="displayName" value="${esc(person.displayName || "")}" required maxlength="120" autocomplete="name"></label><label>Authorized Gmail<input name="email" value="${esc(person.email || "")}" type="email" required maxlength="320" autocomplete="email"></label><p class="profile-security-copy">Only this exact Google account can sign in. Changing the email disconnects the previous Google identity and signs it out.</p>`;
}

function openAddPerson(profile) {
  openModal({
    eyebrow: profile.client.code,
    title: "Add representative",
    submit: "Authorize Gmail",
    body: personFields(),
    onSubmit: async form => {
      await api(`/api/admin/clients/${encodeURIComponent(profile.client.id)}/users`, {
        method: "POST",
        body: JSON.stringify({ displayName: String(form.get("displayName") || "").trim(), email: String(form.get("email") || "").trim() })
      });
      toast("Representative authorized");
      await renderClientProfile();
    }
  });
}

function openEditPerson(profile, person) {
  if (!person) return;
  openModal({
    eyebrow: profile.client.code,
    title: "Edit representative",
    submit: "Save changes",
    body: personFields(person),
    onSubmit: async form => {
      await api(`/api/admin/users/${encodeURIComponent(person.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ displayName: String(form.get("displayName") || "").trim(), email: String(form.get("email") || "").trim() })
      });
      toast("Representative updated");
      await renderClientProfile();
    }
  });
}

async function setPersonActive(button, profile) {
  const next = button.dataset.nextActive === "true";
  const person = (profile.users || []).find(item => item.id === button.dataset.personActive);
  if (!next) {
    const confirmed = await confirmAction({
      eyebrow: profile.client.code,
      title: `Pause access for ${person?.displayName || "this person"}?`,
      message: "Their active sessions will end and this Gmail will not be able to sign in until access is restored.",
      confirmLabel: "Pause access",
      tone: "danger"
    });
    if (!confirmed) return;
  }
  button.disabled = true;
  try {
    await api(`/api/admin/users/${encodeURIComponent(button.dataset.personActive)}/active`, { method: "POST", body: JSON.stringify({ active: next }) });
    toast(next ? "Access restored" : "Access paused");
    await renderClientProfile();
  } catch (error) {
    toast(error.message || "Could not update access");
    button.disabled = false;
  }
}

async function resolveAccessRequest(button, profile) {
  const status = button.dataset.resolveStatus;
  const buttons = [...button.closest(".profile-request").querySelectorAll("button")];
  buttons.forEach(item => { item.disabled = true; });
  try {
    await api(`/api/admin/clients/${encodeURIComponent(profile.client.id)}/access-requests/${encodeURIComponent(button.dataset.resolveRequest)}/resolve`, {
      method: "POST",
      body: JSON.stringify({ status })
    });
    toast(status === "AUTHORIZED" ? "Gmail authorized" : "Request dismissed");
    await renderClientProfile();
  } catch (error) {
    toast(error.message || "Could not update this request");
    buttons.forEach(item => { item.disabled = false; });
  }
}

function bindClientProfileRequest() {
  const form = $("#requestPerson");
  if (!form) return;
  form.onsubmit = async event => {
    event.preventDefault();
    const button = $("#requestPersonSubmit");
    const errorBox = $("#requestPersonError");
    const data = Object.fromEntries(new FormData(form));
    errorBox.hidden = true;
    button.disabled = true;
    button.textContent = "Sending…";
    try {
      await api("/api/client/profile/access-requests", {
        method: "POST",
        body: JSON.stringify({ displayName: String(data.displayName || "").trim(), email: String(data.email || "").trim(), note: String(data.note || "").trim() })
      });
      toast("Access request sent to the administrator");
      await renderClientProfile();
    } catch (error) {
      errorBox.textContent = error.message || "Could not send this request";
      errorBox.hidden = false;
      button.disabled = false;
      button.textContent = "Send access request";
    }
  };
}
