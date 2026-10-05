export function linesToItems(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map(item => item.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 50);
}

export function itemsToLines(items) {
  return (Array.isArray(items) ? items : []).join("\n");
}

export function matchesClientUpdate(update, project, client, search) {
  const term = String(search || "").trim().toLowerCase();
  if (!term) return true;
  return [
    update?.title,
    update?.summary,
    update?.client_notes,
    ...(update?.completed_work || []),
    ...(update?.upcoming_work || []),
    project?.name,
    project?.project_number,
    client?.name,
  ].some(value => String(value || "").toLowerCase().includes(term));
}

export function escapeEmailHtml(value) {
  return String(value || "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]);
}

export function clientUpdatePortalUrl(origin, clientId, updateId) {
  const url = new URL("/ClientPortal", origin);
  url.searchParams.set("id", clientId);
  url.searchParams.set("tab", "updates");
  if (updateId) url.searchParams.set("update", updateId);
  return url.toString();
}
