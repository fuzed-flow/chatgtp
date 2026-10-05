export const WORKFLOW_BUTTON = "min-h-11 bg-amber-500 text-slate-900 hover:bg-amber-600";

export function workflowRecordId(value) {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value || "") ? value : null;
}

export function workflowToken(search) {
  const token = new URLSearchParams(search).get("token") || "";
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}

export function workflowDate(value, timezone) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return "Not scheduled";
  try {
    return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", ...(timezone ? { timeZone: timezone } : {}) }).format(date);
  } catch {
    return date.toLocaleString("en-CA");
  }
}

export function safeDocumentUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function workflowLink(kind, token) {
  if (!/^[a-f0-9]{64}$/.test(token || "")) return null;
  return `https://app.fuzedflow.com/${kind === "warranty" ? "WarrantyResponse" : "DocumentResponse"}?token=${token}`;
}

export async function fileChecksum(file) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

export function localDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
