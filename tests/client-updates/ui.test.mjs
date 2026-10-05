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
