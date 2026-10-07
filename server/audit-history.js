const TITLES = {
  "APPROVE|color_request": "Approved a color request",
  "COMMENT|color_request": "Commented on a color request",
  "UPLOAD|color_request": "Uploaded a reference",
  "REQUEST_CHANGES|color_request": "Requested changes",
  "CREATE|color_request": "Created a color request",
  "WITHDRAW|color_request": "Withdrew a delivery",
  "GOOGLE_LOGIN|session": "Signed in with Google",
  "LOGIN|session": "Signed in",
  "CREATE|user": "Added a representative",
  "UPDATE|user": "Updated a representative",
  "CREATE|client": "Created a client library",
  "UPDATE|client": "Updated a client library",
  "COMMENT|client": "Commented on a client library",
  "CREATE|color": "Created a color",
  "UPDATE|color": "Updated a color",
  "ARCHIVE|color": "Archived a color",
  "UNARCHIVE|color": "Restored a color",
  "DELETE|color": "Deleted a color",
  "UPLOAD|reference_version": "Uploaded a reference",
  "APPROVE|reference_version": "Approved a reference",
  "UNAPPROVE|reference_version": "Removed reference approval",
  "UPDATE|reference_version": "Updated a reference",
  "REMOVE|reference_version": "Removed a reference",
  "UPDATE|color_reference": "Updated reference details",
  "DELETE|color_reference": "Deleted a reference",
  "CREATE|color_edit_request": "Requested a color edit",
  "START|color_edit_request": "Started a color edit",
  "ACCEPT|color_edit_request": "Accepted a color edit",
  "REJECT|color_edit_request": "Rejected a color edit",
  "COMPLETE|color_edit_request": "Completed a color edit",
  "CREATE|user_access_request": "Requested access",
  "RESOLVE|user_access_request": "Reviewed an access request",
  "CREATE|pixofix_color": "Added a swatch",
  "DELETE|pixofix_color": "Removed a swatch"
};

const RECORD_LABELS = {
  color_request: "color request",
  color: "color",
  reference_version: "reference",
  color_reference: "reference",
  color_edit_request: "edit request",
  session: "sign-in",
  user: "representative",
  client: "client library",
  user_access_request: "access request",
  pixofix_color: "swatch"
};

