import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("project closeouts are tenant-secured and expose only published portal records", async () => {
  const migration = await read("supabase/migrations/20261005063000_project_closeouts.sql");
  assert.match(migration, /alter table public\.project_closeouts enable row level security/i);
  assert.match(migration, /alter table public\.project_closeout_items enable row level security/i);
  assert.match(migration, /workflow_private\.staff_access\(company_id, project_id\)/i);
  assert.match(migration, /c\.status in \('Published','Completed'\)/i);
  assert.match(migration, /grant execute on function public\.get_client_portal_closeouts\(uuid\) to anon, authenticated/i);
});

test("onsite workflow supports quick capture, guided save-next, trade delivery and client delivery", async () => {
  const view = await read("src/pages/ProjectCloseoutView.jsx");
  const itemDialog = await read("src/components/closeouts/DeficiencyItemDialog.jsx");
  const delivery = await read("src/components/closeouts/ProjectCloseoutDeliveryDialog.jsx");
  assert.match(view, /mode: "quick"/);
  assert.match(view, /mode: "guided"/);
  assert.match(itemDialog, /Save photo & next/);
  assert.match(itemDialog, /Save & next/);
  assert.match(delivery, /Send to assigned subcontractors/);
  assert.match(delivery, /document_type: "project_closeout"/);
  assert.match(delivery, /generateProjectCloseoutPDF/);
});

test("closeout completion identifies blocking items and only enables a valid completion", async () => {
  const [view, migration] = await Promise.all([
    read("src/pages/ProjectCloseoutView.jsx"),
    read("supabase/migrations/20261005140002_project_closeout_completion_gate.sql"),
  ]);
  assert.match(view, /blockingItems = useMemo/);
  assert.match(view, /deficiencies are.*blocking completion/);
  assert.match(view, /Every deficiency must have a status of Complete/);
  assert.match(view, /disabled={!canComplete/);
  assert.match(migration, /status <> 'Complete'/);
  assert.match(migration, /Complete all deficiencies before marking the closeout complete/);
  assert.match(migration, /closeout_row\.status = 'Completed' and new\.status <> 'Complete'/);
});

test("closeout navigation exists globally, within a project, and in the client portal", async () => {
  const [layout, workspace, portal] = await Promise.all([
    read("src/Layout.jsx"), read("src/pages/PMProjectWorkspace.jsx"), read("src/pages/ClientPortal.jsx"),
  ]);
  assert.match(layout, /name: "Project Closeouts"/);
  assert.match(workspace, /value: "closeouts", label: "Project Closeouts"/);
  assert.match(portal, /get_client_portal_closeouts/);
  assert.match(portal, /TabsContent value="closeouts"/);
});
