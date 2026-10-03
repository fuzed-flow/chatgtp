import React, { useState, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Copy, Loader2, Search, ChevronDown, Check } from "lucide-react";

export default function DuplicateQuoteDialog({ open, onOpenChange, quote, onSuccess }) {
  const [selectedContactId, setSelectedContactId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  // Handle clicking outside to close the custom dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 1. FETCH CLIENTS
  const { data: clients = [] } = useQuery({
    queryKey: ["clients", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .eq("company_id", companyId)
        .order("name", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  // 2. FETCH LEADS
  const { data: leads = [] } = useQuery({
    queryKey: ["leads", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .eq("company_id", companyId)
        .order("contact_name", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  // 3. FILTERING LOGIC FOR SEARCH
  const filteredLeads = leads.filter(l => 
    (l.contact_name || "Unnamed Lead").toLowerCase().includes(searchTerm.toLowerCase())
  );
  
  const filteredClients = clients.filter(c => 
    (c.name || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedContactName = 
    clients.find(c => c.id === selectedContactId)?.name || 
    leads.find(l => l.id === selectedContactId)?.contact_name || 
    "Search for a client or lead...";

  // 4. SUPABASE RELATIONAL DUPLICATION MUTATION
  const duplicateMutation = useMutation({
    mutationFn: async (contactId) => {
      if (!contactId) throw new Error("Please select a client or lead");

      // A. Fetch full original quote data
      const { data: fullQuote, error: quoteErr } = await supabase
        .from("quotes")
        .select("*")
        .eq("id", quote.id)
        .single();
        
      if (quoteErr || !fullQuote) throw new Error("Original quote not found in database.");

      // B. Fetch related data
      const { data: phases } = await supabase.from("quote_phases").select("*").eq("quote_id", quote.id);
      const { data: items } = await supabase.from("quote_line_items").select("*").eq("quote_id", quote.id);
      const { data: scheduleItems } = await supabase.from("quote_payment_schedules").select("*").eq("quote_id", quote.id);

      const selectedClient = clients.find(c => c.id === contactId);
      const selectedLead = leads.find(l => l.id === contactId);
      
      let newQuoteNumber = `QT-${Date.now().toString().slice(-4)}`;

      // C. Prep new quote payload
      const { id, created_at, updated_at, ...quoteDataToCopy } = fullQuote;
      
      const newQuotePayload = {
        ...quoteDataToCopy,
        status: "Draft",
        quote_number: newQuoteNumber,
        client_id: selectedClient ? contactId : null,
        lead_id: selectedLead ? contactId : null,
        site_address: selectedClient?.site_address || selectedClient?.billing_address || selectedLead?.site_address || "",
        cover_page_title: "",
        cover_page_subtitle: "",
        client_goals_notes: "",
        client_selected_items_json: null,
        sent_at: null,
        viewed_at: null,
        signed_at: null,
        signed_by: null,
        client_signature: null
      };

      // D. Insert new quote
      const { data: newQuote, error: newQuoteErr } = await supabase
        .from("quotes")
        .insert([newQuotePayload])
        .select()
        .single();
        
      if (newQuoteErr) throw newQuoteErr;

      // E. Copy Phases
      const phaseMap = {}; 
      if (phases && phases.length > 0) {
        for (const phase of phases) {
          const { id: oldPhaseId, created_at, updated_at, ...phaseToCopy } = phase;
          const { data: newPhase, error: newPhaseErr } = await supabase
            .from("quote_phases")
            .insert([{ ...phaseToCopy, quote_id: newQuote.id }])
            .select()
            .single();
            
          if (newPhaseErr) throw newPhaseErr;
          phaseMap[oldPhaseId] = newPhase.id;
        }
      }

      // F. Copy Line Items
      if (items && items.length > 0) {
        const newItemsPayload = items.map(item => {
          const { id: oldItemId, created_at, updated_at, ...itemToCopy } = item;
          return {
            ...itemToCopy,
            quote_id: newQuote.id,
            phase_id: itemToCopy.phase_id ? (phaseMap[itemToCopy.phase_id] || null) : null
          };
        });
        
        const { error: newItemsErr } = await supabase.from("quote_line_items").insert(newItemsPayload);
        if (newItemsErr) throw newItemsErr;
      }

      // G. Copy Payment Schedule
      if (fullQuote.has_payment_schedule && scheduleItems && scheduleItems.length > 0) {
        const newSchedulePayload = scheduleItems.map(sched => {
          const { id: oldSchedId, created_at, updated_at, ...schedToCopy } = sched;
          return {
            ...schedToCopy,
            quote_id: newQuote.id
          };
        });
        
        const { error: newSchedErr } = await supabase.from("quote_payment_schedules").insert(newSchedulePayload);
        if (newSchedErr) throw newSchedErr;
      }

      return newQuote;
    },
    onSuccess: () => {
      toast.success("Quote duplicated successfully!");
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      onOpenChange(false);
      setSelectedContactId("");
      setSearchTerm("");
      if (onSuccess) onSuccess();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to duplicate quote");
    },
  });

  return (
    <Dialog open={open} onOpenChange={(val) => {
      onOpenChange(val);
      if (!val) { setDropdownOpen(false); setSearchTerm(""); }
    }}>
      <DialogContent className="sm:max-w-md bg-slate-50 border-slate-200 shadow-xl overflow-visible" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="font-black text-xl flex items-center gap-2 text-slate-900">
            <Copy className="h-5 w-5 text-amber-500" /> Duplicate Quote
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 pt-4">
          <p className="text-sm font-medium text-slate-600 mb-2">
            Select the client or lead who will receive this copied estimate. All phases, line items, and pricing will carry over.
          </p>
          
          <div className="relative" ref={dropdownRef}>
            <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Select Client or Lead *</Label>
            
            {/* Custom Searchable Dropdown Trigger */}
            <div 
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center justify-between w-full p-2.5 border border-slate-200 shadow-sm rounded-md bg-white cursor-pointer hover:bg-slate-50 transition-colors"
            >
              <span className={selectedContactId ? "text-slate-900 font-bold text-sm" : "text-slate-500 text-sm font-medium"}>
                {selectedContactName}
              </span>
              <ChevronDown className="h-4 w-4 text-slate-400" />
            </div>

            {/* Custom Searchable Dropdown Content */}
            {dropdownOpen && (
              <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-72 flex flex-col overflow-hidden">
                <div className="p-2 border-b border-slate-100 bg-slate-50/50">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                      autoFocus
                      placeholder="Type to search..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-9 h-9 bg-white"
                    />
                  </div>
                </div>
                
                <div className="overflow-y-auto p-1">
                  {filteredLeads.length > 0 && (
                    <div className="px-2 py-1.5 text-[10px] font-black text-slate-400 uppercase tracking-wider bg-slate-50 mt-1 rounded-sm">Active Leads</div>
                  )}
                  {filteredLeads.map(lead => (
                    <div
                      key={lead.id}
                      className="px-2.5 py-2 text-sm font-bold text-slate-700 hover:bg-amber-50 hover:text-amber-700 rounded cursor-pointer flex items-center justify-between transition-colors"
                      onClick={() => { setSelectedContactId(lead.id); setDropdownOpen(false); setSearchTerm(""); }}
                    >
                      {lead.contact_name || "Unnamed Lead"}
                      {selectedContactId === lead.id && <Check className="h-4 w-4 text-amber-500" />}
                    </div>
                  ))}

                  {filteredClients.length > 0 && (
                    <div className="px-2 py-1.5 text-[10px] font-black text-slate-400 uppercase tracking-wider bg-slate-50 mt-2 rounded-sm">Clients</div>
                  )}
                  {filteredClients.map(client => (
                    <div
                      key={client.id}
                      className="px-2.5 py-2 text-sm font-bold text-slate-700 hover:bg-amber-50 hover:text-amber-700 rounded cursor-pointer flex items-center justify-between transition-colors"
                      onClick={() => { setSelectedContactId(client.id); setDropdownOpen(false); setSearchTerm(""); }}
                    >
                      {client.name}
                      {selectedContactId === client.id && <Check className="h-4 w-4 text-amber-500" />}
                    </div>
                  ))}

                  {filteredLeads.length === 0 && filteredClients.length === 0 && (
                    <div className="p-4 text-center text-sm font-medium text-slate-500">
                      No matches found.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          
          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 mt-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={duplicateMutation.isPending}
              className="font-bold border-slate-300 bg-white"
            >
              Cancel
            </Button>
            <Button
              onClick={() => duplicateMutation.mutate(selectedContactId)}
              disabled={!selectedContactId || duplicateMutation.isPending}
              className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md min-w-[120px]"
            >
              {duplicateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
              {duplicateMutation.isPending ? "Copying..." : "Duplicate"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}