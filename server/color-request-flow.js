function refused(message) {
  const error = new Error(message);
  error.status = 409;
  throw error;
}

function categoryKey(delivery) {
  const kind = delivery.reference_kind || delivery.referenceKind || "FULL";
  const label = delivery.reference_label || delivery.referenceLabel || "";
  return `${kind}:${label}`;
}

function referenceCategory(kind, label) {
  const normalizedKind = String(kind || "FULL").trim().toUpperCase();
  if (!["FULL", "QUICK", "OTHER"].includes(normalizedKind)) return null;
  const normalizedLabel = normalizedKind === "OTHER"
    ? String(label || "").replace(/(?:\s+reference)+$/i, "").trim().toUpperCase()
    : "";
  if (normalizedKind === "OTHER" && !normalizedLabel) return null;
  return { kind: normalizedKind, label: normalizedLabel, key: `${normalizedKind}:${normalizedLabel}` };
}

function uploadDelivery(request, deliveries = [], category = "FULL:") {
  if (request.status === "APPROVED") refused("A delivery cannot be uploaded after the request is approved");
  if (!["AWAITING_DELIVERY", "IN_PROGRESS", "CHANGES_REQUESTED"].includes(request.status)) {
    refused("A delivery can be uploaded only while the request is open");
  }
  if (deliveries.some(delivery => delivery.status === "IN_REVIEW" && categoryKey(delivery) === category)) {
    refused("This reference already has a delivery waiting for review");
  }
  return { status: "IN_PROGRESS" };
}

function reviewDeliveries(deliveries) {
  return deliveries.filter(delivery => delivery.status === "IN_REVIEW");
}

function requestChanges(request, deliveries) {
  if (request.status !== "IN_PROGRESS") refused("Changes can be requested only while a reference is in review");
  const current = reviewDeliveries(deliveries);
  if (!current.length) refused("This request has no delivery waiting for review");
  const ids = new Set(current.map(delivery => delivery.id));
  return {
    status: "CHANGES_REQUESTED",
    deliveryId: current[0].id,
    deliveryIds: current.map(delivery => delivery.id),
    deliveries: deliveries.map(delivery => ids.has(delivery.id) ? { ...delivery, status: "NEEDS_CHANGES" } : delivery)
  };
}

function approveRequest(request, deliveries) {
  if (request.status !== "IN_PROGRESS") refused("A request can be approved only while it is in progress");
  const current = reviewDeliveries(deliveries);
  if (!current.length) refused("This request has no delivery waiting for review");
  const ids = new Set(current.map(delivery => delivery.id));
  return {
    status: "APPROVED",
    deliveryId: current[0].id,
    deliveryIds: current.map(delivery => delivery.id),
    deliveries: deliveries.map(delivery => ids.has(delivery.id) ? { ...delivery, status: "APPROVED" } : delivery)
  };
}

function commentPlacement(input = {}) {
  const hasX = input.pinX !== undefined && input.pinX !== null && input.pinX !== "";
  const hasY = input.pinY !== undefined && input.pinY !== null && input.pinY !== "";
  if (!hasX && !hasY) return { pinX: null, pinY: null };
  const pinX = Number(input.pinX);
  const pinY = Number(input.pinY);
  if (!hasX || !hasY || !Number.isFinite(pinX) || !Number.isFinite(pinY) || pinX < 0 || pinX > 100 || pinY < 0 || pinY > 100) {
    const error = new Error("Choose a point on the image");
    error.status = 400;
    throw error;
  }
  return { pinX: Math.round(pinX * 100) / 100, pinY: Math.round(pinY * 100) / 100 };
}

function withdrawDelivery(request, deliveries, deliveryId) {
  if (request.status !== "IN_PROGRESS") refused("A delivery can be withdrawn only while the request is in progress");
  const current = deliveries.find(delivery => delivery.id === deliveryId);
  if (!current || current.status !== "IN_REVIEW") refused("Only a delivery currently in review can be withdrawn");
  const remaining = deliveries.some(delivery => delivery.id !== deliveryId && delivery.status === "IN_REVIEW");
  return {
    status: remaining ? "IN_PROGRESS" : "AWAITING_DELIVERY",
    deliveryId,
    deliveries: deliveries.map(delivery => delivery.id === deliveryId ? { ...delivery, status: "WITHDRAWN" } : delivery)
  };
}

module.exports = { uploadDelivery, requestChanges, approveRequest, withdrawDelivery, referenceCategory, categoryKey, commentPlacement };
