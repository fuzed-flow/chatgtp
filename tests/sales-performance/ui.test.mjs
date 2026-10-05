import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("sales performance is available as a page and the Reports sales tab", async () => {
  const [pages, reports, dashboard] = await Promise.all([
    read("../../src/pages.config.js"),
    read("../../src/pages/Reports.jsx"),
    read("../../src/components/reports/SalesPerformanceDashboard.jsx"),
  ]);
  assert.match(pages, /"SalesPerformance": SalesPerformance/);
  assert.match(reports, /label: "Sales Performance"/);
  assert.match(reports, /<SalesPerformanceDashboard embedded/);
  for (const section of ["Sales funnel", "Lead flow over time", "Sales rep performance", "Revenue forecast", "Monthly sales target", "Hot leads", "Why are we losing deals?"]) assert.match(dashboard, new RegExp(section.replace(/[?]/g, "\\?")));
  for (const behavior of ["Customize dashboard", "All lead creators", "Attributed to lead creator", "DEFAULT_DASHBOARD_LAYOUT", "hiddenPanels"]) assert.match(dashboard, new RegExp(behavior));
});

test("mobile navigation uses four primary destinations and an accessible More sheet", async () => {
  const layout = await read("../../src/Layout.jsx");
  assert.doesNotMatch(layout, /Open navigation menu|<Menu className/);
  assert.match(layout, /aria-label="Primary mobile navigation"/);
  for (const label of ["Dashboard", "Leads", "Projects", "Tasks"]) assert.match(layout, new RegExp(`label: "${label}"`));
  assert.match(layout, /<Dialog open={moreOpen}/);
  assert.match(layout, /DialogContent className="[^"]*!flex min-h-0[^"]*flex-col overflow-hidden/);
  assert.match(layout, /data-mobile-more-scroll className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain/);
  assert.match(layout, /WebkitOverflowScrolling: "touch"/);
  assert.match(layout, /pb-\[calc\(5rem\+env\(safe-area-inset-bottom\)\)\]/);
});
