import React, { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, Award, BarChart3,
  CalendarDays, CheckCircle2, ChevronDown, ChevronUp, Clock3, DollarSign, Eye, EyeOff,
  Filter, Flame, Gauge, Info, Mail, MessageSquare, Phone, PieChart as PieChartIcon,
  RefreshCw, RotateCcw, SlidersHorizontal, Sparkles, Target, TrendingUp, Users, X,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer,
  Tooltip as ChartTooltip, XAxis, YAxis,
} from "recharts";
import { format, formatDistanceToNow } from "date-fns";
import { useAuth } from "@/lib/AuthContext";
import { useSalesPerformance } from "@/hooks/useSalesPerformance";
import { getSalesDateRange, SALES_STAGE_FILTERS } from "@/lib/salesPerformance";
import { supabase } from "@/api/supabaseClient";
import { formatCurrencyUSD } from "@/components/utils/formatCurrency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

const DATE_OPTIONS = [
  ["today", "Today"], ["yesterday", "Yesterday"], ["7d", "Last 7 days"], ["30d", "Last 30 days"],
  ["month", "This month"], ["last_month", "Last month"], ["quarter", "This quarter"], ["year", "This year"], ["custom", "Custom range"],
];
const CHART_COLORS = ["#fbbf24", "#fb923c", "#34d399", "#60a5fa", "#c084fc", "#f87171", "#94a3b8"];
const KPI_ICONS = { leads: Users, conversion: TrendingUp, pipeline: Gauge, won: Award, appointments: CalendarDays, average: DollarSign, velocity: Clock3, close: Target };
const KPI_HELP = {
  leads: "Leads created during the selected period.",
  conversion: "Percentage of leads created in the period that are currently won.",
  pipeline: "Active opportunity value, using linked quote totals before lead estimates.",
  won: "Approved quote value during the selected period.",
  appointments: "Lead appointments scheduled during the selected period.",
  average: "Average value of approved quotes during the selected period.",
  velocity: "Average days from lead creation to a recorded win. Older leads without reliable timestamps are excluded.",
  close: "Percentage of closed opportunities that resulted in a won deal.",
};
const DASHBOARD_GROUPS = [
  { id: "metrics", label: "Key metrics", panels: [["metric:leads", "Total leads"], ["metric:conversion", "Conversion rate"], ["metric:pipeline", "Pipeline value"], ["metric:won", "Revenue won"], ["metric:appointments", "Appointments booked"], ["metric:average", "Average deal value"], ["metric:velocity", "Sales velocity"], ["metric:close", "Close rate"]] },
  { id: "funnel", label: "Funnel", panels: [["funnel:sales", "Sales funnel"], ["funnel:conversion", "Pipeline conversion"]] },
  { id: "activity", label: "Trends and activity", panels: [["activity:flow", "Lead flow over time"], ["activity:live", "Live activity"]] },
  { id: "pipeline", label: "Pipeline analysis", panels: [["pipeline:sources", "Lead source breakdown"], ["pipeline:value", "Pipeline value by stage"]] },
  { id: "team", label: "Team performance", panels: [["team:performance", "Sales rep performance"], ["team:leaders", "Top performers"]] },
  { id: "planning", label: "Forecast and planning", panels: [["planning:forecast", "Revenue forecast"], ["planning:target", "Monthly sales target"], ["planning:followup", "Follow-up health"]] },
  { id: "outcomes", label: "Opportunity outcomes", panels: [["outcomes:hot", "Hot leads"], ["outcomes:lost", "Lost deal analysis"]] },
  { id: "insights", label: "Insights", panels: [["insights:recommendations", "Recommended actions"]] },
];
const DASHBOARD_PANEL_IDS = new Set(DASHBOARD_GROUPS.flatMap(group => group.panels.map(([id]) => id)));
const DEFAULT_DASHBOARD_LAYOUT = { version: 1, groupOrder: DASHBOARD_GROUPS.map(group => group.id), hiddenPanels: [] };

function normalizeDashboardLayout(value) {
  const requestedOrder = Array.isArray(value?.groupOrder) ? value.groupOrder.filter(id => DASHBOARD_GROUPS.some(group => group.id === id)) : [];
  const groupOrder = [...new Set([...requestedOrder, ...DEFAULT_DASHBOARD_LAYOUT.groupOrder])];
  const hiddenPanels = Array.isArray(value?.hiddenPanels) ? [...new Set(value.hiddenPanels.filter(id => DASHBOARD_PANEL_IDS.has(id)))] : [];
  return { version: 1, groupOrder, hiddenPanels };
}

function readDashboardLayout(storageKey) {
  if (!storageKey || typeof window === "undefined") return DEFAULT_DASHBOARD_LAYOUT;
  try { return normalizeDashboardLayout(JSON.parse(window.localStorage.getItem(storageKey))); }
  catch { return DEFAULT_DASHBOARD_LAYOUT; }
}

