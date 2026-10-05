import {
  addDays, differenceInCalendarDays, differenceInHours, endOfDay, endOfMonth,
  format, isAfter, isBefore, isWithinInterval,
  startOfDay, startOfMonth, startOfQuarter, startOfWeek, startOfYear, subDays,
} from "date-fns";

export const SALES_STAGE_ORDER = ["New", "Contacted", "Qualified", "Booked Visit", "Quoted", "Negotiation", "Won"];
export const SALES_STAGE_FILTERS = [...SALES_STAGE_ORDER, "Lost"];

const STAGE_ALIASES = new Map([
  ["new", "New"], ["contacted", "Contacted"], ["qualified", "Qualified"],
  ["booked visit", "Booked Visit"], ["appointment scheduled", "Booked Visit"], ["site visit booked", "Booked Visit"],
  ["estimate scheduled", "Booked Visit"], ["estimating", "Quoted"], ["estimate completed", "Quoted"],
  ["quoted", "Quoted"], ["quote sent", "Quoted"], ["follow-up", "Negotiation"], ["follow up", "Negotiation"],
  ["negotiation", "Negotiation"], ["won", "Won"], ["lost", "Lost"],
]);

const DEFAULT_PROBABILITY = { New: 10, Contacted: 20, Qualified: 35, "Booked Visit": 50, Quoted: 65, Negotiation: 80, Won: 100, Lost: 0 };
const CLOSED_STAGES = new Set(["Won", "Lost"]);

export function normalizeSalesStage(value) {
  return STAGE_ALIASES.get(String(value || "").trim().toLowerCase()) || "New";
}

