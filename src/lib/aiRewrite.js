const LARGE_HEIGHT = /(?:min-h|h)-\[(?:8\d|[1-9]\d{2,})px\]|(?:min-h|h)-(?:20|24|28|32|36|40|44|48|52|56|60|64|72|80|96)(?:\s|$)/;

export function shouldUseWritingTools({ writingTools, rows, maxLength, className, value, onChange }) {
  if (writingTools === false) return false;
  if (writingTools === true) return typeof value === "string" && typeof onChange === "function";
  if (typeof value !== "string" || typeof onChange !== "function") return false;
  return Number(rows) >= 3 || Number(maxLength) >= 1000 || LARGE_HEIGHT.test(`${className || ""} `);
}

export function canAttemptAIRewrite({ user, company }) {
  if (!user) return false;
  const plan = String(company?.plan_id || company?.subscription_tier || "").toLowerCase();
  const status = String(company?.subscription_status || "").toLowerCase();
  return ["professional", "business"].includes(plan) || ["active", "trialing", "past_due"].includes(status);
}

export function friendlyRetryDelay(seconds) {
  const value = Math.max(1, Number(seconds) || 60);
  if (value < 90) return "about a minute";
  if (value < 3600) return `about ${Math.ceil(value / 60)} minutes`;
  return `about ${Math.ceil(value / 3600)} hours`;
}

