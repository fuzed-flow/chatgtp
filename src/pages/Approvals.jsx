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
  const [activeView, setActiveView] = useState("quotes"); // 'quotes', 'change_orders', 'purchase_orders'

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
  
  const { data: quotes = [] } = useQuery({ 
    queryKey: ["quotes_lookup", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("quotes").select("id, title, quote_number, site_address, total, issue_date, client_id").eq("company_id", companyId);
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
  const { data: changeOrders = [] } = useQuery({
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
      const { error } = await supabase.from("change_orders").update({ status, approved_by: currentUserName, approved_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["change_orders", companyId] });
      toast.success(`Change Order ${variables.status.toLowerCase()} successfully!`);
    }
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
    const matchSearch = !searchCO || co.title?.toLowerCase().includes(searchCO.toLowerCase()) || co.co_number?.toLowerCase().includes(searchCO.toLowerCase());
    const matchStatus = filterCO === "all" || co.status === filterCO;
    return matchSearch && matchStatus;
  });

  const filteredPOs = purchaseOrders.filter(po => {
    const matchSearch = !searchPO || po.vendor_name?.toLowerCase().includes(searchPO.toLowerCase()) || po.po_number?.toLowerCase().includes(searchPO.toLowerCase());
    const matchStatus = filterPO === "all" || po.status === filterPO;
    return matchSearch && matchStatus;
  });

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
            <SelectItem value="change_orders">Change Orders</SelectItem>
            <SelectItem value="purchase_orders">Purchase Orders</SelectItem>
          </SelectContent>
        </Select>
      </div>

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
                {["Draft", "Pending", "Approved", "Rejected"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
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
                        <Button variant="outline" size="icon" className="h-8 w-8 bg-red-50 border-red-200 hover:bg-red-100" onClick={() => updateCOStatusMutation.mutate({ id: co.id, status: "Rejected" })} title="Reject">
                          <XCircle className="h-4 w-4 text-red-600" />
                        </Button>
                        <Button variant="outline" size="icon" className="h-8 w-8 bg-emerald-50 border-emerald-200 hover:bg-emerald-100" onClick={() => updateCOStatusMutation.mutate({ id: co.id, status: "Approved" })} title="Approve">
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