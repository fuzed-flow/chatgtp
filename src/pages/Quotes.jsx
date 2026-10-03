import React, { useState, useEffect, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient"; 
import { useAuth } from "@/lib/AuthContext"; 
import { Link, useNavigate } from "react-router-dom"; 
import { Plus, Trash2, FileText, Eye, LayoutTemplate, Send, Copy, Archive, XCircle, Clock, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageHeader from "../components/shared/PageHeader";
import CreateQuoteFromTemplateDialog from "../components/shared/CreateQuoteFromTemplateDialog";
import DataTable from "../components/shared/DataTable";
import FilterBar from "../components/shared/FilterBar";
import ActionMenu from "../components/shared/ActionMenu";
import StatusBadge from "../components/shared/StatusBadge";
import ViewToggle from "../components/shared/ViewToggle";
import SendQuoteEmailDialog from "../components/quotes/SendQuoteEmailDialog";
import DuplicateQuoteDialog from "../components/quotes/DuplicateQuoteDialog";
import { format } from "date-fns";
import { toast } from "sonner"; 

export default function Quotes() {
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  const [view, setView] = useState(() => localStorage.getItem("quotesView") || "list");
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  const [filters, setFilters] = useState({});
  const navigate = useNavigate();
  const [sortOrder, setSortOrder] = useState("default");
  const [searchQuery, setSearchQuery] = useState("");
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [selectedQuoteForSend, setSelectedQuoteForSend] = useState(null);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [selectedQuoteForDuplicate, setSelectedQuoteForDuplicate] = useState(null);
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);

  const handleViewChange = (newView) => {
    setView(newView);
    localStorage.setItem("quotesView", newView);
  };

  // 1. FETCH QUOTES
  const { data: quotes = [] } = useQuery({ 
    queryKey: ["quotes", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotes")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_template", false)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    } 
  });

  // 2. FETCH CLIENTS
  const { data: clients = [] } = useQuery({ 
    queryKey: ["clients", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, email, site_address, billing_address")
        .eq("company_id", companyId);
      if (error) throw error;
      return data;
    } 
  });

  // 3. FETCH LEADS (NEW)
  const { data: leads = [] } = useQuery({ 
    queryKey: ["leads", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("id, contact_name, contact_email, site_address")
        .eq("company_id", companyId);
      if (error) throw error;
      return data;
    } 
  });

  // 4. SUPABASE DELETE MUTATION
  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("quotes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quotes", companyId] });
      toast.success("Quote deleted successfully");
    },
    onError: (error) => {
      toast.error("Failed to delete quote: " + error.message);
    }
  });

  const updateQuoteMutation = useMutation({
    mutationFn: async ({ id, updates }) => {
      const { error } = await supabase.from("quotes").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quotes", companyId] });
      toast.success("Quote updated successfully");
    },
    onError: (error) => toast.error("Failed to update quote: " + error.message)
  });

  // --- DYNAMIC DATA MAPS ---
  
  const clientDataMap = useMemo(() => {
    return Object.fromEntries(clients.map(c => [c.id, { 
      name: c.name, 
      email: c.email,
      address: c.site_address || c.billing_address 
    }]));
  }, [clients]);

  const leadDataMap = useMemo(() => {
    return Object.fromEntries(leads.map(l => [l.id, { 
      name: l.contact_name, 
      email: l.contact_email,
      address: l.site_address 
    }]));
  }, [leads]);

  const filteredAndMappedQuotes = useMemo(() => {
    return quotes
      .filter(q => {
        const isQuoteArchived = q.is_archived || q.status === "Declined" || q.status === "Expired";
        if (showArchived && !isQuoteArchived) return false;
        if (!showArchived && isQuoteArchived) return false;

        if (filters.status && filters.status !== "All" && q.status !== filters.status) return false;
        
        return true;
      })
      .map(q => {
        // Dynamically pull from Client OR Lead
        const contactName = clientDataMap[q.client_id]?.name || leadDataMap[q.lead_id]?.name || "—";
        const contactEmail = clientDataMap[q.client_id]?.email || leadDataMap[q.lead_id]?.email || "";
        const fallbackAddress = clientDataMap[q.client_id]?.address || leadDataMap[q.lead_id]?.address || "";

        return {
          ...q,
          client_name: contactName,
          client_email: contactEmail,
          site_address: q.site_address || fallbackAddress
        };
      })
      .filter(q => {
        // ⚡ NEW SEARCH FILTER LOGIC
        if (!searchQuery) return true;
        const lowerQuery = searchQuery.toLowerCase();
        return (
          (q.title && q.title.toLowerCase().includes(lowerQuery)) ||
          (q.quote_number && q.quote_number.toLowerCase().includes(lowerQuery)) ||
          (q.client_name && q.client_name.toLowerCase().includes(lowerQuery)) ||
          (q.site_address && q.site_address.toLowerCase().includes(lowerQuery))
        );
      })
      .sort((a, b) => {
        if (sortOrder === "a-z") return (a.title || "").localeCompare(b.title || "");
        if (sortOrder === "z-a") return (b.title || "").localeCompare(a.title || "");
        return 0; 
      });
  }, [quotes, filters.status, sortOrder, clientDataMap, leadDataMap, showArchived, searchQuery]); // Make sure to add searchQuery to dependencies

  const columns = [
    { key: "quote_number", label: "Quote #", width: "110px" },
    {
      key: "title",
      label: "Title",
      width: "150px",
      render: (title, q) => (
        <Link to={`/QuoteBuilder?id=${q.id}`} className="text-slate-700 hover:text-amber-600 font-medium">
          {title}
        </Link>
      )
    },
    // CHANGED TO CLIENT / LEAD
    { key: "client_name", label: "Client / Lead", width: "150px" },
    { key: "site_address", label: "Site Address", width: "180px", render: (addr) => addr || "—" },
    { key: "total", label: "Total", width: "100px", render: (total) => `$${(Number(total) || 0).toLocaleString()}` },
    { key: "status", label: "Status", width: "100px", render: (status) => <StatusBadge status={status} /> },
    { key: "issue_date", label: "Date", width: "120px", render: (date) => date ? format(new Date(date), "MMM d, yyyy") : "—" },
  ];

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <PageHeader
        title={showArchived ? "Archived Quotes" : "Quotes"}
        description={`${filteredAndMappedQuotes.length} ${showArchived ? "archived" : "active"} quotes`}
        actions={
          <div className="flex flex-wrap gap-2">
            
            <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 h-9">
              <button 
                onClick={() => { setShowArchived(false); setFilters({}); }} 
                className={`px-4 text-sm font-bold rounded-md transition-all flex items-center ${!showArchived ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Active
              </button>
              <button 
                onClick={() => { setShowArchived(true); setFilters({}); }} 
                className={`px-4 text-sm font-bold rounded-md transition-all flex items-center gap-1.5 ${showArchived ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <Archive className="h-3.5 w-3.5" /> Archived
              </button>
            </div>

            <CreateQuoteFromTemplateDialog>
              <Button variant="outline" size="sm" className="gap-2 h-9">
                <LayoutTemplate className="h-4 w-4" /> <span className="hidden sm:inline">From Template</span>
              </Button>
            </CreateQuoteFromTemplateDialog>

            <Link to="/QuoteBuilder">
              <Button size="sm" className="bg-slate-900 hover:bg-slate-800 h-9"><Plus className="h-4 w-4 mr-1" /> New Quote</Button>
            </Link>
            
          </div>
        }
      />

     {/* Changed to grid on mobile, flex on larger screens */}
      {/* --- CONTROLS SECTION: SEARCH, FILTER, SORT --- */}
      <div className="mb-4 flex flex-col gap-3">
        
        {/* Top Row: Search Bar & View Toggle */}
        <div className="flex justify-between items-center gap-3 w-full">
          <div className="relative w-full sm:max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search quotes, clients, or addresses..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 h-9 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
          {!isMobile && <ViewToggle view={view} onViewChange={handleViewChange} />}
        </div>

        {/* Bottom Row: Filters & Sort */}
        <div className="grid grid-cols-2 sm:flex sm:flex-row gap-3">
          <div className="flex-1 sm:flex-none">
            <FilterBar
              key={showArchived ? "archived" : "active"}
              filters={[
                { 
                  key: "status", 
                  label: "Status", 
                  type: "select", 
                  options: (showArchived ? ["Declined", "Expired"] : ["Draft", "Sent", "Approved"]).map(s => ({ label: s, value: s })) 
                },
              ]}
              onFiltersChange={setFilters}
            />
          </div>
          
          <div className="flex-1 sm:flex-none">
            <Select value={sortOrder} onValueChange={setSortOrder}>
              <SelectTrigger className="w-full sm:w-[180px]"> 
                <SelectValue placeholder="Sort by..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default (Newest)</SelectItem>
                <SelectItem value="a-z">A-Z</SelectItem>
                <SelectItem value="z-a">Z-A</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {view === "list" && !isMobile ? (
        <DataTable
          columns={columns}
          data={filteredAndMappedQuotes}
          searchableFields={["quote_number", "title", "client_name", "site_address", "total", "status", "issue_date"]}
          emptyMessage="No quotes found"
          onRowClick={(quote) => navigate(`/QuoteBuilder?id=${quote.id}`)}
          actions={(quote) => (
            <ActionMenu
              actions={[
                { label: "Send", icon: Send, onClick: (e) => { e.stopPropagation(); setSelectedQuoteForSend(quote); setSendDialogOpen(true); } },
                { label: "Duplicate", icon: Copy, onClick: (e) => { e.stopPropagation(); setSelectedQuoteForDuplicate(quote); setDuplicateDialogOpen(true); } },
                { label: "Mark Declined", icon: XCircle, onClick: (e) => { e.stopPropagation(); updateQuoteMutation.mutate({ id: quote.id, updates: { status: "Declined", is_archived: true } }); } },
                { label: "Mark Expired", icon: Clock, onClick: (e) => { e.stopPropagation(); updateQuoteMutation.mutate({ id: quote.id, updates: { status: "Expired", is_archived: true } }); } },
                { label: quote.is_archived ? "Unarchive" : "Archive", icon: Archive, onClick: (e) => { e.stopPropagation(); updateQuoteMutation.mutate({ id: quote.id, updates: { is_archived: !quote.is_archived } }); } },
                { label: "Delete", icon: Trash2, destructive: true, onClick: (e) => { e.stopPropagation(); deleteMutation.mutate(quote.id); } },
              ]}
            />
          )}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAndMappedQuotes.length === 0 && (
            <div className="col-span-full py-8 text-center text-slate-500">No quotes found</div>
          )}
          {filteredAndMappedQuotes.map(quote => (
            <Card 
              key={quote.id} 
              className="cursor-pointer hover:shadow-lg transition-all"
              onClick={() => navigate(`/QuoteBuilder?id=${quote.id}`)}
            >
              <div className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 pr-2">
                    <h3 className="font-semibold text-lg text-slate-900 mb-1">{quote.title}</h3>
                    <div className="text-sm text-slate-500 mb-2">{quote.quote_number}</div>
                    <StatusBadge status={quote.status} />
                  </div>
                  <ActionMenu
                    actions={[
                      { label: "Send", icon: Send, onClick: (e) => { e.stopPropagation(); setSelectedQuoteForSend(quote); setSendDialogOpen(true); } },
                      { label: "Duplicate", icon: Copy, onClick: (e) => { e.stopPropagation(); setSelectedQuoteForDuplicate(quote); setDuplicateDialogOpen(true); } },
                      { label: "Mark Declined", icon: XCircle, onClick: (e) => { e.stopPropagation(); updateQuoteMutation.mutate({ id: quote.id, updates: { status: "Declined", is_archived: true } }); } },
                      { label: "Mark Expired", icon: Clock, onClick: (e) => { e.stopPropagation(); updateQuoteMutation.mutate({ id: quote.id, updates: { status: "Expired", is_archived: true } }); } },
                      { label: quote.is_archived ? "Unarchive" : "Archive", icon: Archive, onClick: (e) => { e.stopPropagation(); updateQuoteMutation.mutate({ id: quote.id, updates: { is_archived: !quote.is_archived } }); } },
                      { label: "Delete", icon: Trash2, destructive: true, onClick: (e) => { e.stopPropagation(); deleteMutation.mutate(quote.id); } },
                    ]}
                  />
                </div>
                <div className="space-y-2 mt-4 pt-4 border-t border-slate-100">
                  <div className="flex justify-between text-sm">
                    {/* CHANGED TO CLIENT / LEAD */}
                    <span className="text-slate-500">Client/Lead:</span>
                    <span className="font-medium text-slate-900 text-right">{quote.client_name}</span>
                  </div>
                  {quote.site_address && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Site:</span>
                      <span className="font-medium text-slate-900 text-right max-w-[60%] truncate">{quote.site_address}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Date:</span>
                    <span className="font-medium text-slate-900">{quote.issue_date ? format(new Date(quote.issue_date), "MMM d, yyyy") : "—"}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Total:</span>
                    <span className="font-medium text-slate-900">${(Number(quote.total) || 0).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <SendQuoteEmailDialog 
        open={sendDialogOpen} 
        onOpenChange={setSendDialogOpen} 
        quoteId={selectedQuoteForSend?.id}
        quoteName={selectedQuoteForSend?.title || `Quote ${selectedQuoteForSend?.quote_number}`}
        clientName={selectedQuoteForSend?.client_name || ""} 
        clientEmail={selectedQuoteForSend?.client_email || ""} 
        onSuccess={() => {
          queryClient.invalidateQueries(["quotes"]);
        }}
      />

      {selectedQuoteForDuplicate && (
        <DuplicateQuoteDialog
          open={duplicateDialogOpen}
          onOpenChange={setDuplicateDialogOpen}
          quote={selectedQuoteForDuplicate}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ["quotes", companyId] })}
        />
      )}
    </div>
  );
}