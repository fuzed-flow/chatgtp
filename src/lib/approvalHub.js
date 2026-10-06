import { buildPublicQuoteUrl } from "./publicQuoteLinks.js";

const QUOTE_WORKFLOW_STATUSES = new Set(["Sent", "Viewed", "Pending", "Approved", "Declined", "Expired"]);
const QUOTE_FINAL_STATUSES = new Set(["Approved", "Declined", "Expired"]);

const timestamp = value => {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

function latestBy(rows, key, dateFields) {
  const result = new Map();
  for (const row of rows || []) {
    const id = row?.[key];
    if (!id) continue;
    const current = result.get(id);
    const rowTime = Math.max(...dateFields.map(field => timestamp(row?.[field])));
    const currentTime = current ? Math.max(...dateFields.map(field => timestamp(current?.[field]))) : -1;
    if (!current || rowTime >= currentTime) result.set(id, row);
  }
  return result;
}

export function buildQuoteApprovalRows(quotes = [], approvalEvents = [], quoteViews = []) {
  const latestApproval = latestBy(approvalEvents, "quote_id", ["signed_at", "viewed_at", "sent_at", "created_at"]);
  const latestView = latestBy(quoteViews, "quote_id", ["viewed_at"]);

  return quotes
    .filter(quote => !quote?.is_template && QUOTE_WORKFLOW_STATUSES.has(quote?.status))
    .map(quote => {
      const approval = latestApproval.get(quote.id);
      const view = latestView.get(quote.id);
      const viewedAt = view?.viewed_at || approval?.viewed_at || quote.viewed_at || null;
      const status = quote.status === "Pending"
        ? "Changes Requested"
        : QUOTE_FINAL_STATUSES.has(quote.status)
        ? quote.status
        : quote.status === "Viewed" || viewedAt ? "Viewed" : "Sent";
      const activityAt = QUOTE_FINAL_STATUSES.has(status)
        ? (status === "Approved" ? quote.signed_at || approval?.signed_at : null) || quote.updated_at || quote.created_at
        : status === "Changes Requested"
          ? quote.updated_at || approval?.created_at || quote.created_at
          : status === "Viewed"
          ? viewedAt
          : approval?.sent_at || quote.sent_at || quote.issue_date || quote.created_at;

      return {
        ...quote,
        approval_id: approval?.id || null,
        approval_token: approval?.approval_token || null,
        approval_status: status,
        signer_name: approval?.signer_name || null,
        sent_at: approval?.sent_at || quote.sent_at || null,
        viewed_at: viewedAt,
        signed_at: approval?.signed_at || quote.signed_at || null,
        activity_at: activityAt || quote.created_at || null,
      };
    })
    .sort((a, b) => timestamp(b.activity_at) - timestamp(a.activity_at));
}

export function quotePublicUrl(origin, quoteId, token) {
  if (!token) throw new Error("A secure quote token is required.");
  return buildPublicQuoteUrl(origin, quoteId, token);
}

export function matchesApprovalSearch(values, search) {
  const term = String(search || "").trim().toLowerCase();
  if (!term) return true;
  return values.some(value => String(value || "").toLowerCase().includes(term));
}

export function pendingTotal(rows, statuses, amountField = "total") {
  const allowed = new Set(statuses);
  return (rows || []).filter(row => allowed.has(row?.status))
    .reduce((sum, row) => sum + Number(row?.[amountField] || 0), 0);
}
