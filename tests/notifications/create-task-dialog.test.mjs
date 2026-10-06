import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../src/components/tasks/CreateTaskDialog.jsx", import.meta.url), "utf8");

test("create task uses the Fuzed Flow yellow system and a mobile-safe structured layout", () => {
  assert.doesNotMatch(source, /(?:blue|indigo|sky|cyan)-\d/);
  assert.match(source, /Task details/);
  assert.match(source, /Link the task/);
  assert.match(source, /Assignment &amp; schedule/);
  assert.match(source, /h-\[calc\(100dvh-1rem\)\]/);
  assert.match(source, /overflow-hidden/);
  assert.match(source, /min-h-0 flex-1 overflow-y-auto overscroll-contain/);
  assert.match(source, /closeButtonClassName="[^"]*h-11 w-11/);
  assert.match(source, /env\(safe-area-inset-top\)/);
  assert.match(source, /env\(safe-area-inset-bottom\)/);
  assert.match(source, /bg-amber-50/);
  assert.match(source, /More options/);
  assert.match(source, /aria-expanded=\{showMoreOptions\}/);
  assert.doesNotMatch(source, /autoFocus/);
  assert.doesNotMatch(source, /sticky -bottom-4/);
  assert.doesNotMatch(source, /col-span-2 sm:col-span-1/);
});

test("vendor selection works for CRM and project tasks and supports inline creation", () => {
  const projectSelectionEffect = source.slice(source.indexOf("const selectedProject"), source.indexOf("const handleCreateVendor"));
  assert.match(source, /vendor_id: "none"/);
  assert.match(source, /vendor_id: formData\.vendor_id === "none" \? null : formData\.vendor_id/);
  assert.match(source, /client_id: selectedProject\.client_id \? String\(selectedProject\.client_id\) : "none"/);
  assert.doesNotMatch(projectSelectionEffect, /vendor_id/);
  assert.match(source, /<Select value={String\(formData\.vendor_id/);
  assert.match(source, /Vendor \/ Subcontractor/);
  assert.match(source, /Add vendor/);
  assert.match(source, /await onCreateVendor\(\{ name, category: vendorDraft\.category \}\)/);
  assert.match(source, /Add and select/);
  assert.match(source, /vendor\.category \? ` — \$\{vendor\.category\}`/);
});

test("mobile opening does not raise the keyboard while desktop retains title focus", () => {
  assert.match(source, /onOpenAutoFocus=\{\(event\) =>/);
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /window\.matchMedia\("\(min-width: 640px\)"\)/);
  assert.match(source, /titleInputRef\.current\?\.focus\(\)/);
});
