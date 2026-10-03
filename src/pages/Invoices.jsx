import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Plus, Receipt, Trash2, Eye, DollarSign, CheckCircle2, AlertCircle, Search, Edit2 } from "lucide-react";
import { createPageUrl } from "../utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PageHeader from "../components/shared/PageHeader";
import DataTable from "../components/shared/DataTable";
import FilterBar from "../components/shared/FilterBar";
import ActionMenu from "../components/shared/ActionMenu";
import StatusBadge from "../components/shared/StatusBadge";
import { format } from "date-fns";
import { toast } from "sonner";
import RecordPaymentDialog from "../components/invoices/RecordPaymentDialog";
import { Mail } from "lucide-react"; // <-- Add Mail here if missing
import SendReceiptDialog from "../components/invoices/SendReceiptDialog";

const DATE_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Last week", value: "last_week" },
  { label: "Last 30 days", value: "last_30_days" },
  { label: "Last month", value: "last_month" },
  { label: "This month", value: "this_month" },
  { label: "This year", value: "this_year" },
  { label: "Last 12 months", value: "last_12_months" }
];

export default function Invoices() {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState("invoices");
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  React.useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  
  const [filters, setFilters] = useState({});
  const [paymentSearch, setPaymentSearch] = useState("");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState("all");
  const [paymentDateFilter, setPaymentDateFilter] = useState("all");

  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [editingPaymentId, setEditingPaymentId] = useState(null);
  const [receiptDialogOpen, setReceiptDialogOpen] = useState(false);

  // --- QUERIES ---
  const { data: invoices = [] } = useQuery({ 
    queryKey: ["invoices", companyId], enabled: !!companyId,
    queryFn: async () => { const { data } = await supabase.from("invoices").select("*").eq("company_id", companyId).order("created_at", { ascending: false }); return data || []; }
  });

  const { data: clients = [] } = useQuery({ 
    queryKey: ["clients", companyId], enabled: !!companyId,
    queryFn: async () => { 
      // ⚡ CHANGED: Added 'email' to the select statement so the dialog can auto-fill it!
      const { data } = await supabase.from("clients").select("id, name, email").eq("company_id", companyId); 
      return data || []; 
    }
  });

  const { data: payments = [] } = useQuery({ 
    queryKey: ["payments", companyId], enabled: !!companyId,
    queryFn: async () => { const { data } = await supabase.from("payments").select("*").eq("company_id", companyId).order("payment_date", { ascending: false }); return data || []; }
  });

  // --- MUTATIONS ---
  const deleteInvoiceMutation = useMutation({
    mutationFn: async (id) => await supabase.from("invoices").delete().eq("id", id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["invoices"] }); toast.success("Invoice deleted"); }
  });

  const deletePaymentMutation = useMutation({
    mutationFn: async (targetId) => {
      if (!targetId) throw new Error("No payment ID provided.");
      const { data: payment, error: fetchErr } = await supabase.from("payments").select("*").eq("id", targetId).single();
      if (fetchErr || !payment) throw new Error("Could not find the payment record.");

      const invIdToFix = payment.invoice_id;
      const { error: pError } = await supabase.from("payments").delete().eq("id", targetId);
      if (pError) throw new Error(`Payment Delete Error: ${pError.message}`);
      
      const { data: inv } = await supabase.from("invoices").select("total").eq("id", invIdToFix).single();
      if (!inv) return true;
      const { data: allPymts = [] } = await supabase.from("payments").select("amount, schedule_item_id").eq("invoice_id", invIdToFix);
      const totalCollected = allPymts.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const newBal = Math.max(0, Number(inv.total) - totalCollected);
      const invStatus = newBal <= 0 ? "Paid" : (totalCollected > 0 ? "Partial" : "Sent");
      await supabase.from("invoices").update({ amount_paid: totalCollected, balance_due: newBal, status: invStatus }).eq("id", invIdToFix);

      const { data: schedules = [] } = await supabase.from("invoice_payment_schedules").select("id, amount").eq("invoice_id", invIdToFix);
      for (const sched of schedules) {
        const schedTotal = allPymts.filter(p => p.schedule_item_id === sched.id).reduce((sum, p) => sum + Number(p.amount || 0), 0);
        const schedStatus = schedTotal >= sched.amount ? "Paid" : (schedTotal > 0 ? "Partial" : "Pending");
        await supabase.from("invoice_payment_schedules").update({ amount_paid: schedTotal, status: schedStatus }).eq("id", sched.id);
      }
      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Payment deleted successfully!");
    }
  });

  // --- UNIVERSAL DATE FILTER ENGINE ---
  const checkDateRange = (dateString, range) => {
    if (!dateString || range === "all") return true;
    const targetDate = new Date(dateString);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const targetDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
    
    switch (range) {
      case "last_week": return targetDay >= new Date(today.setDate(today.getDate() - 7)) && targetDay <= new Date();
      case "last_30_days": return targetDay >= new Date(today.setDate(today.getDate() - 30)) && targetDay <= new Date();
      case "last_month":
        const lastMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
        const lastMonthYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
        return targetDate.getMonth() === lastMonth && targetDate.getFullYear() === lastMonthYear;
      case "this_month": return targetDate.getMonth() === now.getMonth() && targetDate.getFullYear() === now.getFullYear();
      case "this_year": return targetDate.getFullYear() === now.getFullYear();
      case "last_12_months": return targetDay >= new Date(today.setFullYear(today.getFullYear() - 1)) && targetDay <= new Date();
      default: return true;
    }
  };

  // --- DATA PROCESSING ---
  const clientMap = Object.fromEntries(clients.map(c => [c.id, c.name]));
  
  const enrichedInvoices = invoices.map(inv => ({
    ...inv,
    client_name: clientMap[inv.client_id] || "Unknown Client"
  }));

  const filteredInvoices = enrichedInvoices.filter(inv => {
    const matchStatus = !filters.status || filters.status === "All" || inv.status === filters.status;
    const dateToUse = inv.issue_date ? inv.issue_date + "T00:00:00" : inv.created_at;
    const matchDate = checkDateRange(dateToUse, filters.date_range || "all");
    return matchStatus && matchDate;
  });

  const totalOutstanding = invoices.filter(i => ["Sent", "Partial", "Overdue"].includes(i.status)).reduce((sum, i) => sum + (i.balance_due || 0), 0);
  const totalCollected = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

  const enrichedPayments = payments.map(p => {
    const inv = invoices.find(i => i.id === p.invoice_id);
    return {
      ...p,
      invoice_number: inv?.invoice_number || "Unknown",
      client_name: clientMap[inv?.client_id] || "Unknown Client"
    };
  });

  const filteredPayments = enrichedPayments.filter(p => {
    const matchSearch = !paymentSearch || 
      p.invoice_number.toLowerCase().includes(paymentSearch.toLowerCase()) || 
      p.client_name.toLowerCase().includes(paymentSearch.toLowerCase());
    
    const matchMethod = paymentMethodFilter === "all" || p.payment_method === paymentMethodFilter;
    const dateToUse = p.payment_date ? p.payment_date + "T00:00:00" : p.created_at;
    const matchDate = checkDateRange(dateToUse, paymentDateFilter);

    return matchSearch && matchMethod && matchDate;
  });

  const handleEditPayment = (payment) => {
    const parentInvoice = invoices.find(i => i.id === payment.invoice_id);
    setSelectedInvoice(parentInvoice);
    setEditingPaymentId(payment.id);
    setPaymentDialogOpen(true);
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Invoices & Payments"
        description="Manage your Master Project Invoices and track Progress Billing payments."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button className="bg-slate-900 hover:bg-slate-800" onClick={() => window.location.href = createPageUrl("InvoiceBuilder")}>
              {/* ⚡ HIDDEN TEXT ON MOBILE */}
              <Plus className="h-4 w-4 sm:mr-2" /> 
              <span className="hidden sm:inline">Create New Invoice</span>
            </Button>
          </div>
        }
      />

      {/* ⚡ HIDDEN ON MOBILE: Added "hidden sm:grid" */}
      <div className="hidden sm:grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-5 border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Outstanding Balance</p>
            <p className="text-2xl font-black text-red-600 mt-1">${totalOutstanding.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
          </div>
          <AlertCircle className="h-10 w-10 text-red-100" />
        </Card>
        <Card className="p-5 border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Total Paid</p>
            <p className="text-2xl font-black text-emerald-600 mt-1">${totalCollected.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
          </div>
          <CheckCircle2 className="h-10 w-10 text-emerald-100" />
        </Card>
        <Card className="p-5 border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Active Invoices</p>
            <p className="text-2xl font-black text-slate-900 mt-1">{invoices.length}</p>
          </div>
          <Receipt className="h-10 w-10 text-slate-100" />
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="payments">Payments History</TabsTrigger>
        </TabsList>
        
        <TabsContent value="invoices">
          <FilterBar
            filters={[
              { 
                key: "status", 
                label: "Status", 
                type: "select", 
                options: [
                  { label: "All Statuses", value: "All" }, 
                  ...["Draft", "Sent", "Partial", "Paid", "Overdue"].map(s => ({ label: s, value: s }))
                ] 
              },
              { 
                key: "date_range", 
                label: "Date range", 
                type: "select", 
                options: DATE_OPTIONS
              }
            ]}
            onFiltersChange={setFilters}
          />
          <DataTable
            data={filteredInvoices}
            searchableFields={["invoice_number", "client_name"]}
            emptyMessage="No invoices yet. Click 'Create New Invoice' to get started."
            columns={[
              { key: "invoice_number", label: "Invoice #", render: (num, inv) => <button onClick={() => window.location.href = createPageUrl(`InvoiceBuilder?id=${inv.id}`)} className="font-bold text-slate-800 hover:text-amber-600 underline">{num || "—"}</button> },
              { key: "client_name", label: "Client", render: (name) => <span className="font-medium">{name || "—"}</span> },
              { key: "total", label: "Contract Total", render: (total) => `$${(total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}` },
              { key: "balance_due", label: "Balance Due", render: (bal) => <span className="font-bold text-red-600">${(bal || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span> },
              { key: "status", label: "Status", render: (s) => <StatusBadge status={s || "Draft"} /> },
              { key: "issue_date", label: "Date Issued", render: (date) => <span className="text-sm text-slate-500">{date ? format(new Date(date + "T00:00:00"), "MMM d, yyyy") : "—"}</span> },
            ]}
            actions={(invoice) => (
              <ActionMenu actions={[
                { label: "Manage Progress Billing", icon: Eye, onClick: () => window.location.href = createPageUrl(`InvoiceBuilder?id=${invoice.id}`) },
                { label: "Record Payment", icon: DollarSign, onClick: () => { setSelectedInvoice(invoice); setEditingPaymentId(null); setPaymentDialogOpen(true); } },
                { label: "Delete Invoice", icon: Trash2, destructive: true, onClick: () => { if(window.confirm("Delete this invoice?")) deleteInvoiceMutation.mutate(invoice.id); } },
              ]} />
            )}
          />
        </TabsContent>
        
       <TabsContent value="payments">
          <div className="flex flex-col sm:flex-row gap-3 mb-4 p-4 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input 
                placeholder="Search by client name or invoice #..." 
                value={paymentSearch} 
                onChange={e => setPaymentSearch(e.target.value)} 
                className="pl-9 bg-white"
              />
            </div>
            
            <div className="flex flex-wrap gap-3">
              <Select value={paymentDateFilter} onValueChange={setPaymentDateFilter}>
                <SelectTrigger className="w-[160px] bg-white"><SelectValue placeholder="Date range" /></SelectTrigger>
                <SelectContent>
                  {DATE_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={paymentMethodFilter} onValueChange={setPaymentMethodFilter}>
                <SelectTrigger className="w-[160px] bg-white"><SelectValue placeholder="Filter Method" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Methods</SelectItem>
                  <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                  <SelectItem value="Credit Card">Credit Card</SelectItem>
                  <SelectItem value="Check">Check</SelectItem>
                  <SelectItem value="Cash">Cash</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>

              {/* ⚡ NEW BUTTON PLACED HERE */}
              <Button 
                onClick={() => setReceiptDialogOpen(true)} 
                className="bg-emerald-100 hover:bg-emerald-200 text-emerald-800 border border-emerald-300 font-bold"
              >
                <Mail className="h-4 w-4 mr-2 text-emerald-600" /> Send Receipts
              </Button>
            </div>
          </div>

          <DataTable
            data={filteredPayments}
            emptyMessage="No payments match your search criteria."
            columns={[
              { key: "invoice_number", label: "Invoice #", render: (num) => <span className="font-semibold text-slate-700">{num}</span> },
              { key: "client_name", label: "Client", render: (name) => <span className="font-medium">{name}</span> },
              { key: "amount", label: "Amount", render: (amount) => <span className="font-bold text-emerald-600">${(amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span> },
              { key: "payment_method", label: "Method", render: (m) => m },
              { key: "notes", label: "Notes", render: (n) => <span className="text-sm text-slate-500">{n || "—"}</span> },
              { key: "payment_date", label: "Date Paid", render: (date, p) => <span className="text-sm font-medium">{date ? format(new Date(date + "T00:00:00"), "MMM d, yyyy") : format(new Date(p.created_at), "MMM d, yyyy")}</span> },
            ]}
            actions={(payment) => (
              <ActionMenu actions={[
                { label: "Edit Payment", icon: Edit2, onClick: () => handleEditPayment(payment) },
                { label: "Delete Record", icon: Trash2, destructive: true, 
                  onClick: () => { 
                    if(window.confirm("Delete this payment record? This will adjust the invoice balance.")) {
                      deletePaymentMutation.mutate(payment.id);
                    }
                  } 
                }
              ]} />
            )}
          />
        </TabsContent>
      </Tabs>

      {/* ⚡ IMPORTED: Universal Record Payment Component */}
      {selectedInvoice && paymentDialogOpen && (
        <RecordPaymentDialog 
          open={paymentDialogOpen} 
          onOpenChange={(isOpen) => { setPaymentDialogOpen(isOpen); if(!isOpen){ setSelectedInvoice(null); setEditingPaymentId(null); } }} 
          invoice={selectedInvoice} 
          editingPaymentId={editingPaymentId}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["payments"] });
            queryClient.invalidateQueries({ queryKey: ["invoices"] });
          }} 
        />
      )}

      {/* ⚡ NEW COMPONENT MOUNTED HERE */}
      <SendReceiptDialog
        open={receiptDialogOpen}
        onOpenChange={setReceiptDialogOpen}
        payments={payments}
        invoices={invoices}
        clients={clients}
      />  
    </div>
  );
}
