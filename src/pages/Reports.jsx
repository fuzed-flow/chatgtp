import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { checkAccess } from '@/lib/planConfig'; 
import UpgradeWall from '@/components/shared/UpgradeWall';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from "recharts";
import { format, parseISO, subMonths, startOfYear, startOfQuarter, startOfMonth, endOfMonth, isAfter, isBefore } from "date-fns";
import { Download, TrendingUp, DollarSign, FileText, PieChart, ArrowDownRight, Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { parseRecordDate, paymentDate, withinDateRange, invoiceBalance, csvText } from "@/lib/reporting";
import { formatCurrencyUSD } from "../components/utils/formatCurrency";
import SalesPerformanceDashboard from "@/components/reports/SalesPerformanceDashboard";

const TABS = [
  { id: "sales", label: "Sales Performance", icon: TrendingUp },
  { id: "expenses", label: "Expense Report", icon: PieChart },
  { id: "taxes", label: "Tax Summary", icon: Calculator },
  { id: "invoices", label: "Invoice Aging", icon: FileText },
];

export default function AdvancedReporting() {
  const { profile, company } = useAuth();
  const companyId = profile?.company_id;

  const [activeTab, setActiveTab] = useState("sales");
  const [dateFilter, setDateFilter] = useState("ytd"); // ytd, qtd, month, last_month

  // --- DATE RANGES ---
  const dateRanges = useMemo(() => {
    const today = new Date(); today.setHours(23,59,59,999);
    return {
      ytd: { start: startOfYear(today), end: today },
      qtd: { start: startOfQuarter(today), end: today },
      month: { start: startOfMonth(today), end: today },
      last_month: { start: startOfMonth(subMonths(today, 1)), end: endOfMonth(subMonths(today, 1)) },
    };
  }, []);

  const currentRange = dateRanges[dateFilter];

  const isWithinRange = dateStr => withinDateRange(dateStr, currentRange.start, currentRange.end);

  // --- QUERIES ---
  const { data: invoices = [], isLoading: invoicesLoading } = useQuery({
    queryKey: ["reports_invoices", companyId],
    enabled: !!companyId && activeTab !== "sales",
    queryFn: async () => {
      const { data, error } = await supabase.from("invoices").select("*").eq("company_id", companyId);
      if (error) throw error;
      return data || [];
    }
  });

  const { data: expenses = [], isLoading: expensesLoading } = useQuery({
    queryKey: ["reports_expenses", companyId],
    enabled: !!companyId && activeTab !== "sales",
    queryFn: async () => {
      const { data, error } = await supabase.from("expenses").select("*").eq("company_id", companyId);
      if (error) throw error;
      return data || [];
    }
  });

  const { data: payments = [], isLoading: paymentsLoading } = useQuery({
    queryKey: ["reports_payments", companyId],
    enabled: !!companyId && activeTab !== "sales",
    queryFn: async () => {
      const { data, error } = await supabase.from("payments").select("*").eq("company_id", companyId);
      if (error) throw error;
      return data || [];
    }
  });

  const { data: clients = [] } = useQuery({queryKey:["reports_clients",companyId],enabled:!!companyId && activeTab !== "sales",queryFn:async()=>{
    const {data,error}=await supabase.from("clients").select("id,name").eq("company_id",companyId);if(error)throw error;return data||[];
  }});
  const clientNames = Object.fromEntries(clients.map(client=>[client.id,client.name]));
  const isLoading = invoicesLoading || expensesLoading || paymentsLoading;

  // --- CALCULATIONS: SALES ---
  const filteredInvoices = useMemo(() => invoices.filter(inv => !["Draft","Cancelled","Canceled"].includes(inv.status) && isWithinRange(inv.issue_date || inv.created_at)), [invoices, currentRange]);
  const filteredPayments = useMemo(() => payments.filter(pay => isWithinRange(paymentDate(pay))), [payments, currentRange]);
  
  const totalRevenue = filteredPayments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
  const totalBilled = filteredInvoices.reduce((sum, inv) => sum + (parseFloat(inv.total) || 0), 0);
  const outstandingAR = invoices.filter(inv => !["Paid","Draft","Cancelled","Canceled"].includes(inv.status)).reduce((sum, inv) => sum + (invoiceBalance(inv)), 0);

  // Top Clients
  const topClients = useMemo(() => {
    const clientTotals = {};
    filteredInvoices.forEach(inv => {
      const name = clientNames[inv.client_id] || inv.client_name || "Unassigned client";
      if (!clientTotals[name]) clientTotals[name] = { total: 0, projects: 0, client_name: name };
      clientTotals[name].total += (parseFloat(inv.total) || 0);
      clientTotals[name].projects += 1;
    });
    return Object.values(clientTotals).sort((a, b) => b.total - a.total).slice(0, 5);
  }, [filteredInvoices, clients]);

  // Chart Data: Monthly Revenue
  const monthlyRevenueData = useMemo(() => {
    const months = {};
    for (let i = 5; i >= 0; i--) {
      const d = subMonths(new Date(), i);
      months[format(d, "MMM yyyy")] = { month: format(d, "MMM"), Revenue: 0, Billed: 0 };
    }
    
    payments.forEach(p => {
      const date = parseRecordDate(paymentDate(p));
      if (!date) return;
      const m = format(date, "MMM yyyy");
      if (months[m]) months[m].Revenue += (parseFloat(p.amount) || 0);
    });

    invoices.forEach(inv => {
      if (["Draft","Cancelled","Canceled"].includes(inv.status)) return;
      const date = parseRecordDate(inv.issue_date || inv.created_at);
      if (!date) return;
      const m = format(date, "MMM yyyy");
      if (months[m]) months[m].Billed += (parseFloat(inv.total) || 0);
    });

    return Object.values(months);
  }, [payments, invoices]);


  // --- CALCULATIONS: EXPENSES ---
  const filteredExpenses = useMemo(() => expenses.filter(exp => isWithinRange(exp.date)), [expenses, currentRange]);
  const totalExpenses = filteredExpenses.reduce((sum, exp) => sum + (parseFloat(exp.amount) || 0), 0);

  // Expenses by Category
  const expensesByCategory = useMemo(() => {
    const cats = {};
    filteredExpenses.forEach(exp => {
      const c = exp.category || "Uncategorized";
      cats[c] = (cats[c] || 0) + (parseFloat(exp.amount) || 0);
    });
    return Object.entries(cats).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filteredExpenses]);


  // --- CALCULATIONS: TAXES ---
  const taxSummary = useMemo(() => {
    let collected = 0;
    let paid = 0;

    filteredInvoices.forEach(inv => {
      collected += (parseFloat(inv.tax) || 0);
    });

    filteredExpenses.forEach(exp => {
      // Expense tax is not separately recorded in the current expense schema.
      paid += (parseFloat(exp.tax_amount) || 0); 
    });

    return { collected, paid, liability: collected - paid };
  }, [filteredInvoices, filteredExpenses]);


  // --- CALCULATIONS: AGING ---
  const agingReport = useMemo(() => {
    const todayDate = new Date();
    const buckets = { current: 0, days30: 0, days60: 0, days90: 0 };
    
    const unpaid = invoices.filter(inv => !["Paid","Draft","Cancelled","Canceled"].includes(inv.status));
    
    unpaid.forEach(inv => {
      if (!inv.due_date) return;
      const dueDate = parseISO(inv.due_date);
      const balance = invoiceBalance(inv);
      
      if (isAfter(dueDate, todayDate)) {
        buckets.current += balance;
      } else {
        const diff = Math.floor((todayDate - dueDate) / (1000 * 60 * 60 * 24));
        if (diff <= 30) buckets.days30 += balance;
        else if (diff <= 60) buckets.days60 += balance;
        else buckets.days90 += balance;
      }
    });
    return buckets;
  }, [invoices]);


  // --- EXPORT ---
  const handleExport = () => {
    let headers, records;
    if (activeTab === "sales") {
      headers = ["Payment date", "Invoice ID", "Payment method", "Amount received"];
      records = filteredPayments.map(p => [paymentDate(p), p.invoice_id, p.payment_method, p.amount]);
    } else if (activeTab === "expenses") {
      headers = ["Date", "Category", "Project ID", "Description", "Status", "Amount"];
      records = filteredExpenses.map(e => [e.date, e.category, e.project_id, e.description, e.status, e.amount]);
    } else if (activeTab === "taxes") {
      headers = ["Invoice", "Issue date", "Status", "Tax billed"];
      records = filteredInvoices.map(i => [i.invoice_number, i.issue_date || i.created_at, i.status, i.tax]);
    } else {
      headers = ["Invoice", "Due date", "Status", "Balance due"];
      records = invoices.filter(i => i.status !== "Paid" && i.status !== "Draft").map(i => [i.invoice_number, i.due_date, i.status, invoiceBalance(i)]);
    }
    const url = URL.createObjectURL(new Blob([csvText(headers, records)], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `fuzedflow-${activeTab}-${dateFilter}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Report downloaded");
  };

  if (!checkAccess(company?.plan_id, 'hasAdvancedReporting')) {
    return <UpgradeWall featureName="Reports" requiredPlan="Professional" />;
  }

  if (activeTab === "sales") {
    return (
      <div className="min-h-screen bg-[#07090d] flex flex-col font-sans">
        <div className="sticky top-0 z-30 shrink-0 border-b border-slate-800 bg-slate-950/95 shadow-sm backdrop-blur">
          <div className="mx-auto max-w-7xl px-4 py-4 md:px-6">
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
              <div>
                <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-white"><PieChart className="h-6 w-6 text-amber-400" /> Reports & Analytics</h1>
                <p className="mt-1 text-sm font-medium text-slate-400">Financial and sales insights across your workspace.</p>
              </div>
              <div className="hidden gap-1 overflow-x-auto rounded-xl border border-slate-800 bg-slate-900 p-1 md:flex">
                {TABS.map(tab => <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-bold transition-all ${activeTab === tab.id ? "bg-amber-400 text-slate-950 shadow-sm" : "text-slate-400 hover:text-white"}`}><tab.icon className="h-4 w-4 shrink-0" />{tab.label}</button>)}
              </div>
              <div className="md:hidden"><Select value={activeTab} onValueChange={setActiveTab}><SelectTrigger className="h-11 w-full border-slate-700 bg-slate-900 font-bold text-white"><SelectValue /></SelectTrigger><SelectContent>{TABS.map(tab => <SelectItem key={tab.id} value={tab.id}>{tab.label}</SelectItem>)}</SelectContent></Select></div>
            </div>
          </div>
        </div>
        <SalesPerformanceDashboard embedded />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-20">
        <div className="h-8 w-8 border-4 border-amber-200 border-t-amber-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      
      {/* HEADER & TABS */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-30 shrink-0 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                <PieChart className="h-6 w-6 text-amber-500" /> Reports & Analytics
              </h1>
              <p className="text-sm font-medium text-slate-500 mt-1">Financial insights across your workspace.</p>
            </div>
            
            {/* DESKTOP TABS */}
            <div className="hidden md:flex p-1 bg-slate-100 rounded-xl border border-slate-200 shrink-0 gap-1 overflow-x-auto">
              {TABS.map(tab => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${
                      isActive ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    <tab.icon className="h-4 w-4 shrink-0" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* MOBILE DROPDOWN TABS */}
            <div className="block md:hidden w-full">
              <Select value={activeTab} onValueChange={setActiveTab}>
                <SelectTrigger className="w-full bg-slate-100 font-bold text-slate-800 border-slate-200 h-11">
                  <SelectValue placeholder="Select report..." />
                </SelectTrigger>
                <SelectContent className="bg-white">
                  {TABS.map(tab => (
                    <SelectItem key={tab.id} value={tab.id}>
                      <div className="flex items-center gap-2">
                        <tab.icon className="h-4 w-4 text-slate-500" />
                        <span>{tab.label}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8">
          
          {/* ACTION BAR: Date Filters & Export */}
          {activeTab !== "invoices" && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 bg-white p-3 md:p-4 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 hide-scrollbar w-full sm:w-auto">
                <Button variant={dateFilter === "ytd" ? "default" : "outline"} onClick={() => setDateFilter("ytd")} size="sm" className={`font-bold whitespace-nowrap ${dateFilter === "ytd" ? "bg-slate-900 text-white" : ""}`}>YTD</Button>
                <Button variant={dateFilter === "qtd" ? "default" : "outline"} onClick={() => setDateFilter("qtd")} size="sm" className={`font-bold whitespace-nowrap ${dateFilter === "qtd" ? "bg-slate-900 text-white" : ""}`}>QTD</Button>
                <Button variant={dateFilter === "month" ? "default" : "outline"} onClick={() => setDateFilter("month")} size="sm" className={`font-bold whitespace-nowrap ${dateFilter === "month" ? "bg-slate-900 text-white" : ""}`}>This Month</Button>
                <Button variant={dateFilter === "last_month" ? "default" : "outline"} onClick={() => setDateFilter("last_month")} size="sm" className={`font-bold whitespace-nowrap ${dateFilter === "last_month" ? "bg-slate-900 text-white" : ""}`}>Last Month</Button>
              </div>
              <Button onClick={handleExport} variant="outline" className="w-full sm:w-auto shrink-0 font-bold text-slate-600 bg-white shadow-sm">
                <Download className="h-4 w-4 mr-2" /> <span className="sm:hidden">Export Report</span><span className="hidden sm:inline">Export</span>
              </Button>
            </div>
          )}

          {/* ===================================== */}
          {/* TAB 1: SALES & REVENUE                */}
          {/* ===================================== */}
          {activeTab === "sales" && (
            <div className="animate-in fade-in slide-in-from-bottom-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 mb-6 md:mb-8">
                <Card className="border-emerald-200 bg-emerald-50/50 shadow-sm">
                  <CardContent className="p-4 md:p-6">
                    <p className="text-xs font-bold text-emerald-600 uppercase tracking-wider mb-2 flex items-center gap-2"><DollarSign className="h-4 w-4" /> Revenue Collected</p>
                    <p className="text-3xl md:text-4xl font-black text-emerald-900">{formatCurrencyUSD(totalRevenue)}</p>
                  </CardContent>
                </Card>
                <Card className="border-blue-200 bg-blue-50/50 shadow-sm">
                  <CardContent className="p-4 md:p-6">
                    <p className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-2 flex items-center gap-2"><FileText className="h-4 w-4" /> Total Invoiced</p>
                    <p className="text-3xl md:text-4xl font-black text-blue-900">{formatCurrencyUSD(totalBilled)}</p>
                  </CardContent>
                </Card>
                <Card className="border-amber-200 bg-amber-50/50 shadow-sm sm:col-span-2 lg:col-span-1">
                  <CardContent className="p-4 md:p-6">
                    <p className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-2 flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Outstanding A/R</p>
                    <p className="text-3xl md:text-4xl font-black text-amber-900">{formatCurrencyUSD(outstandingAR)}</p>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-6">
                  <h3 className="text-lg font-black text-slate-900 mb-1">6-Month Trend</h3>
                  <p className="text-xs font-medium text-slate-500">Revenue collected vs Invoiced amounts.</p>
                  <div className="h-64 sm:h-80 mt-6 relative w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={monthlyRevenueData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dy={10} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(val) => `$${val/1000}k`} />
                        <Tooltip cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '4 4' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                        <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                        <Line type="monotone" dataKey="Revenue" stroke="#10b981" strokeWidth={3} dot={{ r: 4, fill: "#10b981", strokeWidth: 2 }} activeDot={{ r: 6 }} />
                        <Line type="monotone" dataKey="Billed" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4, fill: "#3b82f6", strokeWidth: 2 }} activeDot={{ r: 6 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-6">
                  <h3 className="text-lg font-black text-slate-900 mb-1">Top Clients</h3>
                  <p className="text-xs font-medium text-slate-500 mb-6">By total invoiced amount ({dateFilter.toUpperCase()})</p>
                  
                  <div className="space-y-3 md:space-y-4">
                    {topClients.map((client, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 rounded-lg border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                        {/* MOBILE FIX: min-w-0 prevents text overflow, truncate keeps it clean */}
                        <div className="min-w-0 flex-1 mr-3">
                          <p className="font-bold text-slate-900 text-sm truncate">{client.client_name}</p>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">{client.projects} projects</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-black text-emerald-600">{formatCurrencyUSD(client.total)}</p>
                        </div>
                      </div>
                    ))}
                    {topClients.length === 0 && <p className="text-sm text-slate-400 italic text-center py-4">No client data in this period.</p>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ===================================== */}
          {/* TAB 2: EXPENSES                       */}
          {/* ===================================== */}
          {activeTab === "expenses" && (
            <div className="animate-in fade-in slide-in-from-bottom-2">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mb-6 md:mb-8">
                <Card className="border-red-200 bg-red-50/50 shadow-sm md:col-span-1">
                  <CardContent className="p-6">
                    <p className="text-xs font-bold text-red-600 uppercase tracking-wider mb-2 flex items-center gap-2"><ArrowDownRight className="h-4 w-4" /> Total Expenses</p>
                    <p className="text-4xl font-black text-red-900">{formatCurrencyUSD(totalExpenses)}</p>
                    <p className="text-xs text-red-600 mt-2 font-medium">{filteredExpenses.length} transactions</p>
                  </CardContent>
                </Card>

                <Card className="border-slate-200 shadow-sm md:col-span-2">
                  <CardContent className="p-6 h-full flex flex-col justify-center">
                    <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider mb-4">Expenses by Category</h3>
                    <div className="space-y-4">
                      {expensesByCategory.slice(0, 3).map((cat, i) => (
                        <div key={i}>
                          <div className="flex justify-between text-sm mb-1.5">
                            <span className="font-bold text-slate-700 truncate mr-4">{cat.name}</span>
                            <span className="font-black text-slate-900 shrink-0">{formatCurrencyUSD(cat.value)}</span>
                          </div>
                          <div className="w-full bg-slate-100 rounded-full h-2">
                            <div className="bg-red-400 h-2 rounded-full" style={{ width: `${Math.min(100, (cat.value / totalExpenses) * 100)}%` }}></div>
                          </div>
                        </div>
                      ))}
                      {expensesByCategory.length === 0 && <p className="text-sm text-slate-400 italic">No expenses recorded.</p>}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                  <h3 className="font-black text-slate-900">Expense Log</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left whitespace-nowrap">
                    <thead className="bg-slate-50 border-b border-slate-100 text-[10px] uppercase font-black text-slate-400 tracking-wider">
                      <tr>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Merchant / Desc</th>
                        <th className="px-4 py-3">Category</th>
                        <th className="px-4 py-3">Project</th>
                        <th className="px-4 py-3 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredExpenses.map(exp => (
                        <tr key={exp.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-medium text-slate-600">{exp.date ? format(parseISO(exp.date), "MMM d, yyyy") : "-"}</td>
                          <td className="px-4 py-3">
                            <p className="font-bold text-slate-900 truncate max-w-[200px]">{exp.merchant || "Unknown Merchant"}</p>
                            <p className="text-xs text-slate-500 truncate max-w-[200px]">{exp.description}</p>
                          </td>
                          <td className="px-4 py-3"><Badge variant="secondary" className="bg-slate-100 text-slate-600 hover:bg-slate-200">{exp.category || "Uncategorized"}</Badge></td>
                          <td className="px-4 py-3 text-xs font-medium text-slate-500 truncate max-w-[150px]">{exp.project_name || "General"}</td>
                          <td className="px-4 py-3 text-right font-black text-slate-900">{formatCurrencyUSD(exp.amount)}</td>
                        </tr>
                      ))}
                      {filteredExpenses.length === 0 && (
                        <tr><td colSpan="5" className="px-4 py-8 text-center text-slate-500">No expenses found for this period.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ===================================== */}
          {/* TAB 3: TAXES                          */}
          {/* ===================================== */}
          {activeTab === "taxes" && (
            <div className="animate-in fade-in slide-in-from-bottom-2">
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col md:flex-row">
                
                {/* Tax KPI Sidebar */}
                <div className="w-full md:w-64 bg-slate-50 border-b md:border-b-0 md:border-r border-slate-200 p-4 md:p-6 shrink-0 flex flex-col justify-center">
                  <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider mb-6">Invoiced Tax Overview</h3>
                  
                  <div className="space-y-6">
                    <div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Tax on issued invoices</p>
                      <p className="text-2xl font-black text-emerald-600">{formatCurrencyUSD(taxSummary.collected)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Expense tax not recorded</p>
                      <p className="text-2xl font-black text-red-600">Not available</p>
                    </div>
                    <div className="pt-4 border-t border-slate-200">
                      <p className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-1">Invoiced tax total</p>
                      <p className={`text-3xl font-black ${taxSummary.liability > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                        {formatCurrencyUSD(taxSummary.liability)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Tax Source Table */}
                <div className="flex-1 p-4 md:p-6 overflow-hidden">
                  <h3 className="text-lg font-black text-slate-900 mb-4">Invoice Tax Sources</h3><p className="text-sm text-slate-600 mb-4">Invoice tax amounts only. Expense tax credits and filing adjustments are not tracked here. This overview is not a tax return.</p>
                  <div className="overflow-x-auto bg-white border border-slate-200 rounded-lg">
                    <table className="w-full text-sm text-left whitespace-nowrap">
                      <thead className="bg-slate-50 border-b border-slate-100 text-[10px] uppercase font-black text-slate-500">
                        <tr>
                          <th className="px-4 py-2">Invoice #</th>
                          <th className="px-4 py-2">Client</th>
                          <th className="px-4 py-2 text-right">Tax Billed</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredInvoices.filter(inv => parseFloat(inv.tax) > 0).map(inv => (
                          <tr key={inv.id} className="hover:bg-slate-50">
                            <td className="px-4 py-2 font-bold text-slate-700">{inv.invoice_number || inv.id.substring(0,6)}</td>
                            <td className="px-4 py-2 font-medium">{clients.find(client => client.id === inv.client_id)?.name || inv.client_name || "Unassigned client"}</td>
                            <td className="px-4 py-2 text-right font-black text-emerald-600">{formatCurrencyUSD(inv.tax)}</td>
                          </tr>
                        ))}
                        {filteredInvoices.filter(inv => parseFloat(inv.tax) > 0).length === 0 && (
                          <tr><td colSpan="3" className="px-4 py-6 text-center text-slate-400 italic">No taxable invoices found.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-4 text-center italic">* This is an estimate. Please consult your accountant for official filings.</p>
                </div>
              </div>
            </div>
          )}

          {/* ===================================== */}
          {/* TAB 4: INVOICE AGING                  */}
          {/* ===================================== */}
          {activeTab === "invoices" && (
            <div className="animate-in fade-in slide-in-from-bottom-2">
              <div className="flex items-center justify-between mb-6 bg-white p-3 md:p-4 rounded-xl border border-slate-200 shadow-sm">
                <div>
                  <h3 className="font-black text-slate-900 text-lg">A/R Aging Summary</h3>
                  <p className="text-xs text-slate-500 font-medium">As of {format(new Date(), "MMM d, yyyy")}</p>
                </div>
                <Button onClick={handleExport} variant="outline" className="shrink-0 font-bold text-slate-600 bg-white shadow-sm">
                  <Download className="h-4 w-4 md:mr-2" /> <span className="hidden md:inline">Export Aging</span>
                </Button>
              </div>

              {/* Aging Buckets */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6 md:mb-8">
                <Card className="border-emerald-200 bg-emerald-50 shadow-sm">
                  <CardContent className="p-4 md:p-5 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 mb-1">Current</p>
                    <p className="text-xl md:text-2xl font-black text-emerald-900">{formatCurrencyUSD(agingReport.current)}</p>
                  </CardContent>
                </Card>
                <Card className="border-amber-200 bg-amber-50 shadow-sm">
                  <CardContent className="p-4 md:p-5 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600 mb-1">1 - 30 Days Past Due</p>
                    <p className="text-xl md:text-2xl font-black text-amber-900">{formatCurrencyUSD(agingReport.days30)}</p>
                  </CardContent>
                </Card>
                <Card className="border-orange-200 bg-orange-50 shadow-sm">
                  <CardContent className="p-4 md:p-5 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-orange-600 mb-1">31 - 60 Days Past Due</p>
                    <p className="text-xl md:text-2xl font-black text-orange-900">{formatCurrencyUSD(agingReport.days60)}</p>
                  </CardContent>
                </Card>
                <Card className="border-red-200 bg-red-50 shadow-sm">
                  <CardContent className="p-4 md:p-5 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-red-600 mb-1">60+ Days Past Due</p>
                    <p className="text-xl md:text-2xl font-black text-red-900">{formatCurrencyUSD(agingReport.days90)}</p>
                  </CardContent>
                </Card>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left whitespace-nowrap">
                    <thead className="bg-slate-50 border-b border-slate-100 text-[10px] uppercase font-black text-slate-400 tracking-wider">
                      <tr>
                        <th className="px-4 py-3">Invoice</th>
                        <th className="px-4 py-3">Client</th>
                        <th className="px-4 py-3">Due Date</th>
                        <th className="px-4 py-3 text-right">Total</th>
                        <th className="px-4 py-3 text-right text-red-600">Balance Due</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {invoices.filter(inv => !["Paid","Draft","Cancelled","Canceled"].includes(inv.status)).sort((a,b) => new Date(a.due_date) - new Date(b.due_date)).map(inv => {
                        const isPastDue = isBefore(parseISO(inv.due_date), new Date());
                        return (
                          <tr key={inv.id} className={`hover:bg-slate-50 ${isPastDue ? "bg-red-50/20" : ""}`}>
                            <td className="px-4 py-3 font-bold text-slate-900">{inv.invoice_number || inv.id.substring(0,6)}</td>
                            <td className="px-4 py-3 font-medium text-slate-700">{inv.client_name}</td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-0.5 rounded text-xs font-bold ${isPastDue ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                                {inv.due_date ? format(parseISO(inv.due_date), "MMM d, yyyy") : "-"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-medium text-slate-500">{formatCurrencyUSD(inv.total)}</td>
                            <td className="px-4 py-3 text-right font-black text-red-600">{formatCurrencyUSD(inv.balance_due || inv.total)}</td>
                          </tr>
                        );
                      })}
                      {invoices.filter(inv => !["Paid","Draft","Cancelled","Canceled"].includes(inv.status)).length === 0 && (
                        <tr><td colSpan="5" className="px-4 py-8 text-center text-slate-500 font-medium">No open invoices. Great job!</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