export function recordDate(value) {
  if (!value) return null;
  const text = String(value);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T12:00:00`) : new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isDateInRange(value, range) {
  const date = recordDate(value);
  return !!date && isWithinInterval(date, { start: range.start, end: range.end });
}

export function getSalesDateRange(preset, now = new Date(), custom = {}) {
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  let start;
  let end;
  switch (preset) {
    case "today": start = todayStart; end = todayEnd; break;
    case "yesterday": start = subDays(todayStart, 1); end = endOfDay(start); break;
    case "7d": start = startOfDay(subDays(now, 6)); end = todayEnd; break;
    case "30d": start = startOfDay(subDays(now, 29)); end = todayEnd; break;
    case "last_month": {
      const previous = subDays(startOfMonth(now), 1);
      start = startOfMonth(previous); end = endOfMonth(previous); break;
    }
    case "quarter": start = startOfQuarter(now); end = todayEnd; break;
    case "year": start = startOfYear(now); end = todayEnd; break;
    case "custom": {
      const customStart = recordDate(custom.start);
      const customEnd = recordDate(custom.end);
      start = customStart ? startOfDay(customStart) : startOfMonth(now);
      end = customEnd ? endOfDay(customEnd) : todayEnd;
      if (isAfter(start, end)) [start, end] = [startOfDay(end), endOfDay(start)];
      break;
    }
    case "month":
    default: start = startOfMonth(now); end = todayEnd;
  }
  const days = Math.max(1, differenceInCalendarDays(end, start) + 1);
  const previousEnd = endOfDay(subDays(start, 1));
  const previousStart = startOfDay(subDays(previousEnd, days - 1));
  return { start, end, previousStart, previousEnd, days };
}

export function percentChange(current, previous) {
  if (!previous) return current ? 100 : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const quoteEventDate = quote => quote.signed_at || quote.updated_at || quote.sent_at || quote.issue_date || quote.created_at;
const paymentEventDate = payment => payment.payment_date || payment.created_at;
const leadAssignee = lead => lead.assigned_to_user_id || lead.assigned_to || "unassigned";

function filterLeads(leads, filters, range) {
  return leads.filter(lead => {
    if (!isDateInRange(lead.created_at, range)) return false;
    if (filters.rep !== "all" && String(leadAssignee(lead)) !== String(filters.rep)) return false;
    if (filters.source !== "all" && (lead.source || "Other") !== filters.source) return false;
    if (filters.stage !== "all" && normalizeSalesStage(lead.pipeline_stage) !== filters.stage) return false;
    return true;
  });
}

function filterRelated(records, leadMap, filters, range, dateSelector) {
  return records.filter(record => {
    if (!isDateInRange(dateSelector(record), range)) return false;
    const lead = record.lead_id ? leadMap.get(record.lead_id) : null;
    if (filters.rep !== "all" && (!lead || String(leadAssignee(lead)) !== String(filters.rep))) return false;
    if (filters.source !== "all" && (!lead || (lead.source || "Other") !== filters.source)) return false;
    if (filters.stage !== "all" && (!lead || normalizeSalesStage(lead.pipeline_stage) !== filters.stage)) return false;
    return true;
  });
}

function leadValue(lead, quotesByLead) {
  const linked = quotesByLead.get(lead.id) || [];
  const usable = linked.filter(quote => !quote.is_template && !["Draft", "Declined", "Expired", "Cancelled", "Canceled"].includes(quote.status));
  return usable.length ? Math.max(...usable.map(quote => number(quote.total))) : number(lead.value_estimate);
}

function wonDate(lead, quotesByLead) {
  if (lead.won_at) return recordDate(lead.won_at);
  const approved = (quotesByLead.get(lead.id) || []).filter(quote => quote.status === "Approved").map(quoteEventDate).map(recordDate).filter(Boolean);
  return approved.length ? approved.sort((a, b) => b - a)[0] : null;
}

function stageReached(lead, stage, quotesByLead) {
  const current = normalizeSalesStage(lead.pipeline_stage);
  if (stage === "New") return true;
  if (stage === "Won") return current === "Won";
  if (stage === "Lost") return current === "Lost";
  if (stage === "Contacted") return (current !== "New" && current !== "Lost") || !!lead.first_contact_at;
  if (stage === "Qualified") return !!lead.qualified_at || ["Qualified", "Booked Visit", "Quoted", "Negotiation", "Won"].includes(current);
  if (stage === "Booked Visit") return !!lead.appointment_at || !!lead.next_meeting_date || ["Booked Visit", "Quoted", "Negotiation", "Won"].includes(current);
  if (stage === "Quoted") return !!lead.quote_sent_at || (quotesByLead.get(lead.id) || []).some(quote => !quote.is_template && quote.status !== "Draft") || ["Quoted", "Negotiation", "Won"].includes(current);
  if (stage === "Negotiation") return ["Negotiation", "Won"].includes(current);
  return false;
}

function aggregateRepPerformance(leads, quotes, profiles, activities, quotesByLead) {
  const profileMap = new Map(profiles.map(profile => [String(profile.id), profile]));
  const leadMap = new Map(leads.map(lead => [lead.id, lead]));
  const reps = new Map();
  const ensure = key => {
    if (!reps.has(key)) reps.set(key, { id: key, name: profileMap.get(String(key))?.full_name || (key === "unassigned" ? "Unassigned" : String(key)), leads: 0, appointments: 0, quotes: 0, won: 0, revenue: 0, calls: 0, closeRate: 0 });
    return reps.get(key);
  };
  leads.forEach(lead => {
    const row = ensure(String(leadAssignee(lead)));
    row.leads += 1;
    if (stageReached(lead, "Booked Visit", quotesByLead)) row.appointments += 1;
    if (stageReached(lead, "Quoted", quotesByLead)) row.quotes += 1;
    if (normalizeSalesStage(lead.pipeline_stage) === "Won") row.won += 1;
  });
  quotes.filter(quote => quote.status === "Approved").forEach(quote => {
    const lead = leadMap.get(quote.lead_id);
    if (lead) ensure(String(leadAssignee(lead))).revenue += number(quote.total);
  });
  activities.filter(activity => activity.activity_type === "call").forEach(activity => {
    const lead = leadMap.get(activity.lead_id);
    if (lead) ensure(String(leadAssignee(lead))).calls += 1;
  });
  return [...reps.values()].map(rep => ({ ...rep, closeRate: rep.leads ? (rep.won / rep.leads) * 100 : 0 })).sort((a, b) => b.revenue - a.revenue || b.won - a.won);
}

function buildFlow(leads, quotes, payments, activities, range, interval = "daily") {
  const bucket = date => {
    if (interval === "monthly") return format(date, "yyyy-MM");
    if (interval === "weekly") return format(startOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd");
    if (interval === "hourly") return format(date, "yyyy-MM-dd HH:00");
    return format(date, "yyyy-MM-dd");
  };
  const buckets = new Map();
  const ensure = date => {
    const key = bucket(date);
    if (!buckets.has(key)) buckets.set(key, { key, label: interval === "monthly" ? format(date, "MMM") : interval === "hourly" ? format(date, "ha") : format(date, "MMM d"), leads: 0, qualified: 0, appointments: 0, quotes: 0, won: 0, revenue: 0 });
    return buckets.get(key);
  };
  for (let cursor = range.start; !isAfter(cursor, range.end); cursor = addDays(cursor, 1)) ensure(cursor);
  leads.forEach(lead => { const date = recordDate(lead.created_at); if (date) ensure(date).leads += 1; });
  activities.forEach(activity => {
    const date = recordDate(activity.occurred_at); if (!date) return; const row = ensure(date);
    if (activity.activity_type === "stage_changed" && activity.metadata?.to === "Qualified") row.qualified += 1;
    if (activity.activity_type === "appointment" || (activity.activity_type === "stage_changed" && ["Booked Visit", "Appointment Scheduled"].includes(activity.metadata?.to))) row.appointments += 1;
    if (activity.activity_type === "deal_won") row.won += 1;
  });
  quotes.filter(quote => quote.status !== "Draft" && !quote.is_template).forEach(quote => { const date = recordDate(quote.sent_at || quote.issue_date || quote.created_at); if (date) ensure(date).quotes += 1; });
  payments.forEach(payment => { const date = recordDate(paymentEventDate(payment)); if (date) ensure(date).revenue += number(payment.amount); });
  return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function calculateSalesPerformance(data, options) {
  const { leads = [], quotes = [], payments = [], activities = [], profiles = [], reminders = [], target = null } = data;
  const filters = { rep: "all", source: "all", stage: "all", ...(options.filters || {}) };
  const range = options.range;
  const previousRange = { start: range.previousStart, end: range.previousEnd };
  const allLeadMap = new Map(leads.map(lead => [lead.id, lead]));
  const quotesByLead = new Map();
  quotes.forEach(quote => { if (quote.lead_id) quotesByLead.set(quote.lead_id, [...(quotesByLead.get(quote.lead_id) || []), quote]); });
  const currentLeads = filterLeads(leads, filters, range);
  const previousLeads = filterLeads(leads, filters, previousRange);
  const currentQuotes = filterRelated(quotes.filter(quote => !quote.is_template), allLeadMap, filters, range, quoteEventDate);
  const previousQuotes = filterRelated(quotes.filter(quote => !quote.is_template), allLeadMap, filters, previousRange, quoteEventDate);
  const currentPayments = filterRelated(payments, allLeadMap, filters, range, paymentEventDate);
  const previousPayments = filterRelated(payments, allLeadMap, filters, previousRange, paymentEventDate);
  const currentActivities = filterRelated(activities, allLeadMap, filters, range, activity => activity.occurred_at);

  const leadStats = rows => {
    const won = rows.filter(lead => normalizeSalesStage(lead.pipeline_stage) === "Won").length;
    const lost = rows.filter(lead => normalizeSalesStage(lead.pipeline_stage) === "Lost").length;
    return { won, lost, conversion: rows.length ? (won / rows.length) * 100 : 0, closeRate: won + lost ? (won / (won + lost)) * 100 : 0 };
  };
  const currentStats = leadStats(currentLeads);
  const previousStats = leadStats(previousLeads);
  const activeLeads = currentLeads.filter(lead => !CLOSED_STAGES.has(normalizeSalesStage(lead.pipeline_stage)));
  const previousActive = previousLeads.filter(lead => !CLOSED_STAGES.has(normalizeSalesStage(lead.pipeline_stage)));
  const pipelineValue = activeLeads.reduce((sum, lead) => sum + leadValue(lead, quotesByLead), 0);
  const previousPipelineValue = previousActive.reduce((sum, lead) => sum + leadValue(lead, quotesByLead), 0);
  const approvedQuotes = currentQuotes.filter(quote => quote.status === "Approved");
  const previousApproved = previousQuotes.filter(quote => quote.status === "Approved");
  const revenueWon = approvedQuotes.reduce((sum, quote) => sum + number(quote.total), 0);
  const previousRevenueWon = previousApproved.reduce((sum, quote) => sum + number(quote.total), 0);
  const appointments = currentLeads.filter(lead => isDateInRange(lead.appointment_at || lead.next_meeting_date, range)).length;
  const previousAppointments = previousLeads.filter(lead => isDateInRange(lead.appointment_at || lead.next_meeting_date, previousRange)).length;
  const averageDeal = approvedQuotes.length ? revenueWon / approvedQuotes.length : 0;
  const previousAverageDeal = previousApproved.length ? previousRevenueWon / previousApproved.length : 0;
  const velocityValues = currentLeads.filter(lead => normalizeSalesStage(lead.pipeline_stage) === "Won").map(lead => {
    const created = recordDate(lead.created_at); const won = wonDate(lead, quotesByLead);
    return created && won && !isBefore(won, created) ? differenceInHours(won, created) / 24 : null;
  }).filter(value => value != null);
  const previousVelocityValues = previousLeads.filter(lead => normalizeSalesStage(lead.pipeline_stage) === "Won").map(lead => {
    const created = recordDate(lead.created_at); const won = wonDate(lead, quotesByLead);
    return created && won && !isBefore(won, created) ? differenceInHours(won, created) / 24 : null;
  }).filter(value => value != null);
  const salesVelocity = velocityValues.length ? velocityValues.reduce((a, b) => a + b, 0) / velocityValues.length : null;
  const previousVelocity = previousVelocityValues.length ? previousVelocityValues.reduce((a, b) => a + b, 0) / previousVelocityValues.length : null;

  const funnelStages = [...SALES_STAGE_ORDER, "Lost"].map(stage => {
    const stageLeads = currentLeads.filter(lead => stageReached(lead, stage, quotesByLead));
    return { stage, count: stageLeads.length, value: stageLeads.reduce((sum, lead) => sum + leadValue(lead, quotesByLead), 0), percent: currentLeads.length ? (stageLeads.length / currentLeads.length) * 100 : 0, records: stageLeads };
  });
  const progressStages = funnelStages.filter(item => item.stage !== "Lost");
  const conversions = progressStages.slice(1).map((item, index) => {
    const previous = progressStages[index];
    return { from: previous.stage, to: item.stage, rate: previous.count ? (item.count / previous.count) * 100 : 0, fromCount: previous.count, toCount: item.count };
  });
  const bottleneck = conversions.filter(item => item.fromCount > 0).sort((a, b) => a.rate - b.rate)[0] || null;

  const sources = new Map();
  currentLeads.forEach(lead => {
    const key = lead.source || "Other";
    if (!sources.has(key)) sources.set(key, { source: key, leads: 0, won: 0, revenue: 0, value: 0 });
    const row = sources.get(key); row.leads += 1; row.value += leadValue(lead, quotesByLead);
    if (normalizeSalesStage(lead.pipeline_stage) === "Won") row.won += 1;
  });
  approvedQuotes.forEach(quote => { const source = allLeadMap.get(quote.lead_id)?.source || "Other"; if (sources.has(source)) sources.get(source).revenue += number(quote.total); });
  const sourceBreakdown = [...sources.values()].map(row => ({ ...row, percent: currentLeads.length ? (row.leads / currentLeads.length) * 100 : 0, conversion: row.leads ? (row.won / row.leads) * 100 : 0 })).sort((a, b) => b.leads - a.leads);

  const repPerformance = aggregateRepPerformance(currentLeads, currentQuotes, profiles, currentActivities, quotesByLead);
  const pipelineByStage = SALES_STAGE_ORDER.filter(stage => !["Won"].includes(stage)).map(stage => {
    const rows = activeLeads.filter(lead => normalizeSalesStage(lead.pipeline_stage) === stage);
    return { stage, count: rows.length, value: rows.reduce((sum, lead) => sum + leadValue(lead, quotesByLead), 0) };
  });
  const weightedPipeline = activeLeads.reduce((sum, lead) => sum + leadValue(lead, quotesByLead) * (number(lead.probability) || DEFAULT_PROBABILITY[normalizeSalesStage(lead.pipeline_stage)]) / 100, 0);
  const dueDate = format(new Date(), "yyyy-MM-dd");
  const currentMonthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");
  const followUp = {
    awaiting: activeLeads.filter(lead => !!lead.next_follow_up_date).length,
    overdue: activeLeads.filter(lead => lead.next_follow_up_date && lead.next_follow_up_date < dueDate).length,
    today: activeLeads.filter(lead => lead.next_follow_up_date === dueDate).length,
    completed: currentActivities.filter(activity => activity.activity_type === "follow_up").length,
    reminders: reminders.filter(reminder => String(reminder.status).toLowerCase() === "pending").length,
  };

  const hotLeads = activeLeads.map(lead => {
    const linkedQuotes = quotesByLead.get(lead.id) || [];
    const viewed = linkedQuotes.some(quote => quote.viewed_at) || activities.some(activity => activity.lead_id === lead.id && activity.activity_type === "proposal_viewed");
    const recency = Math.max(0, 20 - Math.min(20, differenceInCalendarDays(new Date(), recordDate(lead.stage_changed_at || lead.created_at) || new Date())));
    const value = leadValue(lead, quotesByLead);
    const probability = number(lead.probability) || DEFAULT_PROBABILITY[normalizeSalesStage(lead.pipeline_stage)];
    const score = Math.min(99, Math.round(probability * 0.55 + Math.min(20, value / 5000) + (viewed ? 12 : 0) + recency * 0.6));
    return { ...lead, value, probability, score, viewed, assignee: profiles.find(profile => String(profile.id) === String(leadAssignee(lead)))?.full_name || "Unassigned" };
  }).sort((a, b) => b.score - a.score || b.value - a.value).slice(0, 6);

  const lostReasons = new Map();
  currentLeads.filter(lead => normalizeSalesStage(lead.pipeline_stage) === "Lost").forEach(lead => {
    const reason = lead.lost_reason || (quotesByLead.get(lead.id) || []).find(quote => quote.status === "Declined")?.decline_reason || "Not recorded";
    if (!lostReasons.has(reason)) lostReasons.set(reason, { reason, count: 0, value: 0 });
    const row = lostReasons.get(reason); row.count += 1; row.value += leadValue(lead, quotesByLead);
  });

  const targetAmount = number(target?.revenue_target);
  const monthRevenue = quotes.filter(quote => quote.status === "Approved" && isDateInRange(quoteEventDate(quote), { start: startOfMonth(new Date()), end: endOfMonth(new Date()) })).reduce((sum, quote) => sum + number(quote.total), 0);
  const remainingTarget = Math.max(0, targetAmount - monthRevenue);
  const daysRemaining = Math.max(1, differenceInCalendarDays(endOfMonth(new Date()), new Date()) + 1);

  const insights = [];
  if (bottleneck) insights.push({ tone: bottleneck.rate < 40 ? "warning" : "neutral", text: `${bottleneck.from} to ${bottleneck.to} is the weakest conversion at ${bottleneck.rate.toFixed(1)}%.`, action: "View leads", stage: bottleneck.from });
  if (followUp.overdue) insights.push({ tone: "warning", text: `${followUp.overdue} lead${followUp.overdue === 1 ? "" : "s"} require overdue follow-up.`, action: "Review follow-ups", stage: null });
  if (hotLeads.length) insights.push({ tone: "positive", text: `${hotLeads[0].contact_name} is the highest-priority active opportunity at ${hotLeads[0].score}% engagement score.`, action: "View lead", leadId: hotLeads[0].id });
  if (sourceBreakdown[0]?.leads) insights.push({ tone: "neutral", text: `${sourceBreakdown[0].source} is your largest lead source with ${sourceBreakdown[0].leads} lead${sourceBreakdown[0].leads === 1 ? "" : "s"} in this period.`, action: "View source", source: sourceBreakdown[0].source });

  return {
    range, filters, currentLeads, currentQuotes, currentPayments, currentActivities,
    kpis: [
      { id: "leads", label: "Total leads", value: currentLeads.length, previous: previousLeads.length, change: percentChange(currentLeads.length, previousLeads.length) },
      { id: "conversion", label: "Conversion rate", value: currentStats.conversion, previous: previousStats.conversion, change: percentChange(currentStats.conversion, previousStats.conversion), suffix: "%" },
      { id: "pipeline", label: "Pipeline value", value: pipelineValue, previous: previousPipelineValue, change: percentChange(pipelineValue, previousPipelineValue), currency: true },
      { id: "won", label: "Revenue won", value: revenueWon, previous: previousRevenueWon, change: percentChange(revenueWon, previousRevenueWon), currency: true },
      { id: "appointments", label: "Appointments booked", value: appointments, previous: previousAppointments, change: percentChange(appointments, previousAppointments) },
      { id: "average", label: "Average deal value", value: averageDeal, previous: previousAverageDeal, change: percentChange(averageDeal, previousAverageDeal), currency: true },
      { id: "velocity", label: "Sales velocity", value: salesVelocity, previous: previousVelocity, change: salesVelocity == null || previousVelocity == null ? 0 : -percentChange(salesVelocity, previousVelocity), suffix: " days", decimals: 1 },
      { id: "close", label: "Close rate", value: currentStats.closeRate, previous: previousStats.closeRate, change: percentChange(currentStats.closeRate, previousStats.closeRate), suffix: "%" },
    ],
    collectedRevenue: currentPayments.reduce((sum, payment) => sum + number(payment.amount), 0),
    collectedRevenueChange: percentChange(currentPayments.reduce((sum, payment) => sum + number(payment.amount), 0), previousPayments.reduce((sum, payment) => sum + number(payment.amount), 0)),
    funnelStages, conversions, bottleneck,
    flow: buildFlow(currentLeads, currentQuotes, currentPayments, currentActivities, range, options.interval || "daily"),
    sourceBreakdown, repPerformance, pipelineByStage,
    forecast: { currentPipeline: pipelineValue, weightedPipeline, bestCase: pipelineValue, mostLikely: weightedPipeline, worstCase: weightedPipeline * 0.55 },
    target: { amount: targetAmount, current: monthRevenue, remaining: remainingTarget, progress: targetAmount ? Math.min(100, (monthRevenue / targetAmount) * 100) : 0, daysRemaining, requiredDaily: remainingTarget / daysRemaining, periodStart: currentMonthStart },
    followUp, hotLeads, lostReasons: [...lostReasons.values()].sort((a, b) => b.count - a.count), insights,
    activity: currentActivities.slice().sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at)).slice(0, 20),
    filterOptions: { sources: [...new Set(leads.map(lead => lead.source || "Other"))].sort(), reps: profiles.filter(profile => profile.is_active !== false) },
    dataQuality: { velocitySample: velocityValues.length, historicalTrackingComplete: currentLeads.every(lead => !!lead.stage_changed_at) },
  };
}
