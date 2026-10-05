import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("client updates are available from project management and the client portal", () => {
  const layout = readFileSync(new URL("../../src/Layout.jsx", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("../../src/pages/PMProjectWorkspace.jsx", import.meta.url), "utf8");
  const portal = readFileSync(new URL("../../src/pages/ClientPortal.jsx", import.meta.url), "utf8");
  const delivery = readFileSync(new URL("../../src/components/client-updates/ClientUpdateDeliveryDialog.jsx", import.meta.url), "utf8");

  assert.match(layout, /name: "Client Updates"[\s\S]*section: "pm"/);
  assert.match(workspace, /value: "client-updates", label: "Client Updates"/);
  assert.match(portal, /get_client_portal_updates/);
  assert.match(portal, /TabsContent value="updates"/);
  assert.match(delivery, /document_type: "client_update"/);
  assert.match(delivery, /generateClientUpdatePDF/);
});

test("the client update project dropdown identifies the linked client", () => {
  const form = readFileSync(new URL("../../src/components/client-updates/ClientUpdateFormDialog.jsx", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("../../src/components/client-updates/ClientUpdatesWorkspace.jsx", import.meta.url), "utf8");

  assert.match(form, /project\.client_name/);
  assert.match(workspace, /client_name: clientById\[project\.client_id\]\?\.name/);
});

test("the mobile client-update form keeps a large close control visible above its scroll area", () => {
  const form = readFileSync(new URL("../../src/components/client-updates/ClientUpdateFormDialog.jsx", import.meta.url), "utf8");
  const dialog = readFileSync(new URL("../../src/components/ui/dialog.jsx", import.meta.url), "utf8");

  assert.match(dialog, /closeButtonClassName/);
  assert.match(form, /flex max-h-\[92dvh\][\s\S]*overflow-hidden/);
  assert.match(form, /closeButtonClassName="[^"]*h-11 w-11/);
  assert.match(form, /DialogHeader className="[^"]*pt-7/);
  assert.match(form, /overflow-y-auto px-5/);
});

test("large client-update fields offer safe AI rewriting and responsive resizing", () => {
  const form = readFileSync(new URL("../../src/components/client-updates/ClientUpdateFormDialog.jsx", import.meta.url), "utf8");
  const field = readFileSync(new URL("../../src/components/shared/AIRewriteTextarea.jsx", import.meta.url), "utf8");

  assert.equal((form.match(/<AIRewriteTextarea/g) || []).length, 4);
  for (const name of ["project_summary", "completed_work", "upcoming_work", "client_notes"]) {
    assert.match(form, new RegExp(`rewriteField="${name}"`));
  }
  assert.match(field, /functions\.invoke\("rewrite-text"/);
  assert.match(field, /AI Rewrite/);
  assert.match(field, /Undo/);
  assert.match(field, /Expand/);
  assert.match(field, /Collapse/);
  assert.match(field, /resize-none[^"]*sm:resize-y/);
  assert.match(field, /max-h-\[60dvh\]/);
});

test("large textareas across the app inherit the shared rewrite and expansion UX", () => {
  const textarea = readFileSync(new URL("../../src/components/ui/textarea.jsx", import.meta.url), "utf8");
  const policy = readFileSync(new URL("../../src/lib/aiRewrite.js", import.meta.url), "utf8");
  const base = readFileSync(new URL("../../src/components/ui/textarea-base.jsx", import.meta.url), "utf8");

  assert.match(textarea, /shouldUseWritingTools/);
  assert.match(textarea, /AIRewriteTextarea/);
  assert.match(textarea, /rewriteField = "general_business_text"/);
  assert.match(policy, /Number\(rows\) >= 3/);
  assert.match(policy, /Number\(maxLength\) >= 1000/);
  assert.equal((base.match(/<textarea/g) || []).length, 1);
});

test("quote line-item descriptions and internal notes explicitly enable writing tools", () => {
  const lineItem = readFileSync(new URL("../../src/components/quotes/LineItemRow.jsx", import.meta.url), "utf8");

  assert.equal((lineItem.match(/writingTools/g) || []).length, 2);
  assert.match(lineItem, /<Textarea\s+writingTools\s+value={localDesc}/);
  assert.match(lineItem, /<Textarea\s+writingTools\s+value={localNotes}/);
});

test("client update View opens a mobile-safe authenticated page in a new tab", () => {
  const workspace = readFileSync(new URL("../../src/components/client-updates/ClientUpdatesWorkspace.jsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../../src/pages/ClientUpdateView.jsx", import.meta.url), "utf8");
  const app = readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");

  assert.match(workspace, /href={`\/ClientUpdateView\?id=\$\{encodeURIComponent\(update\.id\)\}`}/);
  assert.match(workspace, /target="_blank"/);
  assert.match(workspace, /rel="noopener noreferrer"/);
  assert.match(app, /path="\/ClientUpdateView"[\s\S]*<ClientUpdateView/);
  assert.match(page, /eq\("company_id", companyId\)/);
  assert.match(page, /to="\/ClientUpdates"/);
  assert.match(page, /Back to Client Updates/);
  assert.match(page, /pt-\[env\(safe-area-inset-top\)\]/);
  assert.match(page, /sticky top-0 z-30/);
});
