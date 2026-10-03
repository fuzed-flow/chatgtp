import React, { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, Search, Filter, Kanban, List as ListIcon, Phone, Mail, Calendar, GripVertical, Upload, FileText, MoreVertical, Pencil, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import StatusBadge from "../components/shared/StatusBadge";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import LeadFormDialog from "../components/leads/LeadFormDialog";
import DownloadButton from "../components/shared/DownloadButton";
import Papa from "papaparse";
import { toast } from "sonner";

const ALL_PIPELINE_STAGES = ["New", "Contacted", "Booked Visit", "Quoted", "Negotiation", "Won", "Lost"];
const KANBAN_STAGES = ["New", "Contacted", "Booked Visit", "Quoted", "Negotiation"];

export default function LeadTracker() {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const queryClient = useQueryClient();

  // --- STATE ---
  const [viewMode, setViewMode] = useState("kanban");
  const [searchTerm, setSearchTerm] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  
  const [editingLead, setEditingLead] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [wonConfirmLead, setWonConfirmLead] = useState(null);
  const [lostConfirmLead, setLostConfirmLead] = useState(null);

  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const fileInputRef = useRef(null);
  // Default to having "Booked Visit" expanded on mobile
  const [expandedStages, setExpandedStages] = useState(["Booked Visit"]);

  const toggleStage = (stage) => {
    if (!isMobile) return;
    setExpandedStages(prev => 
      prev.includes(stage) ? prev.filter(s => s !== stage) : [...prev, stage]
    );
  };

  React.useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // --- QUERIES ---
  const { data: leads = [], isLoading } = useQuery({
    queryKey: ["leads", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: users = [] } = useQuery({
    queryKey: ["users", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").eq("company_id", companyId);
      if (error) throw error;
      return data || [];
    },
  });

  // --- MUTATIONS ---
  const saveMutation = useMutation({
    mutationFn: async (data) => {
      if (editingLead) {
        const { error } = await supabase.from("leads").update(data).eq("id", editingLead.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("leads").insert([{ ...data, company_id: companyId }]);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads", companyId] });
      setDialogOpen(false);
      setEditingLead(null);
      toast.success(editingLead ? "Lead updated successfully" : "Lead created successfully");
    },
  });

  const updateStageMutation = useMutation({
    mutationFn: async ({ id, pipeline_stage }) => {
      const { error } = await supabase.from("leads").update({ pipeline_stage }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leads", companyId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("leads").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads", companyId] });
      setDeleteConfirmId(null);
      toast.success("Lead deleted");
    },
  });

  const convertClientMutation = useMutation({
    mutationFn: async (lead) => {
      // Basic split if user didn't pre-fill first/last name
      const nameParts = (lead.contact_name || "").split(" ");
      const firstName = nameParts[0] || "";
      const surname = nameParts.slice(1).join(" ") || "";

      // 1. Insert into clients table
      const { data: newClient, error: clientErr } = await supabase
        .from("clients")
        .insert([{
          company_id: companyId,
          name: lead.contact_name,
          first_name: firstName,
          surname: surname,
          email: lead.contact_email,
          phone: lead.contact_phone,
          site_address: lead.site_address,
          notes: lead.description || lead.notes,
          type: "Residential"
        }])
        .select()
        .single();
      
      if (clientErr) throw clientErr;

      // 2. Update Lead Stage to Won and map client_id
      const { error: leadErr } = await supabase
        .from("leads")
        .update({ pipeline_stage: "Won", client_id: newClient.id })
        .eq("id", lead.id);

      if (leadErr) throw leadErr;
      return newClient;
    },
    onSuccess: (newClient) => {
      queryClient.invalidateQueries({ queryKey: ["leads", companyId] });
      setWonConfirmLead(null);
      toast.success("Lead converted to client!");
      window.location.href = `/ClientDetail?id=${newClient.id}`;
    },
    onError: (err) => toast.error(`Conversion failed: ${err.message}`)
  });

  const importMutation = useMutation({
    mutationFn: async (parsedData) => {
      const leadsToInsert = parsedData.map(row => ({
        company_id: companyId,
        contact_name: row["Contact Name"] || row.contact_name,
        contact_email: row["Contact Email"] || row.contact_email,
        contact_phone: row["Contact Phone"] || row.contact_phone,
        pipeline_stage: row["Stage"] || row.pipeline_stage || "New",
        value_estimate: parseFloat(row["Value Estimate"] || row.value_estimate) || null,
        source: row["Source"] || row.source,
        description: row["Description"] || row.description
      }));
      const { error } = await supabase.from("leads").insert(leadsToInsert);
      if (error) throw error;
    },
    onSuccess: () => { 
      queryClient.invalidateQueries({ queryKey: ["leads", companyId] }); 
      toast.success("Leads imported"); 
    },
    onError: (error) => toast.error(`Import failed: ${error.message}`)
  });

  // --- HANDLERS ---
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.data && results.data.length > 0) importMutation.mutate(results.data);
        else toast.error("No valid data found in CSV");
        event.target.value = null;
      },
    });
  };

  const onDragEnd = (result) => {
    if (!result.destination) return;
    const { draggableId, destination } = result;
    const newStage = destination.droppableId;
    
    const leadToMove = leads.find(l => l.id === draggableId);
    if (!leadToMove) return;

    if (newStage === "Won") {
      setWonConfirmLead(leadToMove);
      return;
    }
    if (newStage === "Lost") {
      setLostConfirmLead(leadToMove);
      return;
    }

    if (leadToMove.pipeline_stage !== newStage) {
      queryClient.setQueryData(["leads", companyId], (old) => 
        old.map(l => l.id === draggableId ? { ...l, pipeline_stage: newStage } : l)
      );
      updateStageMutation.mutate({ id: draggableId, pipeline_stage: newStage });
    }
  };

  const openEditModal = (lead) => {
    setEditingLead(lead);
    setDialogOpen(true);
  };

  // --- FILTERING ---
  const filteredLeads = leads.filter(l => {
    const matchesSearch = 
      l.contact_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      l.contact_email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      l.description?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStage = stageFilter === "all" || l.pipeline_stage === stageFilter;
    return matchesSearch && matchesStage;
  });

  // --- COMPONENTS ---
  const LeadCard = ({ lead, isDraggable = false }) => {
    return (
      <Card 
        onClick={(e) => {
          // Prevent routing if clicking an interactive element or drag handle
          if (e.target.closest('[role="combobox"]') || e.target.closest('.lucide-grip-vertical')) return;
          window.location.href = `/LeadDetail?id=${lead.id}`;
        }}
        className="p-4 bg-white hover:shadow-md transition-shadow border-slate-200 cursor-pointer group"
      >
        <div className="flex justify-between items-start mb-2">
          <h3 className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors line-clamp-1">{lead.contact_name}</h3>
          {!isMobile && isDraggable && (
            <GripVertical className="h-4 w-4 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 lucide-grip-vertical" />
          )}
        </div>
        
        {lead.value_estimate && (
          <p className="text-sm font-semibold text-emerald-600 mb-2">${Number(lead.value_estimate).toLocaleString()}</p>
        )}
        
        <div className="space-y-1.5 mb-1">
          {lead.contact_email && (
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <Mail className="h-3 w-3 shrink-0" /> <span className="truncate">{lead.contact_email}</span>
            </div>
          )}
          {lead.contact_phone && (
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <Phone className="h-3 w-3 shrink-0" /> <span>{lead.contact_phone}</span>
            </div>
          )}
        </div>

        {isMobile && (
          <div className="mt-3 pt-3 border-t border-slate-100" onClick={(e) => e.stopPropagation()}>
            <Select 
              value={lead.pipeline_stage} 
              onValueChange={(newStage) => updateStageMutation.mutate({ id: lead.id, pipeline_stage: newStage })}
            >
              <SelectTrigger className="h-8 text-xs bg-slate-50">
                <SelectValue placeholder="Change Stage..." />
              </SelectTrigger>
              <SelectContent>
                {ALL_PIPELINE_STAGES.map(stage => (
                  <SelectItem key={stage} value={stage} className="text-xs">{stage}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </Card>
    );
    return isDraggable && !isMobile ? content : <Link to={`/LeadDetail?id=${lead.id}`}>{content}</Link>;
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto h-[calc(100vh-80px)] overflow-hidden flex flex-col">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Lead Tracker</h1>
          <p className="text-sm text-slate-500">Manage incoming inquiries and sales pipeline</p>
        </div>
        
        <div className="flex flex-wrap items-center justify-between w-full sm:w-auto sm:justify-end gap-2">
          <div className="flex items-center gap-2">
            <input type="file" accept=".xlsx,.xls,.csv" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
            <Button variant="outline" className="order-3 sm:order-1" onClick={() => window.open("https://ochqexofahdssmarnict.supabase.co/storage/v1/object/public/csv%20templates/lead-remplate-fuzed-flow.xlsx.csv", "_blank")}>
              <FileText className="h-4 w-4 sm:mr-2" /> <span className="hidden sm:inline">CSV Template</span>
            </Button>
            <Button variant="outline" className="order-1 sm:order-2" onClick={() => fileInputRef.current?.click()} disabled={importMutation.isPending}>
              <Upload className="h-4 w-4 sm:mr-2" /> <span className="hidden sm:inline">{importMutation.isPending ? "Importing..." : "Import"}</span>
            </Button>
            <div className="order-2 sm:order-3">
              <DownloadButton
                data={filteredLeads}
                filename="leads_export"
                columns={[
                  { label: "Contact Name", key: "contact_name" },
                  { label: "Contact Email", key: "contact_email" },
                  { label: "Contact Phone", key: "contact_phone" },
                  { label: "Stage", key: "pipeline_stage" },
                  { label: "Value Estimate", key: "value_estimate" },
                  { label: "Source", key: "source" },
                  { label: "Description", key: "description" }
                ]}
              />
            </div>
          </div>
          <Button aria-label="Create a new lead" onClick={() => { setEditingLead(null); setDialogOpen(true); }} className="order-4 sm:order-4 bg-pink-700 hover:bg-pink-800 text-white shadow-sm shrink-0">
            <Plus aria-hidden="true" className="h-4 w-4 sm:mr-2 text-green-200" /> <span className="hidden sm:inline">New Lead</span>
          </Button>
        </div>
      </div>

      {/* TOOLBAR */}
      <Card className="p-3 mb-6 bg-white border-slate-200/80 shadow-sm flex flex-col md:flex-row gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input 
            placeholder="Search leads..." 
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-9 bg-slate-50 border-slate-200 w-full"
          />
        </div>
        <div className="flex flex-wrap sm:flex-nowrap gap-2 w-full md:w-auto">
          {viewMode === "list" && (
            <Select value={stageFilter} onValueChange={setStageFilter}>
              <SelectTrigger className="w-full sm:w-[160px] bg-slate-50 border-slate-200">
                <Filter className="h-4 w-4 mr-2 text-slate-400 shrink-0" />
                <SelectValue placeholder="Filter Stage" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stages</SelectItem>
                {ALL_PIPELINE_STAGES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <div className="flex p-1 bg-slate-100 rounded-lg border border-slate-200 shrink-0 ml-auto sm:ml-0">
            <button 
              onClick={() => setViewMode("kanban")}
              className={`p-1.5 rounded-md transition-all ${viewMode === 'kanban' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
              title="Kanban View"
            >
              <Kanban className="h-4 w-4" />
            </button>
            <button 
              onClick={() => setViewMode("list")}
              className={`p-1.5 rounded-md transition-all ${viewMode === 'list' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
              title="List View"
            >
              <ListIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </Card>

     {/* MAIN CONTENT AREA */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center min-h-0">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900"></div>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {viewMode === "kanban" ? (
            /* ⚡ KANBAN BOARD */
            <DragDropContext onDragEnd={onDragEnd}>
              {/* STATIC WON / LOST BUCKETS (Hidden on mobile) */}
              <div className="hidden md:flex gap-4 mb-4 shrink-0">
                <Droppable droppableId="Won">
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`flex-1 p-3 rounded-xl border-2 border-dashed flex flex-col items-center justify-center transition-all ${
                        snapshot.isDraggingOver ? "bg-emerald-100 border-emerald-500 shadow-inner" : "bg-emerald-50/50 border-emerald-200"
                      }`}
                    >
                      <span className={`font-bold text-sm sm:text-base ${snapshot.isDraggingOver ? "text-emerald-700" : "text-emerald-600/70"}`}>
                        🟢 Drop to Convert to Client
                      </span>
                      <div className="hidden">{provided.placeholder}</div>
                    </div>
                  )}
                </Droppable>

                <Droppable droppableId="Lost">
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`flex-1 p-3 rounded-xl border-2 border-dashed flex flex-col items-center justify-center transition-all ${
                        snapshot.isDraggingOver ? "bg-rose-100 border-rose-500 shadow-inner" : "bg-rose-50/50 border-rose-200"
                      }`}
                    >
                      <span className={`font-bold text-sm sm:text-base ${snapshot.isDraggingOver ? "text-rose-700" : "text-rose-600/70"}`}>
                        🔴 Drop to Mark as Lost
                      </span>
                      <div className="hidden">{provided.placeholder}</div>
                    </div>
                  )}
                </Droppable>
              </div>

              {/* ACTIVE PIPELINE */}
              <div className="flex-1 flex min-h-0 overflow-y-auto overflow-x-hidden md:overflow-hidden pb-2 custom-scrollbar">
                {/* Removed w-full here to stop flexbox overflow calculation errors */}
                <div className="flex flex-col md:flex-row gap-3 md:gap-4 flex-1 min-h-0 h-max md:h-full px-1">
                  {KANBAN_STAGES.map(stage => {
                    const stageLeads = filteredLeads.filter(l => l.pipeline_stage === stage);
                    const stageTotal = stageLeads.reduce((sum, l) => sum + (Number(l.value_estimate) || 0), 0);
                    
                    // On desktop, always expanded. On mobile, check state.
                    const isExpanded = !isMobile || expandedStages.includes(stage);
                    
                    // Added min-w-0 alongside md:w-0 to guarantee columns shrink below content width if needed
                    return (
                      <div key={stage} className="w-full md:flex-1 md:w-0 min-w-0 flex flex-col min-h-0 h-max md:h-full bg-slate-100/50 rounded-xl border border-slate-200 overflow-hidden">
                        
                        {/* Clickable Header for Mobile Accordion */}
                        <div 
                          onClick={() => toggleStage(stage)}
                          className={`p-3 border-b border-slate-200 bg-slate-50/80 flex justify-between items-center shrink-0 ${isMobile ? "cursor-pointer hover:bg-slate-100" : ""}`}
                        >
                          <div className="flex items-center gap-2">
                            {isMobile && (
                              isExpanded ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />
                            )}
                            <h3 className="font-semibold text-sm text-slate-800">{stage}</h3>
                            <span className="text-[10px] font-bold bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-full">{stageLeads.length}</span>
                          </div>
                          {stageTotal > 0 && <span className="text-xs font-semibold text-emerald-600">${stageTotal.toLocaleString()}</span>}
                        </div>
                        
                        <Droppable droppableId={stage}>
                          {(provided, snapshot) => (
                            <div 
                              ref={provided.innerRef} 
                              {...provided.droppableProps}
                              className={`p-2 overflow-y-auto custom-scrollbar min-h-0 transition-colors ${snapshot.isDraggingOver ? 'bg-blue-50/50' : ''} ${!isExpanded ? 'hidden md:flex flex-col flex-1' : 'flex-1 flex flex-col'}`}
                            >
                              <div className="space-y-2 min-h-[50px] md:min-h-[150px]">
                                {stageLeads.map((lead, index) => (
                                  <Draggable key={lead.id} draggableId={lead.id} index={index}>
                                    {(provided, snapshot) => (
                                      <div
                                        ref={provided.innerRef}
                                        {...provided.draggableProps}
                                        {...provided.dragHandleProps}
                                        style={{ ...provided.draggableProps.style }}
                                        className={snapshot.isDragging ? 'opacity-90 shadow-xl ring-2 ring-blue-400 rounded-lg' : ''}
                                      >
                                        <LeadCard lead={lead} isDraggable={true} />
                                      </div>
                                    )}
                                  </Draggable>
                                ))}
                                {provided.placeholder}
                              </div>
                            </div>
                          )}
                        </Droppable>
                      </div>
                    );
                  })}
                </div>
              </div>
            </DragDropContext>
          ) : (
            /* ⚡ CONDENSED LIST VIEW */
            <Card className="bg-white border-slate-200 shadow-sm overflow-hidden flex-1 flex flex-col">
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                    <tr>
                      <th className="px-4 py-3 font-medium">Lead Details</th>
                      <th className="px-4 py-3 font-medium hidden sm:table-cell">Contact Info</th>
                      <th className="px-4 py-3 font-medium hidden md:table-cell">Est. Value</th>
                      <th className="px-4 py-3 font-medium hidden sm:table-cell">Status & Follow Up</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredLeads.map(lead => (
                      <tr key={lead.id} className="hover:bg-slate-50/50 transition-colors group cursor-pointer" onClick={() => window.location.href = `/LeadDetail?id=${lead.id}`}>
                        <td className="px-4 py-3 align-top">
                          <div className="flex justify-between items-start">
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-slate-900 group-hover:text-blue-600 transition-colors truncate">{lead.contact_name}</p>
                              <p className="text-xs text-slate-500 mb-1 sm:mb-0">{lead.source}</p>
                              
                              <div className="sm:hidden mt-2 space-y-1.5">
                                {lead.contact_email && <div className="flex items-center gap-1.5 text-xs text-slate-600"><Mail className="h-3 w-3 shrink-0" /> <span className="truncate">{lead.contact_email}</span></div>}
                                {lead.contact_phone && <div className="flex items-center gap-1.5 text-xs text-slate-600"><Phone className="h-3 w-3 shrink-0" /> <span>{lead.contact_phone}</span></div>}
                              </div>
                            </div>
                            
                            <div className="sm:hidden shrink-0 ml-3" onClick={e => e.stopPropagation()}>
                              <DropdownMenu>
                                <DropdownMenuTrigger className="focus:outline-none">
                                  <StatusBadge status={lead.pipeline_stage} />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {ALL_PIPELINE_STAGES.map(stage => (
                                    <DropdownMenuItem key={stage} onClick={() => updateStageMutation.mutate({ id: lead.id, pipeline_stage: stage })} className={lead.pipeline_stage === stage ? "font-bold" : ""}>
                                      {stage}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>
                        </td>
                        
                        <td className="px-4 py-3 hidden sm:table-cell space-y-1.5 align-top">
                          {lead.contact_email && <div className="flex items-center gap-1.5 text-xs text-slate-600"><Mail className="h-3 w-3 shrink-0" /> <span className="truncate max-w-[180px] lg:max-w-none">{lead.contact_email}</span></div>}
                          {lead.contact_phone && <div className="flex items-center gap-1.5 text-xs text-slate-600"><Phone className="h-3 w-3 shrink-0" /> {lead.contact_phone}</div>}
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell align-top font-medium text-emerald-600">
                          {lead.value_estimate ? `$${Number(lead.value_estimate).toLocaleString()}` : "—"}
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell align-top">
                          <div className="space-y-1.5">
                            {/* Interactive Status Dropdown */}
                            <div onClick={e => e.stopPropagation()}>
                              <DropdownMenu>
                                <DropdownMenuTrigger className="focus:outline-none hover:opacity-80 transition-opacity">
                                  <StatusBadge status={lead.pipeline_stage} />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start">
                                  {ALL_PIPELINE_STAGES.map(stage => (
                                    <DropdownMenuItem key={stage} onClick={() => updateStageMutation.mutate({ id: lead.id, pipeline_stage: stage })} className={lead.pipeline_stage === stage ? "font-bold bg-slate-50" : ""}>
                                      {stage}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                            <div className="text-xs text-slate-500 font-medium">
                              {lead.next_follow_up_date ? `Follow up: ${format(new Date(lead.next_follow_up_date), "MMM d")}` : "—"}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top text-right w-12">
                          <div onClick={e => e.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-slate-900 focus:outline-none">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openEditModal(lead)}>
                                  <Pencil className="h-4 w-4 mr-2" /> Edit Lead
                                </DropdownMenuItem>
                                <DropdownMenuItem className="text-red-600 focus:bg-red-50 focus:text-red-700" onClick={() => setDeleteConfirmId(lead.id)}>
                                  <Trash2 className="h-4 w-4 mr-2" /> Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredLeads.length === 0 && (
                      <tr><td colSpan="5" className="px-4 py-8 text-center text-slate-500">No leads found matching your criteria.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* FORM DIALOG */}
      <LeadFormDialog 
        open={dialogOpen} 
        onOpenChange={(v) => { setDialogOpen(v); if(!v) setEditingLead(null); }} 
        users={users} 
        lead={editingLead}
        onSave={(data) => saveMutation.mutate(data)} 
      />

      {/* DELETE CONFIRMATION */}
      <Dialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete Lead</DialogTitle></DialogHeader>
          <p className="text-slate-600">Are you sure you want to delete this lead? This action cannot be undone.</p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteMutation.mutate(deleteConfirmId)}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* WON (CONVERT TO CLIENT) CONFIRMATION */}
      <Dialog open={!!wonConfirmLead} onOpenChange={(open) => !open && setWonConfirmLead(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Convert to Client</DialogTitle></DialogHeader>
          <p className="text-slate-600">Are you sure you want to convert <strong>{wonConfirmLead?.contact_name}</strong> to a new Client?</p>
          <p className="text-sm text-slate-500 mt-2">This will instantly move the lead to the "Won" stage, create a client profile, and redirect you to their new page.</p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setWonConfirmLead(null)}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => convertClientMutation.mutate(wonConfirmLead)} disabled={convertClientMutation.isPending}>
              {convertClientMutation.isPending ? "Converting..." : "Convert to Client"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* LOST CONFIRMATION */}
      <Dialog open={!!lostConfirmLead} onOpenChange={(open) => !open && setLostConfirmLead(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Mark Lead as Lost</DialogTitle></DialogHeader>
          <p className="text-slate-600">Are you sure you want to mark <strong>{lostConfirmLead?.contact_name}</strong> as Lost?</p>
          <p className="text-sm text-slate-500 mt-2">This will remove them from the active Kanban board.</p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setLostConfirmLead(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => {
              updateStageMutation.mutate({ id: lostConfirmLead.id, pipeline_stage: "Lost" });
              setLostConfirmLead(null);
            }}>Mark as Lost</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
