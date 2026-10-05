import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildQuoteApprovalRows, matchesApprovalSearch, pendingTotal, quotePublicUrl } from "../../src/lib/approvalHub.js";

test("sent quotes appear without a legacy quote approval row", () => {
  const [row] = buildQuoteApprovalRows([{ id: "quote-one", status: "Sent", title: "Kitchen", created_at: "2026-10-01" }]);
  assert.equal(row.id, "quote-one");
  assert.equal(row.approval_status, "Sent");
});

test("client views and final quote decisions produce the useful hub status", () => {
  const rows = buildQuoteApprovalRows([
    { id: "viewed", status: "Sent", created_at: "2026-10-01" },
    { id: "approved", status: "Approved", signed_at: "2026-10-03" },
    { id: "draft", status: "Draft" },
    { id: "template", status: "Sent", is_template: true },
  ], [], [{ quote_id: "viewed", viewed_at: "2026-10-02", viewer_type: "client" }]);
  assert.deepEqual(rows.map(row => [row.id, row.approval_status]), [["approved", "Approved"], ["viewed", "Viewed"]]);
});

test("the latest legacy send record is attached without duplicating a quote", () => {
  const [row] = buildQuoteApprovalRows([{ id: "q", status: "Sent" }], [
    { id: "old", quote_id: "q", sent_at: "2026-10-01" },
    { id: "new", quote_id: "q", sent_at: "2026-10-02" },
  ]);
  assert.equal(row.approval_id, "new");
});

test("approval utilities use the live public quote route and safe numeric totals", () => {
  assert.equal(quotePublicUrl("https://app.fuzedflow.com", "quote id"), "https://app.fuzedflow.com/PublicQuoteView?id=quote+id");
  assert.equal(matchesApprovalSearch(["LBProjects", "Q-100"], "q-100"), true);
  assert.equal(pendingTotal([{ status: "Pending Approval", total: 10 }, { status: "Draft", total: 90 }], ["Pending Approval"]), 10);
});

test("internal reviews and document requests stay hidden from workspace navigation", () => {
  const approvals = readFileSync(new URL("../../src/pages/Approvals.jsx", import.meta.url), "utf8");
  const layout = readFileSync(new URL("../../src/Layout.jsx", import.meta.url), "utf8");
  const approvalViews = approvals.match(/const VIEWS = \[([\s\S]*?)\];/)?.[1] || "";
  const navigationItems = layout.match(/const NAV_ITEMS = \[([\s\S]*?)\];/)?.[1] || "";

  assert.doesNotMatch(approvalViews, /internal_reviews|Internal reviews/);
  assert.doesNotMatch(approvals, /activeView === "internal_reviews"/);
  assert.doesNotMatch(navigationItems, /Document Requests|DocumentRequests/);
});
