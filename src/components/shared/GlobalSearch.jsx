import React, { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Search, Loader2, FileText, Users, Target, FolderKanban, Receipt, Filter, X, Calendar, DollarSign } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ENTITY_TYPES = [
  { name: "Quote", icon: FileText, color: "text-blue-500", page: "/QuoteView" },
  { name: "Client", icon: Users, color: "text-green-500", page: "/ClientDetail" },
  { name: "Lead", icon: Target, color: "text-orange-500", page: "/LeadTracker" },
  { name: "Project", icon: FolderKanban, color: "text-purple-500", page: "/PMProjectWorkspace" },
  { name: "Invoice", icon: Receipt, color: "text-red-500", page: "/InvoiceView" },
];

// ⚡ Removed isMobileIcon prop
export default function GlobalSearch({ onCloseSidebar }) {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const [filters, setFilters] = useState({
    type: "all",
    status: "all",
    dateFrom: "",
    dateTo: "",
    minAmount: "",
    maxAmount: "",
  });

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(prev => !prev);
      }
      if (e.key === "Escape") setOpen(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
    }
  }, [open]);

  useEffect(() => {
    const search = async () => {
      const hasActiveFilters = filters.type !== "all" || filters.status !== "all" || filters.dateFrom || filters.dateTo || filters.minAmount || filters.maxAmount;
      
      if (!query.trim() && !hasActiveFilters) {
        setResults([]);
        return;
      }

      if (!companyId) return;

      setLoading(true);
      const searchResults = [];
      const searchTerm = query.trim(); 

      try {
        const promises = [];
        
        const getSearchQuery = (table, selectStr, orCondition) => {
          let q = supabase.from(table).select(selectStr).eq("company_id", companyId).limit(20);
          if (searchTerm) {
             q = q.or(orCondition);
          }
          return q;
        };

        if (filters.type === "all" || filters.type === "Quote") {
          promises.push(
            getSearchQuery("quotes", "id, title, quote_number, status, total, issue_date", `title.ilike.%${searchTerm}%,quote_number.ilike.%${searchTerm}%`)
            .then(res => ({ type: "Quote", data: res.data }))
          );
        }
        if (filters.type === "all" || filters.type === "Client") {
          promises.push(
            getSearchQuery("clients", "id, name, email", `name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`)
            .then(res => ({ type: "Client", data: res.data }))
          );
        }
        if (filters.type === "all" || filters.type === "Lead") {
          promises.push(
            getSearchQuery("leads", "id, contact_name, contact_email, pipeline_stage, value_estimate", `contact_name.ilike.%${searchTerm}%,contact_email.ilike.%${searchTerm}%`)
            .then(res => ({ type: "Lead", data: res.data }))
          );
        }
        if (filters.type === "all" || filters.type === "Project") {
          promises.push(
            getSearchQuery("projects", "id, name, project_number, status, budget_revenue, start_date, client_id, clients(name)", `name.ilike.%${searchTerm}%,project_number.ilike.%${searchTerm}%`)
            .then(res => ({ type: "Project", data: res.data }))
          );
        }
        if (filters.type === "all" || filters.type === "Invoice") {
          promises.push(
            getSearchQuery("invoices", "id, invoice_number, status, total, issue_date", `invoice_number.ilike.%${searchTerm}%`)
            .then(res => ({ type: "Invoice", data: res.data }))
          );
        }

        const settledPromises = await Promise.allSettled(promises);
        
        const matchesStatus = (status) => filters.status === "all" || status === filters.status;
        const matchesDate = (date) => {
          if (!date) return true;
          const itemDate = new Date(date);
          if (filters.dateFrom && itemDate < new Date(filters.dateFrom)) return false;
          if (filters.dateTo && itemDate > new Date(filters.dateTo)) return false;
          return true;
        };
        const matchesAmount = (amount) => {
          if (amount === undefined || amount === null) return true;
          if (filters.minAmount && amount < parseFloat(filters.minAmount)) return false;
          if (filters.maxAmount && amount > parseFloat(filters.maxAmount)) return false;
          return true;
        };

        settledPromises.forEach(result => {
          if (result.status === "fulfilled" && result.value.data) {
            const { type, data } = result.value;
            
            data.forEach(item => {
              if (type === "Quote" && matchesStatus(item.status) && matchesDate(item.issue_date) && matchesAmount(item.total)) {
                searchResults.push({ type, title: item.title, subtitle: `${item.quote_number} · $${(item.total || 0).toFixed(2)}`, id: item.id, page: "/QuoteView", status: item.status });
              }
              if (type === "Client") {
                searchResults.push({ type, title: item.name, subtitle: item.email || "No email", id: item.id, page: "/ClientDetail" });
              }
              if (type === "Lead" && matchesStatus(item.pipeline_stage) && matchesAmount(item.value_estimate)) {
                searchResults.push({ type, title: item.contact_name, subtitle: item.contact_email || "No email", id: item.id, page: "/LeadDetail", status: item.pipeline_stage });
              }
              if (type === "Project" && matchesStatus(item.status) && matchesDate(item.start_date) && matchesAmount(item.budget_revenue)) {
                const clientNameStr = item.clients?.name ? ` · ${item.clients.name}` : "";
                searchResults.push({ type, title: item.name, subtitle: `${item.project_number}${clientNameStr} · $${(item.budget_revenue || 0).toFixed(2)}`, id: item.id, page: "/PMProjectWorkspace", status: item.status });
              }
              if (type === "Invoice" && matchesStatus(item.status) && matchesDate(item.issue_date) && matchesAmount(item.total)) {
                searchResults.push({ type, title: item.invoice_number, subtitle: `$${(item.total || 0).toFixed(2)}`, id: item.id, page: "/InvoiceView", status: item.status });
              }
            });
          }
        });

        setResults(searchResults.slice(0, 40));
      } catch (error) {
        console.error("Search error:", error);
      } finally {
        setLoading(false);
      }
    };

    const timer = setTimeout(search, 300);
    return () => clearTimeout(timer);
  }, [query, filters, companyId]);

  const handleSelect = (result) => {
    navigate(`${result.page}?id=${result.id}`);
    setOpen(false);
  };

  const clearFilters = () => {
    setFilters({ type: "all", status: "all", dateFrom: "", dateTo: "", minAmount: "", maxAmount: "" });
  };

  const hasActiveFilters = filters.type !== "all" || filters.status !== "all" || 
    filters.dateFrom || filters.dateTo || filters.minAmount || filters.maxAmount;

  return (
    <>
      {/* ⚡ RENDERS ON MOBILE ONLY */}
      <Button
        aria-label="Open search"
        variant="ghost" 
        size="icon" 
        onClick={() => {
          setOpen(true);
          if (onCloseSidebar) onCloseSidebar();
        }}
        className="md:hidden text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg h-9 w-9"
      >
        <Search className="h-5 w-5" />
      </Button>

      {/* ⚡ RENDERS ON DESKTOP ONLY */}
      <button
        onClick={() => setOpen(true)}
        className="hidden md:flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 text-sm transition-all border border-slate-200 shadow-sm w-64"
      >
        <Search className="h-4 w-4 text-slate-400" />
        <span className="font-medium">Search...</span>
        <span className="text-[10px] font-bold text-slate-400 ml-auto border border-slate-300 bg-white px-1.5 rounded">⌘K</span>
      </button>

      {/* MODAL & FILTERS */}
{open && (
  <div className="fixed inset-0 z-[999] bg-slate-900/40 backdrop-blur-sm flex items-start justify-center sm:pt-20 sm:px-4" onClick={() => setOpen(false)}>
          <div className="bg-white sm:rounded-xl shadow-2xl w-full h-full sm:h-auto max-w-2xl sm:border border-slate-200 flex flex-col" onClick={(e) => e.stopPropagation()}>
            
            {/* SEARCH BAR */}
            <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 border-b border-slate-100 bg-white shrink-0">
              <Search className="h-5 w-5 text-blue-500 shrink-0" />
              <input
                autoFocus
                type="text"
                placeholder="Search quotes, clients..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="flex-1 min-w-0 outline-none text-sm sm:text-lg font-medium text-slate-900 placeholder:text-slate-400 bg-transparent"
              />
              {loading && <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 text-amber-500 animate-spin shrink-0" />}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
                className={cn("gap-1 font-bold shrink-0 px-2 sm:px-3", hasActiveFilters ? "text-amber-600 bg-amber-50" : "text-slate-500")}
              >
                <Filter className="h-4 w-4" /> 
                <span className="hidden sm:inline">Filters</span>
                {hasActiveFilters && <span className="text-xs">({Object.values(filters).filter(v => v && v !== "all").length})</span>}
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)} className="sm:hidden h-8 w-8 text-slate-400 shrink-0">
                <X className="h-5 w-5" />
              </Button>
            </div>

            {/* FILTERS PANEL */}
            {showFilters && (
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 shadow-inner shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-500">Search Filters</h4>
                  {hasActiveFilters && (
                    <Button variant="ghost" size="sm" onClick={clearFilters} className="h-6 text-[10px] font-bold text-slate-500 hover:text-slate-900 px-2">
                      Clear All
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Type</Label>
                    <Select value={filters.type} onValueChange={(val) => setFilters({...filters, type: val})}>
                      <SelectTrigger className="h-8 text-xs font-bold bg-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        <SelectItem value="Quote">Quotes</SelectItem>
                        <SelectItem value="Client">Clients</SelectItem>
                        <SelectItem value="Lead">Leads</SelectItem>
                        <SelectItem value="Project">Projects</SelectItem>
                        <SelectItem value="Invoice">Invoices</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="hidden sm:block">
                    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Status</Label>
                    <Select value={filters.status} onValueChange={(val) => setFilters({...filters, status: val})}>
                      <SelectTrigger className="h-8 text-xs font-bold bg-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        <SelectItem value="Draft">Draft</SelectItem>
                        <SelectItem value="Sent">Sent</SelectItem>
                        <SelectItem value="Approved">Approved</SelectItem>
                        <SelectItem value="Not Started">Not Started</SelectItem>
                        <SelectItem value="In Progress">In Progress</SelectItem>
                        <SelectItem value="Completed">Completed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="hidden sm:block">
                    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1"><Calendar className="h-3 w-3"/> Date From</Label>
                    <Input type="date" value={filters.dateFrom} onChange={(e) => setFilters({...filters, dateFrom: e.target.value})} className="h-8 text-xs font-medium bg-white" />
                  </div>
                  <div className="hidden sm:block">
                    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1"><Calendar className="h-3 w-3"/> Date To</Label>
                    <Input type="date" value={filters.dateTo} onChange={(e) => setFilters({...filters, dateTo: e.target.value})} className="h-8 text-xs font-medium bg-white" />
                  </div>
                  <div className="hidden sm:block">
                    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1"><DollarSign className="h-3 w-3"/> Min Amount</Label>
                    <Input type="number" value={filters.minAmount} onChange={(e) => setFilters({...filters, minAmount: e.target.value})} placeholder="0.00" className="h-8 text-xs font-bold bg-white" />
                  </div>
                  <div className="hidden sm:block">
                    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1"><DollarSign className="h-3 w-3"/> Max Amount</Label>
                    <Input type="number" value={filters.maxAmount} onChange={(e) => setFilters({...filters, maxAmount: e.target.value})} placeholder="0.00" className="h-8 text-xs font-bold bg-white" />
                  </div>
                </div>
              </div>
            )}

            {/* RESULTS PANEL */}
            <div className="flex-1 overflow-y-auto bg-white sm:max-h-96">
              {results.length > 0 ? (
                <div className="p-2 space-y-1">
                  {results.map((result) => {
                    const entity = ENTITY_TYPES.find((e) => e.name === result.type);
                    return (
                      <button
                        key={`${result.type}-${result.id}`}
                        onClick={() => handleSelect(result)}
                        className="w-full text-left px-3 py-3 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 flex items-center gap-4 transition-all group"
                      >
                        <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center shrink-0 bg-slate-50 border border-slate-100 group-hover:bg-white group-hover:shadow-sm transition-all", entity?.color)}>
                          {entity && <entity.icon className="h-5 w-5" />}
                        </div>
                        <div className="flex-1 min-w-0 pr-2">
                          <div className="font-bold text-sm text-slate-900 leading-tight truncate">{result.title}</div>
                          <div className="text-xs font-medium text-slate-500 leading-tight mt-0.5 truncate">{result.subtitle}</div>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0 hidden sm:flex">
                          {result.status && (
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">{result.status}</span>
                          )}
                          <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 bg-slate-50 px-2 py-0.5 rounded">{result.type}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : query && !loading ? (
                <div className="py-12 text-center">
                  <Search className="h-10 w-10 text-slate-200 mx-auto mb-3" />
                  <p className="text-sm font-bold text-slate-500">No results found for "{query}"</p>
                  <p className="text-xs font-medium text-slate-400 mt-1">Try adjusting your spelling or filters.</p>
                </div>
              ) : !query ? (
                <div className="py-12 text-center px-4">
                  <p className="text-sm font-bold text-slate-400">Type to search across all records...</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
