import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Eye,
  FileCheck,
  RefreshCcw,
  Search,
  Send,
  ShoppingCart,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/api/supabaseClient";
import ApprovalDecisionDialog from "@/components/approvals/ApprovalDecisionDialog";
import ApprovalQueueCard from "@/components/approvals/ApprovalQueueCard";
import ApprovalSummaryCard from "@/components/approvals/ApprovalSummaryCard";
import SendQuoteEmailDialog from "@/components/quotes/SendQuoteEmailDialog";
import DataTable from "@/components/shared/DataTable";
import EmptyState from "@/components/shared/EmptyState";
import PageHeader from "@/components/shared/PageHeader";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buildQuoteApprovalRows, matchesApprovalSearch, pendingTotal, quotePublicUrl } from "@/lib/approvalHub";
import { useAuth } from "@/lib/AuthContext";
import { purchaseOrderStatusUpdate } from "@/lib/costNotificationWorkflows";

const VIEWS = [
  { id: "action_queue", label: "Action queue" },
  { id: "quotes", label: "Client quotes" },
  { id: "change_orders", label: "Change orders" },
  { id: "purchase_orders", label: "Purchase orders" },
];

const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function formatCurrency(amount) {
  return MONEY.format(Number(amount) || 0);
}

function formatDate(value) {
  if (!value) return "—";
  const source = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
  const date = new Date(source);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function FilterBar({ search, onSearchChange, searchLabel, placeholder, status, onStatusChange, statuses }) {
  return (
    <div className="flex w-full flex-col gap-3 sm:flex-row">
      <div className="relative w-full flex-1 sm:max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <Input
          aria-label={searchLabel}
          placeholder={placeholder}
          value={search}
          onChange={event => onSearchChange(event.target.value)}
          className="min-h-11 bg-white pl-10"
        />
      </div>
      {statuses && (
        <Select value={status} onValueChange={onStatusChange}>
          <SelectTrigger aria-label="Filter by status" className="min-h-11 w-full bg-white sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {statuses.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function EmptyResults({ icon, title, description }) {
  return (
    <Card className="border-dashed border-slate-200 bg-white p-8 shadow-sm">
      <EmptyState icon={icon} title={title} description={description} />
    </Card>
  );
}

function LoadingCard({ label }) {
  return <Card className="border-slate-200 bg-white p-6"><p role="status" className="text-sm text-slate-600">Loading {label}…</p></Card>;
}

export default function Approvals() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  const [activeView, setActiveView] = useState("action_queue");
  const [searchAction, setSearchAction] = useState("");
  const [searchQuotes, setSearchQuotes] = useState("");
  const [filterQuotes, setFilterQuotes] = useState("all");
  const [searchCO, setSearchCO] = useState("");
  const [filterCO, setFilterCO] = useState("all");
  const [searchPO, setSearchPO] = useState("");
  const [filterPO, setFilterPO] = useState("all");
  const [decision, setDecision] = useState(null);
  const [quoteToResend, setQuoteToResend] = useState(null);

  const queryOptions = { enabled: !!companyId };
  const quoteApprovalsQuery = useQuery({
    queryKey: ["approvals", companyId],
    ...queryOptions,
    queryFn: async () => {
      const { data, error } = await supabase.from("quote_approvals")
        .select("id, quote_id, client_id, approval_status, signer_name, sent_at, viewed_at, signed_at, created_at")
        .eq("company_id", companyId).order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
  const quotesQuery = useQuery({
    queryKey: ["quotes_lookup", companyId],
    ...queryOptions,
    queryFn: async () => {
      const { data, error } = await supabase.from("quotes")
        .select("id, title, quote_number, site_address, total, issue_date, created_at, updated_at, client_id, status, next_follow_up_date, sent_at, viewed_at, signed_at, is_template")
        .eq("company_id", companyId);
      if (error) throw error;
      return data || [];
    },
  });
  const quoteViewsQuery = useQuery({
    queryKey: ["quote_views", companyId],
    ...queryOptions,
    queryFn: async () => {
      const { data, error } = await supabase.from("quote_views")
        .select("quote_id, viewed_at, viewer_type")
        .eq("company_id", companyId).eq("viewer_type", "client");
      if (error) throw error;
      return data || [];
    },
  });
  const clientsQuery = useQuery({
    queryKey: ["clients_lookup", companyId],
    ...queryOptions,
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, name, email").eq("company_id", companyId);
      if (error) throw error;
      return data || [];
    },
  });
  const projectsQuery = useQuery({
    queryKey: ["projects_lookup", companyId],
    ...queryOptions,
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("id, name, client_id, site_address").eq("company_id", companyId);
      if (error) throw error;
      return data || [];
    },
  });
  const vendorsQuery = useQuery({
    queryKey: ["vendors_lookup", companyId],
    ...queryOptions,
    queryFn: async () => {
      const { data, error } = await supabase.from("vendors").select("id, name").eq("company_id", companyId);
      if (error) throw error;
      return data || [];
    },
  });
  const changeOrdersQuery = useQuery({
    queryKey: ["change_orders", companyId],
    ...queryOptions,
    queryFn: async () => {
      const { data, error } = await supabase.from("change_orders")
        .select("id, project_id, client_id, title, change_order_number, status, issue_date, total, created_at, next_follow_up_date, approval_due_date")
        .eq("company_id", companyId).order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
  const purchaseOrdersQuery = useQuery({
    queryKey: ["purchase_orders", companyId],
    ...queryOptions,
    queryFn: async () => {
      const { data, error } = await supabase.from("purchase_orders")
        .select("id, vendor_id, project_id, po_number, status, order_date, expected_delivery_date, total, created_at, approved_amount")
        .eq("company_id", companyId).order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const quotes = quotesQuery.data || [];
  const clients = clientsQuery.data || [];
  const projects = projectsQuery.data || [];
  const vendors = vendorsQuery.data || [];
  const changeOrders = changeOrdersQuery.data || [];
  const purchaseOrders = purchaseOrdersQuery.data || [];

  const clientById = useMemo(() => Object.fromEntries(clients.map(client => [client.id, client])), [clients]);
  const projectById = useMemo(() => Object.fromEntries(projects.map(project => [project.id, project])), [projects]);
  const vendorById = useMemo(() => Object.fromEntries(vendors.map(vendor => [vendor.id, vendor])), [vendors]);
  const quoteRows = useMemo(
    () => buildQuoteApprovalRows(quotes, quoteApprovalsQuery.data || [], quoteViewsQuery.data || []),
    [quotes, quoteApprovalsQuery.data, quoteViewsQuery.data],
  );

  const pendingChangeOrders = useMemo(() => changeOrders.filter(order => order.status === "Pending").map(order => {
    const project = projectById[order.project_id];
    return {
      id: order.id,
      kind: "change_order",
      number: order.change_order_number,
      title: order.title,
      party: clientById[order.client_id || project?.client_id]?.name,
      project: project?.name,
      date: order.approval_due_date || order.issue_date || order.created_at,
      amount: order.total,
      status: order.status,
    };
  }), [changeOrders, clientById, projectById]);

  const pendingPurchaseOrders = useMemo(() => purchaseOrders.filter(order => order.status === "Pending Approval").map(order => ({
    id: order.id,
    kind: "purchase_order",
    number: order.po_number,
    title: vendorById[order.vendor_id]?.name || "Vendor purchase order",
    party: vendorById[order.vendor_id]?.name,
    project: projectById[order.project_id]?.name,
    date: order.order_date || order.created_at,
    amount: order.total,
    status: order.status,
  })), [purchaseOrders, projectById, vendorById]);

  const actionItems = useMemo(() => [...pendingChangeOrders, ...pendingPurchaseOrders]
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0)), [pendingChangeOrders, pendingPurchaseOrders]);

  const filteredActionItems = useMemo(() => actionItems.filter(item => matchesApprovalSearch(
    [item.number, item.title, item.party, item.project, item.status], searchAction,
  )), [actionItems, searchAction]);
  const filteredQuotes = useMemo(() => quoteRows.filter(quote => {
    const client = clientById[quote.client_id];
    return (filterQuotes === "all" || quote.approval_status === filterQuotes)
      && matchesApprovalSearch([quote.quote_number, quote.title, quote.site_address, client?.name, quote.signer_name], searchQuotes);
  }), [quoteRows, clientById, filterQuotes, searchQuotes]);
  const filteredChangeOrders = useMemo(() => changeOrders.filter(order => {
    const project = projectById[order.project_id];
    return order.status !== "Pending Review"
      && (filterCO === "all" || order.status === filterCO)
      && matchesApprovalSearch([order.change_order_number, order.title, project?.name, clientById[order.client_id || project?.client_id]?.name], searchCO);
  }), [changeOrders, projectById, clientById, filterCO, searchCO]);
  const filteredPurchaseOrders = useMemo(() => purchaseOrders.filter(order => (
    (filterPO === "all" || order.status === filterPO)
    && matchesApprovalSearch([order.po_number, vendorById[order.vendor_id]?.name, projectById[order.project_id]?.name], searchPO)
  )), [purchaseOrders, vendorById, projectById, filterPO, searchPO]);

  // Keep the guarded transition available to the existing workflow implementation,
  // while internal-review controls remain hidden from this hub.
  const internalReviewMutation = useMutation({
    mutationFn: async ({ id, documentType, outcome }) => {
      if (!companyId || !profile?.id || !["quote", "change_order"].includes(documentType) || !["Approved", "Changes Required"].includes(outcome)) {
        throw new Error("The review cannot be saved.");
      }
      const table = documentType === "quote" ? "quotes" : "change_orders";
      const { data, error } = await supabase.from(table).update({
        status: "Draft",
        internal_review_status: outcome,
        internal_reviewed_at: new Date().toISOString(),
        internal_reviewed_by: profile.id,
      }).eq("id", id).eq("company_id", companyId).eq("status", "Pending Review").select("id").maybeSingle();
      if (error || !data?.id) throw error || new Error("This document is no longer awaiting review.");
    },
    onSuccess: (_, variables) => {
      setDecision(null);
      queryClient.invalidateQueries({ queryKey: ["quotes_lookup", companyId] });
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      queryClient.invalidateQueries({ queryKey: ["change_orders", companyId] });
      queryClient.invalidateQueries({ queryKey: ["change-orders"] });
      queryClient.invalidateQueries({ queryKey: [variables.documentType === "quote" ? "quote" : "change-order", variables.id] });
      toast.success(variables.outcome === "Approved" ? "Internal review approved. The draft is ready to send." : "Returned to draft for changes.");
    },
    onError: error => toast.error(error.message || "Could not save the review. Refresh and try again."),
  });

  const updateCOStatusMutation = useMutation({
    mutationFn: async ({ id, status }) => {
      if (!companyId || !["Approved", "Rejected"].includes(status)) throw new Error("The decision cannot be saved.");
      const { data, error } = await supabase.from("change_orders").update({ status })
        .eq("id", id).eq("company_id", companyId).eq("status", "Pending").select("id").maybeSingle();
      if (error || !data?.id) throw error || new Error("This change order is no longer pending.");
    },
    onSuccess: (_, variables) => {
      setDecision(null);
      queryClient.invalidateQueries({ queryKey: ["change_orders", companyId] });
      queryClient.invalidateQueries({ queryKey: ["change-orders"] });
      queryClient.invalidateQueries({ queryKey: ["change-order", variables.id] });
      toast.success(`Change order ${variables.status.toLowerCase()}.`);
    },
    onError: error => toast.error(error.message || "Could not save the change order decision. Refresh and try again."),
  });

  const updatePOStatusMutation = useMutation({
    mutationFn: async ({ id, status }) => {
      if (!companyId || !["Approved", "Rejected"].includes(status)) throw new Error("The decision cannot be saved.");
      const order = purchaseOrders.find(item => item.id === id);
      if (!order) throw new Error("This purchase order could not be found.");
      const { data, error } = await supabase.from("purchase_orders").update(purchaseOrderStatusUpdate(status, order))
        .eq("id", id).eq("company_id", companyId).eq("status", "Pending Approval").select("id").maybeSingle();
      if (error || !data?.id) throw error || new Error("This purchase order is no longer pending approval.");
    },
    onSuccess: (_, variables) => {
      setDecision(null);
      queryClient.invalidateQueries({ queryKey: ["purchase_orders", companyId] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["purchase_order", variables.id] });
      toast.success(`Purchase order ${variables.status.toLowerCase()}.`);
    },
    onError: error => toast.error(error.message || "Could not save the purchase order decision. Refresh and try again."),
  });

  const allQueries = [quoteApprovalsQuery, quotesQuery, quoteViewsQuery, clientsQuery, projectsQuery, vendorsQuery, changeOrdersQuery, purchaseOrdersQuery];
  const isLoading = allQueries.some(query => query.isPending);
  const isRefreshing = allQueries.some(query => query.isFetching);
  const loadError = allQueries.find(query => query.error)?.error;
  const decisionBusy = !!loadError || internalReviewMutation.isPending || updateCOStatusMutation.isPending || updatePOStatusMutation.isPending;
  const waitingClientQuotes = quoteRows.filter(quote => ["Sent", "Viewed"].includes(quote.approval_status));
  const actionValue = pendingTotal(changeOrders, ["Pending"])
    + pendingTotal(purchaseOrders, ["Pending Approval"]);
  const counts = {
    action_queue: actionItems.length,
    quotes: quoteRows.length,
    change_orders: changeOrders.filter(order => order.status !== "Pending Review").length,
    purchase_orders: purchaseOrders.length,
  };

  const openItem = item => {
    if (item.kind === "purchase_order") navigate(`/PurchaseOrderDetail?id=${item.id}`);
    else navigate(`/ChangeOrderView?id=${item.id}`);
  };

  const openDecision = (item, outcome) => setDecision({ ...item, outcome });

  const confirmDecision = selected => {
    if (selected.kind === "internal_review") {
      internalReviewMutation.mutate({ id: selected.id, documentType: selected.documentType, outcome: selected.outcome });
    } else if (selected.kind === "change_order") {
      updateCOStatusMutation.mutate({ id: selected.id, status: selected.outcome });
    } else {
      updatePOStatusMutation.mutate({ id: selected.id, status: selected.outcome });
    }
  };

  const copyQuoteLink = async quote => {
    try {
      await navigator.clipboard.writeText(quotePublicUrl(window.location.origin, quote.id));
      toast.success("Client quote link copied.");
    } catch {
      toast.error("The link could not be copied. Open the quote and copy the address instead.");
    }
  };

  const refreshAll = async () => {
    await Promise.all(allQueries.map(query => query.refetch()));
  };

  const quoteColumns = [
    { key: "quote_number", label: "Quote", render: (value, quote) => <div><p className="font-bold text-slate-900">{value || "Draft"}</p><p className="max-w-52 truncate text-xs text-slate-500">{quote.title || "Untitled quote"}</p></div> },
    { key: "client_id", label: "Client", render: value => <span className="font-medium text-slate-700">{clientById[value]?.name || "—"}</span> },
    { key: "site_address", label: "Site", render: value => <span className="inline-block max-w-48 truncate text-sm text-slate-500">{value || "—"}</span> },
    { key: "total", label: "Total", render: value => <span className="font-bold text-slate-900">{formatCurrency(value)}</span> },
    { key: "approval_status", label: "Status", render: value => <StatusBadge status={value} /> },
    { key: "activity_at", label: "Last activity", render: value => <span className="whitespace-nowrap text-xs text-slate-500">{formatDate(value)}</span> },
  ];
  const changeOrderColumns = [
    { key: "change_order_number", label: "Change order", render: (value, order) => <div><p className="font-bold text-slate-900">{value || "Draft"}</p><p className="max-w-52 truncate text-xs text-slate-500">{order.title || "Untitled change order"}</p></div> },
    { key: "project_id", label: "Client", render: (value, order) => <span className="font-medium text-slate-700">{clientById[order.client_id || projectById[value]?.client_id]?.name || "—"}</span> },
    { key: "project", label: "Project", render: (_, order) => <span className="text-slate-600">{projectById[order.project_id]?.name || "—"}</span> },
    { key: "total", label: "Total", render: value => <span className="font-bold text-slate-900">{formatCurrency(value)}</span> },
    { key: "status", label: "Status", render: value => <StatusBadge status={value || "Draft"} /> },
    { key: "issue_date", label: "Date", render: (value, order) => <span className="whitespace-nowrap text-xs text-slate-500">{formatDate(value || order.created_at)}</span> },
  ];
  const purchaseOrderColumns = [
    { key: "po_number", label: "Purchase order", render: value => <span className="font-bold text-slate-900">{value || "Draft"}</span> },
    { key: "vendor_id", label: "Vendor", render: value => <span className="font-medium text-slate-700">{vendorById[value]?.name || "—"}</span> },
    { key: "project_id", label: "Project", render: value => <span className="text-slate-600">{projectById[value]?.name || "—"}</span> },
    { key: "order_date", label: "Order date", render: value => <span className="whitespace-nowrap text-xs text-slate-500">{formatDate(value)}</span> },
    { key: "expected_delivery_date", label: "Expected", render: value => <span className="whitespace-nowrap text-xs text-slate-500">{formatDate(value)}</span> },
    { key: "total", label: "Total", render: value => <span className="font-bold text-slate-900">{formatCurrency(value)}</span> },
    { key: "status", label: "Status", render: value => <StatusBadge status={value || "Draft"} /> },
  ];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader title="Approvals Hub" description="See every decision that needs attention, then review and act with confidence." />
        <Button variant="outline" className="min-h-11 shrink-0 bg-white" disabled={isRefreshing} onClick={refreshAll}>
          <RefreshCcw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} aria-hidden="true" />
          {isRefreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {loadError && (
        <Card role="alert" className="flex flex-col gap-3 border-red-200 bg-red-50 p-4 text-red-900 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /><p className="text-sm">Some approval data could not be loaded. Refresh before making a decision.</p></div>
          <Button variant="outline" className="min-h-11 border-red-200 bg-white" onClick={refreshAll}>Try again</Button>
        </Card>
      )}

      <section aria-label="Approval summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ApprovalSummaryCard icon={ClipboardCheck} label="Action required" count={actionItems.length} value={formatCurrency(actionValue)} detail="Financial decisions awaiting approval" tone="amber" onClick={() => setActiveView("action_queue")} />
        <ApprovalSummaryCard icon={RefreshCcw} label="Change order decisions" count={pendingChangeOrders.length} value={formatCurrency(pendingTotal(changeOrders, ["Pending"]))} detail="Scope changes awaiting a decision" tone="blue" onClick={() => setActiveView("change_orders")} />
        <ApprovalSummaryCard icon={Send} label="With clients" count={waitingClientQuotes.length} value={formatCurrency(waitingClientQuotes.reduce((sum, quote) => sum + Number(quote.total || 0), 0))} detail="Quotes sent or viewed" tone="emerald" onClick={() => setActiveView("quotes")} />
        <ApprovalSummaryCard icon={ShoppingCart} label="PO approval" count={pendingPurchaseOrders.length} value={formatCurrency(pendingTotal(purchaseOrders, ["Pending Approval"]))} detail="Vendor spend awaiting approval" onClick={() => setActiveView("purchase_orders")} />
      </section>

      <nav aria-label="Approval views" className="overflow-x-auto border-b border-slate-200">
        <div role="tablist" className="flex min-w-max gap-1">
          {VIEWS.map(view => {
            const active = activeView === view.id;
            return (
              <button
                key={view.id}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`approval-panel-${view.id}`}
                onClick={() => setActiveView(view.id)}
                className={`flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${active ? "border-amber-500 text-slate-950" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900"}`}
              >
                {view.label}
                <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{counts[view.id]}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {activeView === "action_queue" && (
        <section id="approval-panel-action_queue" role="tabpanel" className="space-y-4">
          <div>
            <h2 className="text-lg font-black text-slate-950">Decisions that need action</h2>
            <p className="mt-1 text-sm text-slate-600">Oldest requests appear first. Open a document to review its details before deciding.</p>
          </div>
          <FilterBar search={searchAction} onSearchChange={setSearchAction} searchLabel="Search action queue" placeholder="Search number, client, vendor or project…" />
          {isLoading ? <LoadingCard label="the action queue" /> : filteredActionItems.length === 0 ? (
            <EmptyResults icon={CheckCircle2} title={searchAction ? "No matching approvals" : "You’re all caught up"} description={searchAction ? "Try another document number, client, vendor or project." : "New financial approvals will appear here."} />
          ) : (
            <div className="grid gap-3">
              {filteredActionItems.map(item => <ApprovalQueueCard key={`${item.kind}:${item.id}`} item={item} busy={decisionBusy} onOpen={openItem} onDecision={openDecision} formatCurrency={formatCurrency} formatDate={formatDate} />)}
            </div>
          )}
        </section>
      )}

      {activeView === "quotes" && (
        <section id="approval-panel-quotes" role="tabpanel" className="space-y-4">
          <div>
            <h2 className="text-lg font-black text-slate-950">Client quote activity</h2>
            <p className="mt-1 text-sm text-slate-600">Track sent, viewed, approved, declined and expired quotes in one place.</p>
          </div>
          <FilterBar search={searchQuotes} onSearchChange={setSearchQuotes} searchLabel="Search client quotes" placeholder="Search quote, client, signer or site…" status={filterQuotes} onStatusChange={setFilterQuotes} statuses={["Sent", "Viewed", "Approved", "Declined", "Expired"]} />
          {isLoading ? <LoadingCard label="client quotes" /> : filteredQuotes.length === 0 ? (
            <EmptyResults icon={FileCheck} title="No quote activity found" description="Quotes appear here after they are sent to a client." />
          ) : (
            <DataTable
              data={filteredQuotes}
              columns={quoteColumns}
              onRowClick={quote => navigate(`/QuoteBuilder?id=${quote.id}`)}
              actions={quote => (
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" size="sm" className="min-h-9 bg-white" onClick={() => navigate(`/QuoteBuilder?id=${quote.id}`)} aria-label={`Open quote ${quote.quote_number || "draft"}`}><Eye className="mr-1.5 h-4 w-4" />Open</Button>
                  <Button variant="outline" size="sm" className="min-h-9 bg-white" onClick={() => copyQuoteLink(quote)} aria-label={`Copy client link for quote ${quote.quote_number || "draft"}`}><Copy className="mr-1.5 h-4 w-4" />Copy link</Button>
                  {["Sent", "Viewed"].includes(quote.approval_status) && <Button size="sm" className="min-h-9 bg-amber-500 font-bold text-slate-950 hover:bg-amber-600" onClick={() => setQuoteToResend(quote)} aria-label={`Resend quote ${quote.quote_number || "draft"}`}><Send className="mr-1.5 h-4 w-4" />Resend</Button>}
                </div>
              )}
            />
          )}
        </section>
      )}

      {activeView === "change_orders" && (
        <section id="approval-panel-change_orders" role="tabpanel" className="space-y-4">
          <div>
            <h2 className="text-lg font-black text-slate-950">Change orders</h2>
            <p className="mt-1 text-sm text-slate-600">Review scope changes and record pending client decisions.</p>
          </div>
          <FilterBar search={searchCO} onSearchChange={setSearchCO} searchLabel="Search change orders" placeholder="Search change order, client or project…" status={filterCO} onStatusChange={setFilterCO} statuses={["Draft", "Pending", "Sent", "Approved", "Rejected", "Declined"]} />
          {isLoading ? <LoadingCard label="change orders" /> : filteredChangeOrders.length === 0 ? (
            <EmptyResults icon={RefreshCcw} title="No change orders found" description="Scope changes and price adjustments will appear here." />
          ) : (
            <DataTable
              data={filteredChangeOrders}
              columns={changeOrderColumns}
              onRowClick={order => navigate(`/ChangeOrderView?id=${order.id}`)}
              actions={order => {
                const project = projectById[order.project_id];
                const item = {
                  id: order.id,
                  kind: "change_order",
                  number: order.change_order_number,
                  title: order.title,
                  party: clientById[order.client_id || project?.client_id]?.name,
                  project: project?.name,
                  date: order.issue_date || order.created_at,
                  amount: order.total,
                  status: order.status,
                };
                return (
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="outline" size="sm" className="min-h-9 bg-white" onClick={() => openItem(item)}><Eye className="mr-1.5 h-4 w-4" />Open</Button>
                    {order.status === "Pending" && <Button disabled={decisionBusy} variant="outline" size="sm" className="min-h-9 border-red-200 text-red-700 hover:bg-red-50" onClick={() => openDecision(item, "Rejected")}><XCircle className="mr-1.5 h-4 w-4" />Reject</Button>}
                    {order.status === "Pending" && <Button disabled={decisionBusy} size="sm" className="min-h-9 bg-amber-500 font-bold text-slate-950 hover:bg-amber-600" onClick={() => openDecision(item, "Approved")}><CheckCircle2 className="mr-1.5 h-4 w-4" />Approve</Button>}
                  </div>
                );
              }}
            />
          )}
        </section>
      )}

      {activeView === "purchase_orders" && (
        <section id="approval-panel-purchase_orders" role="tabpanel" className="space-y-4">
          <div>
            <h2 className="text-lg font-black text-slate-950">Purchase orders</h2>
            <p className="mt-1 text-sm text-slate-600">Review vendor commitments and approve the current total as the spending limit.</p>
          </div>
          <FilterBar search={searchPO} onSearchChange={setSearchPO} searchLabel="Search purchase orders" placeholder="Search purchase order, vendor or project…" status={filterPO} onStatusChange={setFilterPO} statuses={["Draft", "Pending Approval", "Approved", "Rejected", "Sent", "Fulfilled", "Cancelled"]} />
          {isLoading ? <LoadingCard label="purchase orders" /> : filteredPurchaseOrders.length === 0 ? (
            <EmptyResults icon={ShoppingCart} title="No purchase orders found" description="Vendor purchase orders will appear here when they are created." />
          ) : (
            <DataTable
              data={filteredPurchaseOrders}
              columns={purchaseOrderColumns}
              onRowClick={order => navigate(`/PurchaseOrderDetail?id=${order.id}`)}
              actions={order => {
                const item = {
                  id: order.id,
                  kind: "purchase_order",
                  number: order.po_number,
                  title: vendorById[order.vendor_id]?.name || "Vendor purchase order",
                  party: vendorById[order.vendor_id]?.name,
                  project: projectById[order.project_id]?.name,
                  date: order.order_date || order.created_at,
                  amount: order.total,
                  status: order.status,
                };
                return (
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="outline" size="sm" className="min-h-9 bg-white" onClick={() => openItem(item)}><Eye className="mr-1.5 h-4 w-4" />Open</Button>
                    {order.status === "Pending Approval" && <Button disabled={decisionBusy} variant="outline" size="sm" className="min-h-9 border-red-200 text-red-700 hover:bg-red-50" onClick={() => openDecision(item, "Rejected")}><XCircle className="mr-1.5 h-4 w-4" />Reject</Button>}
                    {order.status === "Pending Approval" && <Button disabled={decisionBusy} size="sm" className="min-h-9 bg-amber-500 font-bold text-slate-950 hover:bg-amber-600" onClick={() => openDecision(item, "Approved")}><CheckCircle2 className="mr-1.5 h-4 w-4" />Approve</Button>}
                  </div>
                );
              }}
            />
          )}
        </section>
      )}

      <ApprovalDecisionDialog decision={decision} busy={decisionBusy} onOpenChange={open => { if (!open) setDecision(null); }} onConfirm={confirmDecision} formatCurrency={formatCurrency} />

      <SendQuoteEmailDialog
        open={!!quoteToResend}
        onOpenChange={open => { if (!open) setQuoteToResend(null); }}
        quoteId={quoteToResend?.id}
        quoteName={quoteToResend?.title}
        clientName={clientById[quoteToResend?.client_id]?.name}
        clientEmail={clientById[quoteToResend?.client_id]?.email}
        onSuccess={() => {
          setQuoteToResend(null);
          queryClient.invalidateQueries({ queryKey: ["quotes_lookup", companyId] });
          queryClient.invalidateQueries({ queryKey: ["approvals", companyId] });
          queryClient.invalidateQueries({ queryKey: ["quote_views", companyId] });
        }}
      />
    </div>
  );
}
