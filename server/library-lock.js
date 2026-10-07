function libraryEditBlock(role, editStatus) {
  if (role === "ADMIN" && editStatus === "IN_EDIT") return "";
  if (role !== "ADMIN") return "Approved colors can only be changed after an administrator accepts an edit request.";
  return "This color is locked. Accept an edit request before changing it.";
}

module.exports = { libraryEditBlock };