function DashboardCustomizeDialog({ open, onOpenChange, layout, onChange }) {
  const hidden = new Set(layout.hiddenPanels);
  const groupMap = new Map(DASHBOARD_GROUPS.map(group => [group.id, group]));
  const orderedGroups = layout.groupOrder.map(id => groupMap.get(id)).filter(Boolean);
  const togglePanel = panelId => onChange(current => ({ ...current, hiddenPanels: current.hiddenPanels.includes(panelId) ? current.hiddenPanels.filter(id => id !== panelId) : [...current.hiddenPanels, panelId] }));
  const moveGroup = (groupId, direction) => onChange(current => {
    const groupOrder = [...current.groupOrder];
    const index = groupOrder.indexOf(groupId);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= groupOrder.length) return current;
    [groupOrder[index], groupOrder[destination]] = [groupOrder[destination], groupOrder[index]];
    return { ...current, groupOrder };
  });

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="flex max-h-[88dvh] w-[94vw] max-w-2xl flex-col overflow-hidden border-slate-700 bg-slate-950 p-0 text-white">
    <DialogHeader className="border-b border-white/10 p-5 pr-14 text-left"><DialogTitle className="text-xl font-black text-white">Customize dashboard</DialogTitle><DialogDescription className="text-slate-400">Show only the information you use and move dashboard groups into your preferred order. This view is saved for you on this device.</DialogDescription></DialogHeader>
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">{orderedGroups.map((group, groupIndex) => <section key={group.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center justify-between gap-3"><h3 className="font-black text-white">{group.label}</h3><div className="flex gap-1"><Button type="button" variant="ghost" size="icon" disabled={groupIndex === 0} onClick={() => moveGroup(group.id, -1)} aria-label={`Move ${group.label} up`} className="h-9 w-9 text-slate-300 hover:bg-white/10 hover:text-white"><ChevronUp className="h-4 w-4" /></Button><Button type="button" variant="ghost" size="icon" disabled={groupIndex === orderedGroups.length - 1} onClick={() => moveGroup(group.id, 1)} aria-label={`Move ${group.label} down`} className="h-9 w-9 text-slate-300 hover:bg-white/10 hover:text-white"><ChevronDown className="h-4 w-4" /></Button></div></div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">{group.panels.map(([panelId, label]) => { const visible = !hidden.has(panelId); return <button key={panelId} type="button" aria-pressed={visible} onClick={() => togglePanel(panelId)} className={`flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm font-bold ${visible ? "border-amber-300/25 bg-amber-400/10 text-white" : "border-white/5 bg-black/20 text-slate-500"}`}><span>{label}</span>{visible ? <Eye className="h-4 w-4 text-amber-300" /> : <EyeOff className="h-4 w-4" />}</button>; })}</div>
    </section>)}</div>
    <div className="border-t border-white/10 p-4"><Button type="button" variant="outline" onClick={() => onChange(DEFAULT_DASHBOARD_LAYOUT)} className="w-full border-white/10 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white"><RotateCcw className="mr-2 h-4 w-4" />Reset default layout</Button></div>
  </DialogContent></Dialog>;
}

const valueLabel = metric => {
  if (metric.value == null) return "Tracking now";
  if (metric.currency) return formatCurrencyUSD(metric.value);
  const value = Number(metric.value).toLocaleString(undefined, { maximumFractionDigits: metric.decimals ?? (metric.suffix === "%" ? 1 : 0), minimumFractionDigits: metric.decimals ?? 0 });
  return `${value}${metric.suffix || ""}`;
};