function textValue(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function storedName(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  return textValue(data.colorName, data.proposedName, data.displayName, data.name, data.email);
}

function withClient(path, clientId) {
  const id = textValue(clientId);
  if (!id) return path;
  return `${path}${path.includes("?") ? "&" : "?"}client=${encodeURIComponent(id)}`;
}

function fragment(path, hash) {
  return hash ? `${path}#${hash}` : path;
}

function auditParty(role) {
  if (role === "ADMIN") return "admin";
  if (role === "CLIENT") return "client";
  return "system";
}

function auditRecordGroup(entityType) {
  if (entityType === "color_request") return "requests";
  if (["color", "reference_version", "color_reference", "color_edit_request"].includes(entityType)) return "colors";
  if (["session", "user", "user_access_request"].includes(entityType)) return "access";
  if (entityType === "client") return "libraries";
  if (entityType === "pixofix_color") return "swatches";
  return "other";
}

function auditTitle(action, entityType) {
  const specific = TITLES[`${action}|${entityType}`];
  if (specific) return specific;
  const verb = textValue(action).toLowerCase().replace(/_/g, " ") || "updated";
  const record = RECORD_LABELS[entityType] || "record";
  return `${verb.charAt(0).toUpperCase()}${verb.slice(1)} ${record}`;
}

function colorTarget(row, colorId, colorName, archivedAt) {
  const clientId = row.client_id;
  const subject = textValue(colorName, storedName(row.after_data), storedName(row.before_data), row.client_code);
  const archived = Boolean(archivedAt) || row.action === "ARCHIVE" || row.action === "DELETE";
  if (!textValue(colorId)) {
    return {
      href: clientId ? withClient(archived ? "/archived" : "/library", clientId) : (archived ? "/archived" : "/clients"),
      destination: archived ? "Open archived colors" : (clientId ? "Open library" : "Open clients"),
      subject
    };
  }
  if (archived) {
    return { href: withClient("/archived", clientId), destination: "Open archived colors", subject };
  }
  const hash = row.entity_type === "reference_version" || row.entity_type === "color_reference" ? "references" : "";
  return {
    href: fragment(withClient(`/colors/${encodeURIComponent(colorId)}`, clientId), hash),
    destination: "Open color",
    subject: textValue(colorName, storedName(row.after_data), storedName(row.before_data))
  };
}

function auditTarget(row) {
  const type = row.entity_type;
  const clientId = row.client_id;
  if (type === "color_request") {
    return {
      href: fragment(withClient(`/requests/${encodeURIComponent(row.entity_id)}`, clientId), "activity"),
      destination: "Open request",
      subject: textValue(row.request_subject, storedName(row.after_data), row.client_code, "Color request")
    };
  }
  if (type === "color") return colorTarget(row, row.entity_id, row.color_name, row.color_archived_at);
  if (type === "color_reference") return colorTarget(row, row.reference_color_id, row.reference_color_name, row.reference_color_archived_at);
  if (type === "reference_version") return colorTarget(row, row.version_color_id, row.version_color_name, row.version_color_archived_at);
  if (type === "color_edit_request") return colorTarget(row, row.edit_color_id, row.edit_color_name, row.edit_color_archived_at);
  if (type === "pixofix_color") {
    const name = textValue(row.pixofix_name, storedName(row.after_data), storedName(row.before_data));
    if (row.action === "DELETE" || !name) return { href: "/pixofix", destination: "Open swatches", subject: name || "Swatch" };
    return { href: `/pixofix/${encodeURIComponent(row.entity_id)}`, destination: "Open swatch", subject: name };
  }
  if (type === "client") {
    const id = textValue(row.entity_id, clientId);
    return {
      href: withClient("/profile", id),
      destination: "Open profile",
      subject: textValue(row.client_name, row.client_code, storedName(row.after_data), "Client library")
    };
  }
  if (type === "user" || type === "session") {
    const profileClient = textValue(clientId, row.subject_user_client_id);
    const person = textValue(row.subject_user_name, storedName(row.after_data), storedName(row.before_data), row.actor_name);
    if (profileClient && row.entity_id) {
      return {
        href: fragment(withClient("/profile", profileClient), `person-${encodeURIComponent(row.entity_id)}`),
        destination: "Open profile",
        subject: type === "session" ? textValue(row.client_name, row.client_code, person, "Sign-in") : textValue(person, "Representative")
      };
    }
    return { href: "/clients", destination: "Open clients", subject: textValue(person, "Sign-in") };
  }
  if (type === "user_access_request") {
    const profileClient = textValue(clientId, row.access_client_id);
    const person = textValue(row.access_name, storedName(row.after_data), "Access request");
    if (profileClient && row.entity_id) {
      return {
        href: fragment(withClient("/profile", profileClient), `access-${encodeURIComponent(row.entity_id)}`),
        destination: "Open profile",
        subject: person
      };
    }
    return { href: profileClient ? withClient("/profile", profileClient) : "/clients", destination: profileClient ? "Open profile" : "Open clients", subject: person };
  }
  return {
    href: clientId ? withClient("/library", clientId) : "/clients",
    destination: clientId ? "Open library" : "Open clients",
    subject: textValue(row.client_name, row.client_code, RECORD_LABELS[type], "Record")
  };
}

function presentAuditEvent(row) {
  const target = auditTarget(row);
  const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at;
  return {
    id: String(row.id),
    createdAt,
    created_at: createdAt,
    action: row.action,
    entityType: row.entity_type,
    entity_type: row.entity_type,
    entityId: row.entity_id,
    clientCode: textValue(row.client_code),
    client_code: textValue(row.client_code),
    clientName: textValue(row.client_name),
    actorEmail: textValue(row.actor_email),
    actor_email: textValue(row.actor_email),
    actorName: textValue(row.actor_name),
    actorRole: textValue(row.actor_role),
    party: auditParty(row.actor_role),
    title: auditTitle(row.action, row.entity_type),
    subject: target.subject,
    recordGroup: auditRecordGroup(row.entity_type),
    href: target.href,
    destination: target.destination
  };
}

module.exports = { presentAuditEvent, auditParty, auditTitle, auditRecordGroup };
