import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { 
  FileCheck, Search, Send, Copy, RefreshCcw, ShoppingCart, 
  CheckCircle, XCircle, Eye, Menu, LogOut, Settings, User 
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";

import PageHeader from "../components/shared/PageHeader";
import StatusBadge from "../components/shared/StatusBadge";
import EmptyState from "../components/shared/EmptyState";
import DataTable from "../components/shared/DataTable";
import { format } from "date-fns";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

// Quick local currency formatter
const formatCurrencyUSD = (amount) => {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
};

export default function Approvals() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const companyId = profile?.company_id;
  const currentUserName = profile?.full_name || "Admin";

  // --- VIEW STATE ---
  const [activeView, setActiveView] = useState("quotes");
  const [searchReviews, setSearchReviews] = useState("");

  // --- FILTER & SEARCH STATE ---
  const [searchQuotes, setSearchQuotes] = useState("");
  const [filterQuotes, setFilterQuotes] = useState("all");

  const [searchCO, setSearchCO] = useState("");
  const [filterCO, setFilterCO] = useState("all");

  const [searchPO, setSearchPO] = useState("");
  const [filterPO, setFilterPO] = useState("all");

  // --- SUPABASE QUERIES ---
  
  // 1. Quotes
  const { data: quoteApprovals = [] } = useQuery({ 
    queryKey: ["approvals", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("quote_approvals").select("*").eq("company_id", companyId).order("created_at", { ascending: false });
      if (error) throw error; return data || [];
    } 
  });
  
  const { data: quotes = [], isPending: quotesLoading, error: quotesError, refetch: refetchQuotes } = useQuery({
    queryKey: ["quotes_lookup", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("quotes").select("id, title, quote_number, site_address, total, issue_date, client_id, status, internal_review_status, next_follow_up_date").eq("company_id", companyId);
      if (error) throw error; return data || [];
    } 
  });
  
  const { data: clients = [] } = useQuery({ 
    queryKey: ["clients_lookup", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, name, email").eq("company_id", companyId);
      if (error) throw error; return data || [];
    } 
  });

  // 2. Projects
  const { data: projects = [] } = useQuery({
    queryKey: ["projects_lookup", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("id, name, client_id, site_address").eq("company_id", companyId);
      if (error) throw error; return data || [];
    }
  });

  // 3. Change Orders
  const { data: changeOrders = [], isPending: changeOrdersLoading, error: changeOrdersError, refetch: refetchChangeOrders } = useQuery({
    queryKey: ["change_orders", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("change_orders").select("*").eq("company_id", companyId).order("created_at", { ascending: false });
      if (error) throw error; return data || [];
    }
  });

  // 4. Purchase Orders
  const { data: purchaseOrders = [] } = useQuery({
    queryKey: ["purchase_orders", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("purchase_orders").select("*").eq("company_id", companyId).order("created_at", { ascending: false });
      if (error) throw error; return data || [];
    }
  });

  // --- MAPPERS ---
  const quoteMap = Object.fromEntries(quotes.map(q => [q.id, q]));
  const clientMap = Object.fromEntries(clients.map(c => [c.id, c.name]));
  const projectMap = Object.fromEntries(projects.map(p => [p.id, p]));

  // --- SUPABASE MUTATIONS ---
  const internalReviewMutation = useMutation({
    mutationFn: async ({ id, documentType, outcome }) => {
      if (!companyId || !profile?.id || !["quote", "change_order"].includes(documentType) || !["Approved", "Changes Required"].includes(outcome)) {
        throw new Error("The review cannot be saved.");
      }
      const table = documentType === "quote" ? "quotes" : "change_orders";
      const { data, error } = await supabase.from(table).update({
        status: "Draft", internal_review_status: outcome,
        internal_reviewed_at: new Date().toISOString(), internal_reviewed_by: profile.id,
      }).eq("id", id).eq("company_id", companyId).eq("status", "Pending Review").select("id").single();
      if (error || !data?.id) throw error || new Error("This document is no longer awaiting review.");
    },
    onSuccess: (_, { id, documentType, outcome }) => {
      queryClient.invalidateQueries({ queryKey: ["quotes_lookup", companyId] });
      for (const key of ["quotes", "change_orders", "change-orders"]) queryClient.invalidateQueries({ queryKey: [key] });
      queryClient.invalidateQueries({ queryKey: [documentType === "quote" ? "quote" : "change-order", id] });
      toast.success(outcome === "Approved" ? "Internal review approved. The draft is ready to send." : "Returned to draft for changes.");
    },
    onError: () => toast.error("Could not save the review. Refresh the document status and try again."),
  });

  const resendQuoteMutation = useMutation({
    mutationFn: async (approvalId) => {
      const approval = quoteApprovals.find(a => a.id === approvalId);
      const quote = quoteMap[approval?.quote_id];
      const client = clients.find(c => c.id === quote?.client_id);
      if (!quote || !client?.email) throw new Error("Add the client's email before sending this quote.");
      const url = new URL(`/PublicQuoteView?id=${quote.id}`, window.location.origin).toString();
      const {data:result,error:sendError} = await supabase.functions.invoke("send-email", {body:{company_id:companyId,client_id:client.id,to_email:client.email,subject:"Your quote is ready to review",html_body:`<p>Your quote is ready to review.</p><p><a href="${url}">View and approve your quote</a></p>`}});
      if (sendError || result?.error) throw new Error(result?.error || "Email delivery failed.");
      const { error } = await supabase.from("quote_approvals").update({ sent_at: new Date().toISOString(), approval_status: "Sent" }).eq("id", approvalId).eq("company_id", companyId);
      if (error) throw error;
    },
    onSuccess: () => { 
      queryClient.invalidateQueries({ queryKey: ["approvals", companyId] }); 
      toast.success("Approval link resent successfully!"); 
    },
    onError: (err) => toast.error(`Resend failed: ${err.message}`)
  });

  const updateCOStatusMutation = useMutation({
    mutationFn: async ({ id, status }) => {
      const { data, error } = await supabase.from("change_orders").update({ status, approved_by: currentUserName, approved_at: new Date().toISOString() }).eq("id", id).eq("company_id", companyId).eq("status", "Pending").select("id").single();
      if (error || !data?.id) throw error || new Error("This change order is no longer pending.");
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["change_orders", companyId] });
      toast.success(`Change Order ${variables.status.toLowerCase()} successfully!`);
    },
    onError: () => toast.error("Could not save the change order decision. Refresh and try again."),
  });

  const updatePOStatusMutation = useMutation({
    mutationFn: async ({ id, status }) => {
      const { error } = await supabase.from("purchase_orders").update({ status, approved_by: currentUserName, approved_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["purchase_orders", companyId] });
      toast.success(`Purchase Order ${variables.status.toLowerCase()} successfully!`);
    }
  });

  // --- HELPERS & FILTERS ---
  const copyLink = (token) => {
    const link = `${window.location.origin}/QuoteApprovalPublic?token=${token}`;
    navigator.clipboard.writeText(link);
    toast.success("Link copied to clipboard");
  };

  const filteredQuotes = quoteApprovals.filter(a => {
    const quote = quoteMap[a.quote_id];
    const matchSearch = !searchQuotes || quote?.title?.toLowerCase().includes(searchQuotes.toLowerCase()) || a.signer_name?.toLowerCase().includes(searchQuotes.toLowerCase());
    const matchStatus = filterQuotes === "all" || a.approval_status === filterQuotes;
    return matchSearch && matchStatus;
  });

  const filteredCOs = changeOrders.filter(co => {
    const matchSearch = !searchCO || co.title?.toLowerCase().includes(searchCO.toLowerCase()) || co.co_number?.toLowerCase().includes(searchCO.toLowerCase()) || co.change_order_number?.toLowerCase().includes(searchCO.toLowerCase());
    const matchStatus = filterCO === "all" || co.status === filterCO;
    return matchSearch && matchStatus;
  });

  const filteredPOs = purchaseOrders.filter(po => {
    const matchSearch = !searchPO || po.vendor_name?.toLowerCase().includes(searchPO.toLowerCase()) || po.po_number?.toLowerCase().includes(searchPO.toLowerCase());
    const matchStatus = filterPO === "all" || po.status === filterPO;
    return matchSearch && matchStatus;
  });

  const internalReviews = [
    ...quotes.filter(quote => quote.status === "Pending Review").map(quote => ({ ...quote, documentType: "quote", documentNumber: quote.quote_number, clientName: clientMap[quote.client_id] })),
    ...changeOrders.filter(co => co.status === "Pending Review").map(co => ({ ...co, documentType: "change_order", documentNumber: co.change_order_number || co.co_number, clientName: clientMap[projectMap[co.project_id]?.client_id] })),
  ].filter(document => !searchReviews || [document.title, document.documentNumber, document.clientName].some(value => value?.toLowerCase().includes(searchReviews.trim().toLowerCase())));

  return (
    <div className="p-4 md:p-6 w-full max-w-7xl mx-auto space-y-6">
      
      {/* --- HEADER WITH USER DROPDOWN MENU --- */}
      <div className="flex justify-between items-start">
        <PageHeader title="Approvals Hub" description="Review operational client quotes, scope changes, and vendor purchase orders." />
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="h-10 w-10 shrink-0 rounded-full border-slate-200 bg-white">
              <Menu className="h-5 w-5 text-slate-600" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/profile")}>
              <User className="mr-2 h-4 w-4" />
              <span>Profile</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/settings")}>
              <Settings className="mr-2 h-4 w-4" />
              <span>Settings</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOut?.()} className="text-red-600 focus:text-red-600">
              <LogOut className="mr-2 h-4 w-4" />
              <span>Log out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* --- VIEW SELECTOR DROPDOWN (Replaces Tabs) --- */}
      <div className="w-full sm:w-[250px]">
        <Select value={activeView} onValueChange={setActiveView}>
          <SelectTrigger className="w-full bg-slate-50 border-slate-200 shadow-sm font-semibold text-slate-800 h-10">
            <SelectValue placeholder="Select view" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="quotes">Quote Approvals</SelectItem>
            <SelectItem value="internal_reviews">Internal Review</SelectItem>
            <SelectItem value="change_orders">Change Orders</SelectItem>
            <SelectItem value="purchase_orders">Purchase Orders</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {activeView === "internal_reviews" && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Review drafts before sending them to clients. An internal approval makes a draft ready to send; customer acceptance remains a separate action.</p>
          <div className="relative w-full sm:max-w-sm">
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <Input aria-label="Search internal reviews" placeholder="Search document, number or client..." value={searchReviews} onChange={e => setSearchReviews(e.target.value)} className="h-11 bg-white pl-10" />
          </div>
          {quotesLoading || changeOrdersLoading ? (
            <Card className="border-slate-200 bg-white p-6"><p role="status" className="text-sm text-slate-600">Loading internal reviews...</p></Card>
          ) : quotesError || changeOrdersError ? (
            <Card className="space-y-3 border-slate-200 bg-white p-6">
              <p role="alert" className="text-sm text-red-700">Internal reviews could not be loaded. Try again to check which drafts need a decision.</p>
              <Button variant="outline" className="h-11" onClick={() => { refetchQuotes(); refetchChangeOrders(); }}>Try again</Button>
            </Card>
          ) : internalReviews.length === 0 ? (
            <Card className="border-dashed border-slate-200 bg-white p-6"><EmptyState icon={FileCheck} title="No internal reviews awaiting a decision" description="Use Request Internal Review in a quote or change order builder to submit a draft." /></Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {internalReviews.map(document => (
                <Card key={`${document.documentType}:${document.id}`} className="space-y-4 border-slate-200 bg-white p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase text-slate-500">{document.documentType === "quote" ? "Quote" : "Change Order"} {document.documentNumber || "Draft"}</p>
                      <h3 className="break-words font-bold text-slate-900">{document.title || "Untitled document"}</h3>
                      {document.clientName && <p className="mt-1 text-sm text-slate-600">{document.clientName}</p>}
                    </div>
                    <StatusBadge status="Pending Review" />
                  </div>
                  <p className="font-semibold text-slate-800">{formatCurrencyUSD(document.total)}</p>
                  <Button variant="outline" onClick={() => navigate(`/${document.documentType === "quote" ? "QuoteBuilder" : "ChangeOrderBuilder"}?id=${document.id}`)} className="h-11 w-full"><Eye className="mr-2 h-4 w-4" /> Open document</Button>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button disabled={internalReviewMutation.isPending} onClick={() => internalReviewMutation.mutate({ id: document.id, documentType: document.documentType, outcome: "Approved" })} className="h-11 flex-1 bg-amber-500 font-semibold text-slate-900 hover:bg-amber-600">Approve for sending</Button>
                    <Button disabled={internalReviewMutation.isPending} onClick={() => internalReviewMutation.mutate({ id: document.id, documentType: document.documentType, outcome: "Changes Required" })} variant="outline" className="h-11 flex-1">Return for changes</Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* --- CONTENT: QUOTE SIGN-OFFS --- */}
      {activeView === "quotes" && (
        <div className="space-y-4 w-full animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex flex-col sm:flex-row gap-3 w-full">
            <div className="relative flex-1 w-full sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input placeholder="Search quotes or signers..." value={searchQuotes} onChange={e => setSearchQuotes(e.target.value)} className="pl-10 w-full bg-white shadow-sm" />
            </div>
            <Select value={filterQuotes} onValueChange={setFilterQuotes}>
              <SelectTrigger className="w-full sm:w-[180px] bg-white shadow-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {["Pending", "Sent", "Viewed", "Signed", "Declined", "Expired"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {filteredQuotes.length === 0 ? (
            <Card className="p-8 border-slate-200 bg-white/50 shadow-sm">
              <EmptyState icon={FileCheck} title="No quote records found" description="Estimates sent for client approval will appear here." />
            </Card>
          ) : (
            <div className="w-full overflow-x-auto rounded-lg border border-slate-200 shadow-sm bg-white">
              <DataTable
                data={filteredQuotes}
                columns={[
                  { key: "quote_number", label: "Quote #", render: (_, a) => <span className="font-bold text-slate-900 whitespace-nowrap">{quoteMap[a.quote_id]?.quote_number || "—"}</span> },
                  { key: "title", label: "Title", render: (_, a) => <span className="font-semibold text-slate-800 whitespace-nowrap">{quoteMap[a.quote_id]?.title || "—"}</span> },
                  { key: "client_id", label: "Client", render: (_, a) => <span className="font-medium text-slate-600 whitespace-nowrap">{clientMap[quoteMap[a.quote_id]?.client_id || a.client_id] || "—"}</span> },
                  { key: "site_address", label: "Site Address", render: (_, a) => <span className="text-slate-500 text-sm truncate max-w-[150px] sm:max-w-[200px] inline-block">{quoteMap[a.quote_id]?.site_address || "—"}</span> },
                  { key: "total", label: "Total", render: (_, a) => <span className="font-black text-slate-800">{formatCurrencyUSD(quoteMap[a.quote_id]?.total)}</span> },
                  { key: "approval_status", label: "Status", render: (status) => <StatusBadge status={status} /> },
                  { key: "issue_date", label: "Date", render: (_, a) => <span className="text-slate-500 text-xs font-medium whitespace-nowrap">{quoteMap[a.quote_id]?.issue_date ? format(new Date(quoteMap[a.quote_id]?.issue_date), "MMM d, yyyy") : "—"}</span> }
                ]}
                actions={(a) => (
                  <div className="flex justify-end gap-1.5 min-w-[80px]">
                    <Button variant="outline" size="icon" className="h-8 w-8 bg-white border-slate-200" onClick={() => copyLink(a.approval_token)} title="Copy URL">
                      <Copy className="h-4 w-4 text-slate-600" />
                    </Button>
                    {!["Signed", "Declined"].includes(a.approval_status) && (
                      <Button variant="outline" size="icon" className="h-8 w-8 bg-white border-blue-100 hover:bg-blue-50" onClick={() => resendQuoteMutation.mutate(a.id)} title="Resend Link">
                        <Send className="h-4 w-4 text-blue-500" />
                      </Button>
                    )}
                  </div>
                )}
              />
            </div>
          )}
        </div>
      )}

      {/* --- CONTENT: CHANGE ORDERS --- */}
      {activeView === "change_orders" && (
        <div className="space-y-4 w-full animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex flex-col sm:flex-row gap-3 w-full">
            <div className="relative flex-1 w-full sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input placeholder="Search Change Orders..." value={searchCO} onChange={e => setSearchCO(e.target.value)} className="pl-10 w-full bg-white shadow-sm" />
            </div>
            <Select value={filterCO} onValueChange={setFilterCO}>
              <SelectTrigger className="w-full sm:w-[180px] bg-white shadow-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {["Draft", "Pending Review", "Pending", "Approved", "Rejected", "Declined"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {filteredCOs.length === 0 ? (
            <Card className="p-8 border-slate-200 bg-white shadow-sm border-dashed">
              <EmptyState icon={RefreshCcw} title="No Change Orders" description="Client-requested scope changes and price adjustments will appear here." />
            </Card>
          ) : (
            <div className="w-full overflow-x-auto rounded-lg border border-slate-200 shadow-sm bg-white">
              <DataTable
                data={filteredCOs}
                columns={[
                  { key: "co_number", label: "CO #", render: (val, co) => <span className="font-bold text-slate-900 whitespace-nowrap">{co.co_number || co.change_order_number || "—"}</span> },
                  { key: "title", label: "Title", render: (val, co) => <span className="font-medium text-slate-700 whitespace-nowrap">{co.title || "—"}</span> },
                  { key: "client", label: "Client", render: (_, co) => <span className="text-sm text-slate-600 whitespace-nowrap">{clientMap[projectMap[co.project_id]?.client_id] || "—"}</span> },
                  { key: "site_address", label: "Site Address", render: (_, co) => <span className="text-sm text-slate-500 truncate max-w-[150px] sm:max-w-[200px] inline-block">{projectMap[co.project_id]?.site_address || "—"}</span> },
                  { key: "total_amount", label: "Total", render: (val, co) => <span className="font-black text-slate-800">{formatCurrencyUSD(co.total_amount || co.total)}</span> },
                  { key: "status", label: "Status", render: (status) => <StatusBadge status={status || "Draft"} /> },
                  { key: "created_at", label: "Date", render: (date) => <span className="text-slate-500 text-xs font-medium whitespace-nowrap">{date ? format(new Date(date), "MMM d, yyyy") : "—"}</span> }
                ]}
                actions={(co) => (
                  <div className="flex justify-end gap-1.5 min-w-[100px]">
                    <Button variant="outline" size="icon" className="h-8 w-8 bg-white" onClick={() => navigate(`/ChangeOrderView?id=${co.id}`)} title="View Details">
                      <Eye className="h-4 w-4 text-slate-500" />
                    </Button>
                    {co.status === "Pending" && (
                      <>
                        <Button disabled={updateCOStatusMutation.isPending} variant="outline" size="icon" className="h-8 w-8 bg-red-50 border-red-200 hover:bg-red-100" onClick={() => updateCOStatusMutation.mutate({ id: co.id, status: "Rejected" })} title="Reject">
                          <XCircle className="h-4 w-4 text-red-600" />
                        </Button>
                        <Button disabled={updateCOStatusMutation.isPending} variant="outline" size="icon" className="h-8 w-8 bg-emerald-50 border-emerald-200 hover:bg-emerald-100" onClick={() => updateCOStatusMutation.mutate({ id: co.id, status: "Approved" })} title="Approve">
                          <CheckCircle className="h-4 w-4 text-emerald-600" />
                        </Button>
                      </>
                    )}
                    {co.status === "Pending Review" && (
                      <div className="flex flex-col gap-2">
                        <Button disabled={internalReviewMutation.isPending} onClick={() => internalReviewMutation.mutate({ id: co.id, documentType: "change_order", outcome: "Approved" })} className="h-11 bg-amber-500 text-slate-900 hover:bg-amber-600">Approve for sending</Button>
                        <Button disabled={internalReviewMutation.isPending} onClick={() => internalReviewMutation.mutate({ id: co.id, documentType: "change_order", outcome: "Changes Required" })} variant="outline" className="h-11">Return for changes</Button>
                      </div>
                    )}
                  </div>
                )}
              />
            </div>
          )}
        </div>
      )}

      {/* --- CONTENT: PURCHASE ORDERS --- */}
      {activeView === "purchase_orders" && (
        <div className="space-y-4 w-full animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex flex-col sm:flex-row gap-3 w-full">
            <div className="relative flex-1 w-full sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input placeholder="Search POs or Vendors..." value={searchPO} onChange={e => setSearchPO(e.target.value)} className="pl-10 w-full bg-white shadow-sm" />
            </div>
            <Select value={filterPO} onValueChange={setFilterPO}>
              <SelectTrigger className="w-full sm:w-[180px] bg-white shadow-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {["Draft", "Pending Approval", "Approved", "Rejected", "Sent", "Fulfilled"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {filteredPOs.length === 0 ? (
            <Card className="p-8 border-slate-200 bg-white shadow-sm border-dashed">
              <EmptyState icon={ShoppingCart} title="No Purchase Orders" description="Internal material requisitions and vendor purchase orders will display here." />
            </Card>
          ) : (
            <div className="w-full overflow-x-auto rounded-lg border border-slate-200 shadow-sm bg-white">
              <DataTable
                data={filteredPOs}
                columns={[
                  { key: "po_number", label: "PO #", render: (val) => <span className="font-bold text-slate-900 whitespace-nowrap">{val || "—"}</span> },
                  { key: "vendor_name", label: "Vendor", render: (val) => <span className="font-medium text-slate-700 whitespace-nowrap">{val || "—"}</span> },
                  { key: "project_id", label: "Project", render: (pid) => <span className="text-sm text-slate-500 whitespace-nowrap">{projectMap[pid]?.name || "—"}</span> },
                  { key: "order_date", label: "Order Date", render: (date) => <span className="text-slate-500 text-xs font-medium whitespace-nowrap">{date ? format(new Date(date), "MMM d, yyyy") : "—"}</span> },
                  { key: "expected_delivery", label: "Expected Delivery", render: (date) => <span className="text-slate-500 text-xs font-medium whitespace-nowrap">{date ? format(new Date(date), "MMM d, yyyy") : "—"}</span> },
                  { key: "total_amount", label: "Total", render: (val) => <span className="font-black text-slate-800">{formatCurrencyUSD(val)}</span> },
                  { key: "status", label: "Status", render: (status) => <StatusBadge status={status || "Draft"} /> },
                ]}
                actions={(po) => (
                  <div className="flex justify-end gap-1.5 min-w-[100px]">
                    <Button variant="outline" size="icon" className="h-8 w-8 bg-white" onClick={() => navigate(`/PurchaseOrderView?id=${po.id}`)} title="View Details">
                      <Eye className="h-4 w-4 text-slate-500" />
                    </Button>
                    {po.status === "Pending Approval" && (
                      <>
                        <Button variant="outline" size="icon" className="h-8 w-8 bg-red-50 border-red-200 hover:bg-red-100" onClick={() => updatePOStatusMutation.mutate({ id: po.id, status: "Rejected" })} title="Reject">
                          <XCircle className="h-4 w-4 text-red-600" />
                        </Button>
                        <Button variant="outline" size="icon" className="h-8 w-8 bg-emerald-50 border-emerald-200 hover:bg-emerald-100" onClick={() => updatePOStatusMutation.mutate({ id: po.id, status: "Approved" })} title="Approve">
                          <CheckCircle className="h-4 w-4 text-emerald-600" />
                        </Button>
                      </>
                    )}
                  </div>
                )}
              />
            </div>
          )}
        </div>
      )}

    </div>
  );
}
