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
