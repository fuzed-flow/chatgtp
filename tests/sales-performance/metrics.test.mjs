import assert from "node:assert/strict";
import test from "node:test";

import { calculateSalesPerformance, getSalesDateRange, normalizeSalesStage } from "../../src/lib/salesPerformance.js";

const range = getSalesDateRange("month", new Date("2026-10-05T12:00:00Z"));
const lead = (id, stage, createdAt, extra = {}) => ({
  id,
  contact_name: `Lead ${id}`,
  pipeline_stage: stage,
  created_at: createdAt,
  source: "Referral",
  value_estimate: 1000,
  assigned_to_user_id: "rep-1",
  stage_changed_at: createdAt,
  ...extra,
});

const data = {
  leads: [
    lead("won", "Won", "2026-10-01T12:00:00Z", { won_at: "2026-10-04T12:00:00Z", value_estimate: 10000 }),
    lead("quoted", "Quote Sent", "2026-10-02T12:00:00Z", { quote_sent_at: "2026-10-03T12:00:00Z", value_estimate: 5000, source: "Website" }),
    lead("lost", "Lost", "2026-10-03T12:00:00Z", { lost_at: "2026-10-04T12:00:00Z", lost_reason: "Budget", value_estimate: 3000 }),
    lead("previous", "Won", "2026-09-27T12:00:00Z", { won_at: "2026-09-29T12:00:00Z", value_estimate: 6000 }),
  ],
  quotes: [
    { id: "q-won", lead_id: "won", status: "Approved", total: 12000, signed_at: "2026-10-04T12:00:00Z", is_template: false },
    { id: "q-sent", lead_id: "quoted", status: "Sent", total: 7000, sent_at: "2026-10-03T12:00:00Z", is_template: false },
    { id: "q-previous", lead_id: "previous", status: "Approved", total: 6000, signed_at: "2026-09-29T12:00:00Z", is_template: false },
  ],
  payments: [
    { id: "payment-current", lead_id: "won", amount: 2000, payment_date: "2026-10-05" },
    { id: "payment-previous", lead_id: "previous", amount: 1000, payment_date: "2026-09-29" },
  ],
  activities: [
    { id: "a1", lead_id: "quoted", activity_type: "stage_changed", title: "Visit booked", metadata: { to: "Booked Visit" }, occurred_at: "2026-10-03T10:00:00Z" },
  ],
  profiles: [{ id: "rep-1", full_name: "Jordan Lee", is_active: true }],
  reminders: [],
  target: { revenue_target: 20000 },
};

const calculate = (filters = {}) => calculateSalesPerformance(data, { range, filters: { rep: "all", source: "all", stage: "all", ...filters }, interval: "daily" });

test("normalizes existing sales stage aliases", () => {
  assert.equal(normalizeSalesStage("Quote Sent"), "Quoted");
  assert.equal(normalizeSalesStage("appointment scheduled"), "Booked Visit");
  assert.equal(normalizeSalesStage("unknown legacy value"), "New");
});

test("calculates current and previous KPIs without double-counting lead estimates", () => {
  const report = calculate();
  const metrics = Object.fromEntries(report.kpis.map(metric => [metric.id, metric]));
  assert.equal(metrics.leads.value, 3);
  assert.equal(metrics.pipeline.value, 7000, "the linked sent quote replaces the lead estimate");
  assert.equal(metrics.won.value, 12000, "approved quote revenue is counted once");
  assert.equal(metrics.won.previous, 6000);
  assert.equal(metrics.average.value, 12000);
  assert.equal(metrics.velocity.value, 3);
  assert.ok(Math.abs(metrics.conversion.value - 33.3333) < 0.01);
  assert.equal(metrics.close.value, 50);
  assert.equal(report.collectedRevenue, 2000);
});

test("funnel, event flow and filters remain internally consistent", () => {
  const report = calculate();
  const funnel = Object.fromEntries(report.funnelStages.map(stage => [stage.stage, stage.count]));
  assert.deepEqual(funnel, { New: 3, Contacted: 2, Qualified: 2, "Booked Visit": 2, Quoted: 2, Negotiation: 1, Won: 1, Lost: 1 });
  assert.equal(report.flow.reduce((total, bucket) => total + bucket.appointments, 0), 1);
  assert.deepEqual(report.lostReasons.map(reason => [reason.reason, reason.count]), [["Budget", 1]]);

  const website = calculate({ source: "Website" });
  assert.equal(website.currentLeads.length, 1);
  assert.equal(website.collectedRevenue, 0, "lead filters also constrain related payments");
  assert.equal(website.kpis.find(metric => metric.id === "pipeline").value, 7000);
});
