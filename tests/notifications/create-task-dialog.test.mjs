import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../src/components/tasks/CreateTaskDialog.jsx", import.meta.url), "utf8");

test("create task uses the Fuzed Flow yellow system and a mobile-safe structured layout", () => {
  assert.doesNotMatch(source, /(?:blue|indigo|sky|cyan)-\d/);
  assert.match(source, /Task details/);
  assert.match(source, /Link the task/);
  assert.match(source, /Assignment &amp; schedule/);
  assert.match(source, /max-h-\[92dvh\]/);
  assert.match(source, /pt-10/);
  assert.match(source, /bg-amber-50/);
  assert.match(source, /sticky -bottom-4/);
});

test("vendor selection is clear, optional, and disabled for project tasks that use project subcontractors", () => {
  assert.match(source, /vendor_id: "none"/);
  assert.match(source, /vendor_id: formData\.vendor_id === "none" \? null : formData\.vendor_id/);
  assert.match(source, /client_id: selectedProject\.client_id \? String\(selectedProject\.client_id\) : "none"/);
  assert.match(source, /lead_id: "none",\s+vendor_id: "none"/);
  assert.match(source, /<Select disabled={hasProject} value={String\(formData\.vendor_id/);
  assert.match(source, /Vendor \/ Subcontractor/);
  assert.match(source, /Project tasks use the project's Subcontractors workspace/);
  assert.match(source, /v\.category \? ` — \$\{v\.category\}`/);
});