function AnimatedMetricValue({ metric }) {
  const target = metric.value == null ? null : Number(metric.value);
  const [display, setDisplay] = useState(target);

  useEffect(() => {
    if (target == null || !Number.isFinite(target) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(target);
      return undefined;
    }
    const started = performance.now();
    let frame;
    const tick = now => {
      const progress = Math.min(1, (now - started) / 650);
      setDisplay(target * (1 - Math.pow(1 - progress, 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return valueLabel({ ...metric, value: display });
}

function Panel({ title, eyebrow, icon: Icon, action, children, className = "" }) {
  return <section className={`rounded-2xl border border-white/10 bg-[#11151c] shadow-[0_18px_50px_rgba(0,0,0,0.22)] ${className}`}>
    <div className="flex min-h-16 items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3 sm:px-5">
      <div className="min-w-0">
        {eyebrow ? <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-400">{eyebrow}</p> : null}
        <h2 className="mt-0.5 flex items-center gap-2 text-sm font-black uppercase tracking-[0.08em] text-white sm:text-base">{Icon ? <Icon className="h-4 w-4 text-amber-400" aria-hidden="true" /> : null}{title}</h2>
      </div>
      {action}
    </div>
    {children}
  </section>;
}

function MetricCard({ metric, onClick }) {
  const Icon = KPI_ICONS[metric.id] || Activity;
  const positive = metric.change > 0.05;
  const negative = metric.change < -0.05;
  return <button type="button" onClick={onClick} className="group min-h-36 rounded-2xl border border-white/10 bg-gradient-to-br from-[#151a22] to-[#0d1015] p-4 text-left shadow-[0_14px_32px_rgba(0,0,0,0.2)] transition hover:-translate-y-0.5 hover:border-amber-400/50 hover:shadow-[0_18px_42px_rgba(245,158,11,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 motion-reduce:transform-none">
    <div className="flex items-start justify-between gap-2">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-300/20 bg-amber-400/10 text-amber-300"><Icon className="h-5 w-5" aria-hidden="true" /></span>
      <span title={KPI_HELP[metric.id]} aria-label={KPI_HELP[metric.id]} className="rounded-full p-1 text-slate-500"><Info className="h-4 w-4" aria-hidden="true" /></span>
    </div>
    <p className="mt-4 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{metric.label}</p>
    <p className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl"><AnimatedMetricValue metric={metric} /></p>
    <p className={`mt-2 flex items-center gap-1 text-xs font-bold ${positive ? "text-emerald-400" : negative ? "text-red-400" : "text-slate-500"}`}>
      {positive ? <ArrowUpRight className="h-3.5 w-3.5" /> : negative ? <ArrowDownRight className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
      {Math.abs(metric.change).toFixed(1)}% <span className="font-medium text-slate-500">vs previous period</span>
    </p>
  </button>;
}

function LoadingDashboard() {
  return <div className="min-h-full bg-[#07090d] p-4 sm:p-6" aria-label="Loading sales performance">
    <div className="mx-auto max-w-[1600px] animate-pulse space-y-5">
      <div className="h-32 rounded-2xl bg-white/5" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <div key={index} className="h-36 rounded-2xl bg-white/5" />)}</div>
      <div className="grid gap-5 xl:grid-cols-3"><div className="h-96 rounded-2xl bg-white/5 xl:col-span-2" /><div className="h-96 rounded-2xl bg-white/5" /></div>
    </div>
  </div>;
}

function RecordDialog({ open, onOpenChange, title, records, onOpenLead }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[88dvh] w-[95vw] max-w-3xl overflow-hidden border-slate-700 bg-slate-950 p-0 text-white">
      <DialogHeader className="border-b border-white/10 p-5 pr-14 text-left">
        <DialogTitle className="text-xl font-black text-white">{title}</DialogTitle>
        <DialogDescription className="text-slate-400">{records.length} matching lead{records.length === 1 ? "" : "s"}</DialogDescription>
      </DialogHeader>
      <div className="max-h-[65dvh] overflow-y-auto p-3 sm:p-5">
        {records.length ? <div className="space-y-2">{records.map(record => <button key={record.id} type="button" onClick={() => onOpenLead(record.id)} className="flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left hover:border-amber-400/40 hover:bg-amber-400/5 focus-visible:ring-2 focus-visible:ring-amber-400">
          <span className="min-w-0"><span className="block truncate font-bold text-white">{record.contact_name}</span><span className="mt-1 block truncate text-xs text-slate-400">{record.pipeline_stage || "New"} · {record.source || "Other"}</span>{record.value_source ? <span className="mt-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">{record.value_source}</span> : null}</span>
          <span className="shrink-0 font-black text-amber-300">{formatCurrencyUSD(record.value ?? record.value_estimate ?? 0)}</span>
        </button>)}</div> : <div className="py-14 text-center"><Users className="mx-auto h-10 w-10 text-slate-600" /><p className="mt-3 font-bold text-white">No matching leads</p><p className="mt-1 text-sm text-slate-500">Try clearing a filter or selecting a broader date range.</p></div>}
      </div>
    </DialogContent>
  </Dialog>;
}

function TargetDialog({ open, onOpenChange, companyId, currentTarget, monthStart, onSaved }) {
  const [value, setValue] = useState(String(currentTarget?.revenue_target || ""));
  const [saving, setSaving] = useState(false);
  React.useEffect(() => { if (open) setValue(String(currentTarget?.revenue_target || "")); }, [open, currentTarget]);
  const save = async event => {
    event.preventDefault();
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return toast.error("Enter a valid monthly target.");
    setSaving(true);
    const payload = { company_id: companyId, user_id: null, period_start: monthStart, revenue_target: amount };
    const operation = currentTarget?.id
      ? supabase.from("sales_targets").update({ revenue_target: amount }).eq("id", currentTarget.id).eq("company_id", companyId)
      : supabase.from("sales_targets").insert(payload);
    const { error } = await operation;
    setSaving(false);
    if (error) return toast.error(error.message || "Could not save the sales target.");
    toast.success("Monthly sales target updated"); onSaved(); onOpenChange(false);
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="w-[94vw] max-w-md border-slate-700 bg-slate-950 text-white">
    <DialogHeader><DialogTitle className="text-white">Monthly sales target</DialogTitle><DialogDescription className="text-slate-400">Set the company revenue target for {format(new Date(`${monthStart}T12:00:00`), "MMMM yyyy")}.</DialogDescription></DialogHeader>
    <form onSubmit={save} className="space-y-4"><div><Label htmlFor="monthly-sales-target" className="text-slate-300">Revenue target</Label><Input id="monthly-sales-target" type="number" min="0" step="100" value={value} onChange={event => setValue(event.target.value)} className="mt-2 h-12 border-slate-700 bg-slate-900 text-lg font-bold text-white" placeholder="150000" /></div><Button type="submit" disabled={saving} className="h-12 w-full bg-amber-400 font-black text-slate-950 hover:bg-amber-300">{saving ? "Saving…" : "Save target"}</Button></form>
  </DialogContent></Dialog>;
}

function ActivityIcon({ type }) {
  const Icon = type === "email" ? Mail : type === "sms" ? MessageSquare : type === "call" ? Phone : type === "proposal_viewed" ? Eye : type.includes("won") || type === "quote_approved" ? Award : type === "payment_received" ? DollarSign : Activity;
  return <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-300/20 bg-amber-400/10 text-amber-300"><Icon className="h-4 w-4" aria-hidden="true" /></span>;
}

export default function SalesPerformanceDashboard({ embedded = false }) {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [preset, setPreset] = useState("month");
  const [custom, setCustom] = useState({ start: format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), "yyyy-MM-dd"), end: format(new Date(), "yyyy-MM-dd") });
  const [filters, setFilters] = useState({ rep: "all", source: "all", stage: "all" });
  const [interval, setInterval] = useState("daily");
  const [flowMetric, setFlowMetric] = useState("leads");
  const [recordView, setRecordView] = useState(null);
  const [targetOpen, setTargetOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const layoutStorageKey = profile?.id && companyId ? `fuzedflow:sales-dashboard:v1:${companyId}:${profile.id}` : null;
  const [layout, setLayout] = useState(() => readDashboardLayout(layoutStorageKey));
  const range = useMemo(() => getSalesDateRange(preset, new Date(), custom), [preset, custom]);
  const query = useSalesPerformance({ companyId, range, filters, interval });
  const report = query.report;

  useEffect(() => { setLayout(readDashboardLayout(layoutStorageKey)); }, [layoutStorageKey]);
  useEffect(() => {
    if (!layoutStorageKey || typeof window === "undefined") return;
    window.localStorage.setItem(layoutStorageKey, JSON.stringify(normalizeDashboardLayout(layout)));
  }, [layout, layoutStorageKey]);

  if (query.isError) return <div className="min-h-full bg-[#07090d] p-6 text-white"><div className="mx-auto max-w-xl rounded-2xl border border-red-400/30 bg-red-500/10 p-6 text-center"><AlertTriangle className="mx-auto h-10 w-10 text-red-400" /><h2 className="mt-3 text-xl font-black">Sales reporting could not load</h2><p className="mt-2 text-sm text-red-100/70">{query.error.message}</p><Button onClick={() => query.refetch()} className="mt-5 bg-amber-400 text-slate-950 hover:bg-amber-300"><RefreshCw className="mr-2 h-4 w-4" />Try again</Button></div></div>;
  if (query.isLoading || !report) return <LoadingDashboard />;

  const clearFilters = () => setFilters({ rep: "all", source: "all", stage: "all" });
  const hasFilters = Object.values(filters).some(value => value !== "all");
  const showRecords = (title, records = report.currentLeads) => setRecordView({ title, records });
  const navigateLead = id => navigate(`/LeadDetail?id=${id}`);
  const activeStage = report.funnelStages.find(stage => stage.stage === filters.stage);
  const isVisible = panelId => !layout.hiddenPanels.includes(panelId);
  const visibleCount = panelIds => panelIds.filter(isVisible).length;
  const groupOrder = groupId => layout.groupOrder.indexOf(groupId);

  return <div className={`min-h-full bg-[#07090d] text-white ${embedded ? "rounded-2xl" : ""}`}>
    <div className="mx-auto max-w-[1600px] space-y-5 px-3 py-4 sm:px-5 sm:py-6 xl:px-7">
      <header className="relative overflow-hidden rounded-2xl border border-amber-300/20 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.18),transparent_38%),linear-gradient(135deg,#151922,#090b0f)] p-5 shadow-[0_24px_60px_rgba(0,0,0,0.3)] sm:p-6">
        <div className="absolute -right-20 -top-28 h-64 w-64 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div><p className="text-[10px] font-black uppercase tracking-[0.32em] text-amber-400">FuzedFlow Intelligence</p><h1 className="mt-2 text-2xl font-black uppercase tracking-tight sm:text-4xl">Sales Performance</h1><p className="mt-1 text-base font-bold text-amber-200">Turn more leads into revenue.</p><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Monitor your sales pipeline, team performance and revenue using live CRM activity.</p></div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-[190px]"><Label className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-500">Date range</Label><Select value={preset} onValueChange={setPreset}><SelectTrigger className="h-11 border-white/10 bg-white/[0.06] font-bold text-white"><SelectValue /></SelectTrigger><SelectContent>{DATE_OPTIONS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
            <div className="flex h-11 items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3"><span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:hidden" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" /></span><span><span className="block text-xs font-black uppercase text-emerald-300">Live</span><span className="block text-[10px] text-slate-500">Updated {query.dataUpdatedAt ? formatDistanceToNow(query.dataUpdatedAt, { addSuffix: true }) : "just now"}</span></span></div>
            <Button type="button" variant="outline" onClick={() => setCustomizeOpen(true)} className="h-11 border-white/10 bg-white/[0.06] px-3 text-white hover:bg-white/10 hover:text-white"><SlidersHorizontal className="mr-2 h-4 w-4" />Customize</Button>
            <Button type="button" variant="outline" aria-label="Refresh sales performance" onClick={() => query.refetch()} disabled={query.isFetching} className="h-11 border-white/10 bg-white/[0.06] text-white hover:bg-white/10 hover:text-white"><RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} /></Button>
          </div>
        </div>
        {preset === "custom" ? <div className="relative mt-5 grid max-w-md grid-cols-2 gap-3"><div><Label htmlFor="sales-from" className="text-xs text-slate-400">From</Label><Input id="sales-from" type="date" value={custom.start} onChange={event => setCustom(current => ({ ...current, start: event.target.value }))} className="mt-1 border-white/10 bg-black/30 text-white" /></div><div><Label htmlFor="sales-to" className="text-xs text-slate-400">To</Label><Input id="sales-to" type="date" value={custom.end} onChange={event => setCustom(current => ({ ...current, end: event.target.value }))} className="mt-1 border-white/10 bg-black/30 text-white" /></div></div> : null}
      </header>

      <div className="rounded-2xl border border-white/10 bg-[#11151c] p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-400"><Filter className="h-4 w-4 text-amber-400" />Filters</div>
          <div className="grid w-full gap-2 sm:grid-cols-3 lg:w-auto lg:min-w-[660px]">
            <Select value={filters.rep} onValueChange={value => setFilters(current => ({ ...current, rep: value }))}><SelectTrigger className="h-11 border-white/10 bg-white/[0.05] text-white"><SelectValue placeholder="Lead creator" /></SelectTrigger><SelectContent><SelectItem value="all">All lead creators</SelectItem>{report.filterOptions.reps.map(rep => <SelectItem key={rep.id} value={String(rep.id)}>{rep.full_name || rep.email}</SelectItem>)}</SelectContent></Select>
            <Select value={filters.source} onValueChange={value => setFilters(current => ({ ...current, source: value }))}><SelectTrigger className="h-11 border-white/10 bg-white/[0.05] text-white"><SelectValue placeholder="Lead source" /></SelectTrigger><SelectContent><SelectItem value="all">All lead sources</SelectItem>{report.filterOptions.sources.map(source => <SelectItem key={source} value={source}>{source}</SelectItem>)}</SelectContent></Select>
            <Select value={filters.stage} onValueChange={value => setFilters(current => ({ ...current, stage: value }))}><SelectTrigger className="h-11 border-white/10 bg-white/[0.05] text-white"><SelectValue placeholder="Pipeline stage" /></SelectTrigger><SelectContent><SelectItem value="all">All pipeline stages</SelectItem>{SALES_STAGE_FILTERS.map(stage => <SelectItem key={stage} value={stage}>{stage}</SelectItem>)}</SelectContent></Select>
          </div>
          {hasFilters ? <Button type="button" variant="ghost" onClick={clearFilters} className="h-11 justify-center text-amber-300 hover:bg-amber-400/10 hover:text-amber-200"><X className="mr-1 h-4 w-4" />Clear filters</Button> : null}
        </div>
      </div>

      {!report.currentLeads.length ? <div className="rounded-2xl border border-amber-300/20 bg-gradient-to-br from-amber-400/10 to-transparent p-6 text-center sm:p-10"><Target className="mx-auto h-11 w-11 text-amber-300" /><h2 className="mt-4 text-xl font-black text-white">No leads match this view</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-400">Choose a broader date range, clear the filters, or add a lead to start measuring sales performance.</p><div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">{hasFilters ? <Button type="button" variant="outline" onClick={clearFilters} className="border-white/10 bg-white/[0.05] text-white hover:bg-white/10 hover:text-white">Clear filters</Button> : null}<Button type="button" onClick={() => navigate("/LeadTracker")} className="bg-amber-400 font-black text-slate-950 hover:bg-amber-300">Open Lead Tracker</Button></div></div> : null}

      <div className="flex flex-col gap-5">
      {visibleCount(report.kpis.map(metric => `metric:${metric.id}`)) ? <div style={{ order: groupOrder("metrics") }} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{report.kpis.filter(metric => isVisible(`metric:${metric.id}`)).map(metric => <MetricCard key={metric.id} metric={metric} onClick={() => showRecords(metric.label, report.drilldowns?.[metric.id] || [])} />)}</div> : null}

      {visibleCount(["funnel:sales", "funnel:conversion"]) ? <div style={{ order: groupOrder("funnel") }} className={`grid gap-5 ${visibleCount(["funnel:sales", "funnel:conversion"]) > 1 ? "xl:grid-cols-[minmax(0,2fr)_minmax(310px,1fr)]" : ""}`}>
        {isVisible("funnel:sales") ? <Panel title="Sales funnel" eyebrow="Current pipeline" icon={Gauge} action={<span className="flex items-center gap-2 text-[10px] font-black uppercase text-emerald-400"><span className="h-2 w-2 rounded-full bg-emerald-400" />Live</span>}>
          <div className="space-y-2 p-4 sm:p-5">{report.funnelStages.map((stage, index) => {
            const max = Math.max(1, report.funnelStages[0]?.count || 1); const width = Math.max(26, (stage.count / max) * 100); const selected = filters.stage === stage.stage;
            return <button key={stage.stage} type="button" onClick={() => setFilters(current => ({ ...current, stage: current.stage === stage.stage ? "all" : stage.stage }))} className={`group relative mx-auto flex min-h-14 items-center justify-between overflow-hidden rounded-xl border px-4 py-2 text-left transition focus-visible:ring-2 focus-visible:ring-amber-400 ${selected ? "border-amber-300 bg-amber-400/20" : "border-white/10 bg-white/[0.04] hover:border-amber-300/40"}`} style={{ width: `${width}%` }}>
              <span className="min-w-0"><span className="block truncate text-xs font-black uppercase tracking-wider text-slate-300">{stage.stage}</span><span className="mt-0.5 block text-[10px] text-slate-500">{stage.percent.toFixed(1)}% of leads</span></span><span className="ml-3 text-right"><span className="block text-xl font-black text-white">{stage.count}</span><span className="block text-[10px] font-bold text-amber-300">{formatCurrencyUSD(stage.value)}</span></span>{index < report.funnelStages.length - 1 ? <span className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-amber-400/25 to-transparent" /> : null}
            </button>;
          })}<p className="pt-2 text-center text-[10px] leading-4 text-slate-600">Funnel reporting starts with saved CRM leads. Website visitor analytics are not connected.</p></div>
        </Panel> : null}

        {isVisible("funnel:conversion") ? <Panel title="Pipeline conversion" eyebrow="Stage efficiency" icon={TrendingUp}>
          <div className="space-y-4 p-4 sm:p-5">{report.conversions.map(item => <div key={`${item.from}-${item.to}`}><div className="mb-1.5 flex items-center justify-between gap-3 text-xs"><span className="truncate font-bold text-slate-300">{item.from} → {item.to}</span><span className="font-black text-white">{item.rate.toFixed(1)}%</span></div><div className="h-2 overflow-hidden rounded-full bg-white/5"><div className={`h-full rounded-full ${report.bottleneck === item ? "bg-orange-500" : "bg-gradient-to-r from-amber-500 to-yellow-300"}`} style={{ width: `${Math.min(100, item.rate)}%` }} /></div></div>)}
            {report.bottleneck ? <div className="rounded-xl border border-orange-400/20 bg-orange-400/10 p-3"><p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-orange-300"><AlertTriangle className="h-4 w-4" />Pipeline bottleneck</p><p className="mt-2 text-sm leading-5 text-slate-300">Only {report.bottleneck.rate.toFixed(1)}% of {report.bottleneck.from.toLowerCase()} leads are reaching {report.bottleneck.to.toLowerCase()}.</p><Button type="button" variant="ghost" onClick={() => showRecords(`Leads at ${report.bottleneck.from}`, report.funnelStages.find(item => item.stage === report.bottleneck.from)?.records || [])} className="mt-2 h-9 px-0 text-amber-300 hover:bg-transparent hover:text-amber-200">View leads <ArrowRight className="ml-1 h-4 w-4" /></Button></div> : null}
          </div>
        </Panel> : null}
      </div> : null}

      {visibleCount(["activity:flow", "activity:live"]) ? <div style={{ order: groupOrder("activity") }} className={`grid gap-5 ${visibleCount(["activity:flow", "activity:live"]) > 1 ? "xl:grid-cols-[minmax(0,2fr)_minmax(310px,1fr)]" : ""}`}>
        {isVisible("activity:flow") ? <Panel title="Lead flow over time" eyebrow="Performance trend" icon={BarChart3} action={<div className="flex gap-1">{["daily", "weekly", "monthly"].map(value => <button key={value} type="button" onClick={() => setInterval(value)} className={`rounded-lg px-2 py-1 text-[10px] font-black uppercase ${interval === value ? "bg-amber-400 text-slate-950" : "text-slate-500 hover:bg-white/5"}`}>{value}</button>)}</div>}>
          <div className="p-4 sm:p-5"><div className="mb-4 flex flex-wrap gap-1.5">{[["leads","Leads"],["qualified","Qualified"],["appointments","Appointments"],["quotes","Quotes"],["won","Won"],["revenue","Revenue"]].map(([value,label]) => <button key={value} type="button" onClick={() => setFlowMetric(value)} className={`rounded-full border px-3 py-1.5 text-xs font-bold ${flowMetric === value ? "border-amber-300/50 bg-amber-400/15 text-amber-200" : "border-white/10 text-slate-500"}`}>{label}</button>)}</div><div className="h-72"><ResponsiveContainer width="100%" height="100%"><AreaChart data={report.flow} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}><defs><linearGradient id="salesFlow" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#fbbf24" stopOpacity={0.42} /><stop offset="100%" stopColor="#fbbf24" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid stroke="#ffffff0d" vertical={false} /><XAxis dataKey="label" stroke="#64748b" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} /><YAxis stroke="#64748b" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickFormatter={value => flowMetric === "revenue" ? `$${Math.round(value / 1000)}k` : value} /><ChartTooltip contentStyle={{ background: "#111827", border: "1px solid #334155", borderRadius: 12 }} formatter={value => flowMetric === "revenue" ? formatCurrencyUSD(value) : value} /><Area type="monotone" dataKey={flowMetric} stroke="#fbbf24" strokeWidth={3} fill="url(#salesFlow)" activeDot={{ r: 5, fill: "#fbbf24" }} /></AreaChart></ResponsiveContainer></div></div>
        </Panel> : null}
        {isVisible("activity:live") ? <Panel title="Live activity" eyebrow="Newest events" icon={Activity}>
          <div className="max-h-[390px] overflow-y-auto p-3 sm:p-4">{report.activity.length ? <div className="space-y-2">{report.activity.map(item => <button key={item.id} type="button" onClick={() => item.lead_id && navigateLead(item.lead_id)} className="flex w-full gap-3 rounded-xl border border-transparent p-2 text-left hover:border-white/10 hover:bg-white/[0.04]"><ActivityIcon type={item.activity_type} /><span className="min-w-0"><span className="block truncate text-sm font-bold text-white">{item.title}</span><span className="mt-0.5 block truncate text-xs text-slate-500">{item.description || item.activity_type.replaceAll("_", " ")}</span><span className="mt-1 block text-[10px] font-bold uppercase text-amber-400/70">{formatDistanceToNow(new Date(item.occurred_at), { addSuffix: true })}</span></span></button>)}</div> : <p className="py-12 text-center text-sm text-slate-500">New sales activity will appear here as it occurs.</p>}</div>
        </Panel> : null}
      </div> : null}

      {visibleCount(["pipeline:sources", "pipeline:value"]) ? <div style={{ order: groupOrder("pipeline") }} className={`grid gap-5 ${visibleCount(["pipeline:sources", "pipeline:value"]) > 1 ? "xl:grid-cols-2" : ""}`}>
        {isVisible("pipeline:sources") ? <Panel title="Lead source breakdown" eyebrow="Acquisition" icon={PieChartIcon}>
          <div className="grid gap-3 p-4 sm:grid-cols-[220px_1fr] sm:p-5"><div className="h-56"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={report.sourceBreakdown} dataKey="leads" nameKey="source" innerRadius={54} outerRadius={82} paddingAngle={3}>{report.sourceBreakdown.map((entry,index) => <Cell key={entry.source} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}</Pie><ChartTooltip contentStyle={{ background: "#111827", border: "1px solid #334155", borderRadius: 12 }} /></PieChart></ResponsiveContainer></div><div className="space-y-2">{report.sourceBreakdown.slice(0,7).map((source,index) => <button key={source.source} type="button" onClick={() => setFilters(current => ({ ...current, source: source.source }))} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-white/[0.04]"><span className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} /><span className="truncate text-sm font-bold text-slate-300">{source.source}</span></span><span className="text-right"><span className="block text-sm font-black text-white">{source.leads}</span><span className="block text-[10px] text-slate-500">{source.conversion.toFixed(1)}% won</span></span></button>)}</div></div>
        </Panel> : null}
        {isVisible("pipeline:value") ? <Panel title="Pipeline value by stage" eyebrow="Active opportunity value" icon={DollarSign}>
          <div className="h-80 p-4 sm:p-5"><ResponsiveContainer width="100%" height="100%"><BarChart data={report.pipelineByStage} layout="vertical" margin={{ left: 18, right: 20 }}><CartesianGrid stroke="#ffffff0d" horizontal={false} /><XAxis type="number" stroke="#64748b" tickLine={false} axisLine={false} tickFormatter={value => `$${Math.round(value/1000)}k`} /><YAxis type="category" dataKey="stage" width={90} stroke="#94a3b8" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} /><ChartTooltip cursor={{ fill: "#ffffff08" }} contentStyle={{ background: "#111827", border: "1px solid #334155", borderRadius: 12 }} formatter={value => formatCurrencyUSD(value)} /><Bar dataKey="value" fill="#fbbf24" radius={[0,8,8,0]} /></BarChart></ResponsiveContainer></div>
        </Panel> : null}
      </div> : null}

      {visibleCount(["team:performance", "team:leaders"]) ? <div style={{ order: groupOrder("team") }} className={`grid gap-5 ${visibleCount(["team:performance", "team:leaders"]) > 1 ? "xl:grid-cols-[minmax(0,2fr)_minmax(310px,1fr)]" : ""}`}>
        {isVisible("team:performance") ? <Panel title="Sales rep performance" eyebrow="Attributed to lead creator" icon={Users}>
          <div className="overflow-x-auto p-3 sm:p-5"><table className="w-full min-w-[720px] text-left text-sm"><thead><tr className="border-b border-white/10 text-[10px] font-black uppercase tracking-wider text-slate-500"><th className="px-3 py-3">Lead creator</th><th className="px-3 py-3 text-right">Leads</th><th className="px-3 py-3 text-right">Visits</th><th className="px-3 py-3 text-right">Quotes</th><th className="px-3 py-3 text-right">Won</th><th className="px-3 py-3 text-right">Revenue</th><th className="px-3 py-3 text-right">Close</th></tr></thead><tbody>{report.repPerformance.map((rep,index) => <tr key={rep.id} onClick={() => setFilters(current => ({ ...current, rep: rep.id }))} className="cursor-pointer border-b border-white/5 text-slate-300 hover:bg-white/[0.04]"><td className="px-3 py-3"><span className="flex items-center gap-3"><span className={`flex h-9 w-9 items-center justify-center rounded-xl font-black ${index === 0 ? "bg-amber-400 text-slate-950" : "bg-white/5 text-slate-300"}`}>{rep.name.charAt(0)}</span><span className="font-bold text-white">{rep.name}</span></span></td><td className="px-3 py-3 text-right font-bold">{rep.leads}</td><td className="px-3 py-3 text-right">{rep.appointments}</td><td className="px-3 py-3 text-right">{rep.quotes}</td><td className="px-3 py-3 text-right text-emerald-400">{rep.won}</td><td className="px-3 py-3 text-right font-black text-amber-300">{formatCurrencyUSD(rep.revenue)}</td><td className="px-3 py-3 text-right">{rep.closeRate.toFixed(1)}%</td></tr>)}</tbody></table>{!report.repPerformance.length ? <p className="py-10 text-center text-sm text-slate-500">Creator performance appears after new leads are saved.</p> : null}</div>
        </Panel> : null}
        {isVisible("team:leaders") ? <Panel title="Top performers" eyebrow="By lead creator" icon={Award}>
          <div className="space-y-2 p-4">{report.repPerformance.slice(0,5).map((rep,index) => <button key={rep.id} type="button" onClick={() => setFilters(current => ({ ...current, rep: rep.id }))} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${index === 0 ? "border-amber-300/30 bg-amber-400/10" : "border-white/5 bg-white/[0.03]"}`}><span className={`text-xl font-black ${index === 0 ? "text-amber-300" : "text-slate-600"}`}>#{index+1}</span><span className="min-w-0 flex-1"><span className="block truncate font-bold text-white">{rep.name}</span><span className="block text-xs text-slate-500">{rep.won} won · {rep.closeRate.toFixed(1)}% close</span></span><span className="font-black text-amber-300">{formatCurrencyUSD(rep.revenue)}</span></button>)}</div>
        </Panel> : null}
      </div> : null}

      {visibleCount(["planning:forecast", "planning:target", "planning:followup"]) ? <div style={{ order: groupOrder("planning") }} className={`grid gap-5 ${visibleCount(["planning:forecast", "planning:target", "planning:followup"]) === 3 ? "lg:grid-cols-3" : visibleCount(["planning:forecast", "planning:target", "planning:followup"]) === 2 ? "lg:grid-cols-2" : ""}`}>
        {isVisible("planning:forecast") ? <Panel title="Revenue forecast" eyebrow="Weighted outlook" icon={Gauge}>
          <div className="space-y-3 p-4 sm:p-5">{[["Current pipeline",report.forecast.currentPipeline],["Weighted forecast",report.forecast.weightedPipeline],["Best case",report.forecast.bestCase],["Most likely",report.forecast.mostLikely],["Conservative",report.forecast.worstCase]].map(([label,value],index) => <div key={label} className={`flex items-center justify-between rounded-xl px-3 py-2.5 ${index === 1 ? "border border-amber-300/25 bg-amber-400/10" : "bg-white/[0.03]"}`}><span className="text-xs font-bold text-slate-400">{label}</span><span className="font-black text-white">{formatCurrencyUSD(value)}</span></div>)}</div>
        </Panel> : null}
        {isVisible("planning:target") ? <Panel title="Monthly sales target" eyebrow="Goal progress" icon={Target} action={<Button type="button" variant="ghost" onClick={() => setTargetOpen(true)} className="h-9 text-xs font-bold text-amber-300 hover:bg-amber-400/10 hover:text-amber-200">Edit target</Button>}>
          <div className="p-4 sm:p-5"><div className="flex items-end justify-between gap-3"><div><p className="text-xs font-bold text-slate-500">Current</p><p className="mt-1 text-2xl font-black text-white">{formatCurrencyUSD(report.target.current)}</p></div><p className="text-2xl font-black text-amber-300">{report.target.progress.toFixed(1)}%</p></div><div className="mt-4 h-3 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-yellow-300" style={{ width: `${report.target.progress}%` }} /></div><div className="mt-4 grid grid-cols-2 gap-2 text-xs">{[["Target",report.target.amount],["Remaining",report.target.remaining],["Days left",report.target.daysRemaining],["Daily required",report.target.requiredDaily]].map(([label,value],index) => <div key={label} className="rounded-xl bg-white/[0.03] p-3"><p className="text-slate-500">{label}</p><p className="mt-1 font-black text-white">{index === 2 ? value : formatCurrencyUSD(value)}</p></div>)}</div></div>
        </Panel> : null}
        {isVisible("planning:followup") ? <Panel title="Follow-up health" eyebrow="Attention required" icon={CheckCircle2}>
          <div className="p-4 sm:p-5"><div className={`rounded-xl border p-4 ${report.followUp.overdue ? "border-red-400/25 bg-red-400/10" : "border-emerald-400/20 bg-emerald-400/10"}`}><p className={`text-2xl font-black ${report.followUp.overdue ? "text-red-300" : "text-emerald-300"}`}>{report.followUp.overdue}</p><p className="mt-1 text-xs font-black uppercase tracking-wider text-slate-300">Leads need attention</p></div><div className="mt-3 grid grid-cols-2 gap-2">{[["Awaiting",report.followUp.awaiting],["Due today",report.followUp.today],["Completed",report.followUp.completed],["Reminders",report.followUp.reminders]].map(([label,value]) => <div key={label} className="rounded-xl bg-white/[0.03] p-3"><p className="text-xl font-black text-white">{value}</p><p className="text-[10px] font-bold uppercase text-slate-500">{label}</p></div>)}</div><Button type="button" onClick={() => navigate("/LeadTracker")} className="mt-4 w-full bg-amber-400 font-black text-slate-950 hover:bg-amber-300">View follow-ups</Button></div>
        </Panel> : null}
      </div> : null}

      {visibleCount(["outcomes:hot", "outcomes:lost"]) ? <div style={{ order: groupOrder("outcomes") }} className={`grid gap-5 ${visibleCount(["outcomes:hot", "outcomes:lost"]) > 1 ? "xl:grid-cols-3" : ""}`}>
        {isVisible("outcomes:hot") ? <Panel title="Hot leads" eyebrow="Priority opportunities" icon={Flame} className={visibleCount(["outcomes:hot", "outcomes:lost"]) > 1 ? "xl:col-span-2" : ""}>
          <div className="grid gap-2 p-4 sm:grid-cols-2 sm:p-5">{report.hotLeads.map(lead => <button key={lead.id} type="button" onClick={() => navigateLead(lead.id)} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 text-left hover:border-amber-300/30"><span className="flex items-start justify-between gap-3"><span className="min-w-0"><span className="block truncate font-bold text-white">{lead.contact_name}</span><span className="mt-1 block truncate text-xs text-slate-500">{lead.service_type || lead.pipeline_stage} · {lead.assignee}</span></span><span className="rounded-full bg-orange-400/15 px-2 py-1 text-xs font-black text-orange-300">{lead.score}%</span></span><span className="mt-3 flex items-center justify-between text-xs"><span className="text-slate-500">Opportunity value</span><span className="font-black text-amber-300">{formatCurrencyUSD(lead.value)}</span></span></button>)}</div>
        </Panel> : null}
        {isVisible("outcomes:lost") ? <Panel title="Why are we losing deals?" eyebrow="Lost deal analysis" icon={AlertTriangle}>
          <div className="space-y-2 p-4">{report.lostReasons.length ? report.lostReasons.slice(0,6).map(reason => <div key={reason.reason} className="rounded-xl bg-white/[0.03] p-3"><div className="flex items-center justify-between gap-3"><span className="truncate text-sm font-bold text-white">{reason.reason}</span><span className="font-black text-red-300">{reason.count}</span></div><p className="mt-1 text-xs text-slate-500">{formatCurrencyUSD(reason.value)} lost value</p><p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-600">{Object.entries(reason.sources || {}).map(([source, count]) => `${count} ${source}`).join(" · ")}</p></div>) : <div className="py-10 text-center"><AlertTriangle className="mx-auto h-9 w-9 text-slate-600" /><p className="mt-3 text-sm text-slate-500">Lost reasons will appear as they are recorded.</p></div>}</div>
        </Panel> : null}
      </div> : null}

      {isVisible("insights:recommendations") ? <div style={{ order: groupOrder("insights") }}><Panel title="FuzedFlow sales insights" eyebrow="Recommended actions" icon={Sparkles}>
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4 sm:p-5">{report.insights.map((insight,index) => <div key={`${insight.text}-${index}`} className={`rounded-xl border p-4 ${insight.tone === "warning" ? "border-orange-400/25 bg-orange-400/10" : insight.tone === "positive" ? "border-emerald-400/20 bg-emerald-400/10" : "border-white/10 bg-white/[0.03]"}`}><p className="text-sm leading-6 text-slate-200">{insight.text}</p><Button type="button" variant="ghost" onClick={() => insight.leadId ? navigateLead(insight.leadId) : insight.source ? setFilters(current => ({ ...current, source: insight.source })) : insight.stage ? showRecords(insight.action, report.funnelStages.find(stage => stage.stage === insight.stage)?.records || []) : navigate("/LeadTracker")} className="mt-2 h-9 px-0 text-amber-300 hover:bg-transparent hover:text-amber-200">{insight.action}<ArrowRight className="ml-1 h-4 w-4" /></Button></div>)}</div>
      </Panel></div> : null}
      </div>

      {activeStage ? <p className="sr-only" aria-live="polite">Dashboard filtered to {activeStage.stage}: {activeStage.count} records.</p> : null}
    </div>
    <RecordDialog open={!!recordView} onOpenChange={open => !open && setRecordView(null)} title={recordView?.title || "Sales records"} records={recordView?.records || []} onOpenLead={navigateLead} />
    <TargetDialog open={targetOpen} onOpenChange={setTargetOpen} companyId={companyId} currentTarget={query.data?.target} monthStart={query.monthStart} onSaved={() => queryClient.invalidateQueries({ queryKey: ["sales-performance", companyId] })} />
    <DashboardCustomizeDialog open={customizeOpen} onOpenChange={setCustomizeOpen} layout={layout} onChange={setLayout} />
  </div>;
}
