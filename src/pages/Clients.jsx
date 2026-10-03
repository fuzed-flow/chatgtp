import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/api/supabaseClient"; 
import { useAuth } from "@/lib/AuthContext"; 
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Phone, Mail, MapPin, Check, X, Save, FolderOpen, Bookmark, Building2, Upload, Search, FileText } from "lucide-react";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import ViewToggle from "../components/shared/ViewToggle";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import PageHeader from "../components/shared/PageHeader";
import DataTable from "../components/shared/DataTable";
import FilterBar from "../components/shared/FilterBar";
import ActionMenu from "../components/shared/ActionMenu";
import ClientFormDialog from "../components/clients/ClientFormDialog";
import DownloadButton from "../components/shared/DownloadButton";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

export default function Clients() {
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  const [view, setView] = useState(() => localStorage.getItem("clientsView") || "list");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [editingInlineId, setEditingInlineId] = useState(null);
  const [inlineEditData, setInlineEditData] = useState({});
  const [filters, setFilters] = useState({});
  const [sortOrder, setSortOrder] = useState("default");
  const [searchQuery, setSearchQuery] = useState(""); // 👈 ADD THIS LINE
  const [saveSegmentOpen, setSaveSegmentOpen] = useState(false);
  const [loadSegmentOpen, setLoadSegmentOpen] = useState(false);
  const [segmentForm, setSegmentForm] = useState({ name: "", description: "", is_shared: false });
  const [activeSegment, setActiveSegment] = useState(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleViewChange = (newView) => {
    setView(newView);
    localStorage.setItem("clientsView", newView);
  };

  // 1. FETCH CLIENTS FROM SUPABASE
  const { data: clients = [] } = useQuery({
    queryKey: ["clients", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // 2. FETCH SEGMENTS FROM SUPABASE
  const { data: segments = [] } = useQuery({
    queryKey: ["client_segments", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_segments")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // 3. MUTATIONS
  const createMutation = useMutation({
    mutationFn: async (data) => {
      const { error } = await supabase.from("clients").insert([{ ...data, company_id: companyId }]);
      if (error) throw error;
    },
    onSuccess: () => { 
      queryClient.invalidateQueries({ queryKey: ["clients", companyId] }); 
      setDialogOpen(false); 
      toast.success("Client added"); 
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const { error } = await supabase.from("clients").update(data).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { 
      queryClient.invalidateQueries({ queryKey: ["clients", companyId] }); 
      setDialogOpen(false); 
      setEditingClient(null); 
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("clients").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { 
      queryClient.invalidateQueries({ queryKey: ["clients", companyId] }); 
      toast.success("Client deleted"); 
    },
  });

  const importMutation = useMutation({
    mutationFn: async (parsedData) => {
      // Maps standard export columns back to DB schema
      const clientsToInsert = parsedData.map(row => ({
        company_id: companyId,
        name: row.Name || row.name,
        type: row.Type || row.type || "Residential",
        primary_contact_name: row["Primary Contact"] || row.primary_contact_name,
        email: row.Email || row.email,
        phone: row.Phone || row.phone,
        site_address: row["Site Address"] || row.site_address,
        billing_address: row["Billing Address"] || row.billing_address,
        notes: row.Notes || row.notes
      }));

      const { error } = await supabase.from("clients").insert(clientsToInsert);
      if (error) throw error;
    },
    onSuccess: () => { 
      queryClient.invalidateQueries({ queryKey: ["clients", companyId] }); 
      toast.success("Clients imported successfully"); 
    },
    onError: (error) => {
      toast.error(`Import failed: ${error.message}`);
    }
  });

  const createSegmentMutation = useMutation({
    mutationFn: async (data) => {
      const { error } = await supabase.from("client_segments").insert([{
        company_id: companyId,
        name: data.name,
        description: data.description,
        filters: data.filters,
        is_shared: data.is_shared,
        created_by: profile?.full_name || "Unknown User"
      }]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client_segments", companyId] });
      setSaveSegmentOpen(false);
      setSegmentForm({ name: "", description: "", is_shared: false });
      toast.success("Segment saved");
    },
  });

  const deleteSegmentMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("client_segments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client_segments", companyId] });
      toast.success("Segment deleted");
    },
  });

  // HANDLERS
  const handleSave = async (data) => {
    if (editingClient) {
      await updateMutation.mutateAsync({ id: editingClient.id, data });
    } else {
      await createMutation.mutateAsync(data);
    }
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.data && results.data.length > 0) {
          importMutation.mutate(results.data);
        } else {
          toast.error("No valid data found in CSV");
        }
        event.target.value = null; // Reset input
      },
      error: (error) => {
        toast.error(`Failed to parse file: ${error.message}`);
      }
    });
  };

  const startInlineEdit = (client) => {
    setEditingInlineId(client.id);
    setInlineEditData({
      name: client.name || "",
      type: client.type || "Residential",
      primary_contact_name: client.primary_contact_name || "",
      email: client.email || "",
      phone: client.phone || ""
    });
  };

  const cancelInlineEdit = () => {
    setEditingInlineId(null);
    setInlineEditData({});
  };

  const saveInlineEdit = async (clientId) => {
    try {
      await updateMutation.mutateAsync({ id: clientId, data: inlineEditData });
      setEditingInlineId(null);
      setInlineEditData({});
      toast.success("Client updated");
    } catch (error) {
      toast.error("Failed to update client");
    }
  };

  const handleSaveSegment = () => {
    if (!segmentForm.name) {
      toast.error("Please enter a segment name");
      return;
    }
    createSegmentMutation.mutate({
      name: segmentForm.name,
      description: segmentForm.description,
      filters: JSON.stringify(filters),
      is_shared: segmentForm.is_shared
    });
  };

  const handleLoadSegment = (segment) => {
    try {
      const parsedFilters = JSON.parse(segment.filters);
      setFilters(parsedFilters);
      setActiveSegment(segment);
      setLoadSegmentOpen(false);
      toast.success(`Loaded "${segment.name}" segment`);
    } catch (error) {
      toast.error("Failed to load segment");
    }
  };

  const handleClearSegment = () => {
    setFilters({});
    setActiveSegment(null);
    toast.success("Cleared filters");
  };

  const filtered = clients.filter(c => {
    if (filters.type && c.type !== filters.type) return false;
    if (filters.location && c.site_address && !c.site_address.toLowerCase().includes(filters.location.toLowerCase())) return false;
    if (filters.tags && c.tags && !c.tags.some(tag => tag.toLowerCase().includes(filters.tags.toLowerCase()))) return false;
    // 👇 NEW: Mobile Search Filter
    if (searchQuery) {
      const lowerQuery = searchQuery.toLowerCase();
      const matchesName = c.name?.toLowerCase().includes(lowerQuery);
      const matchesEmail = c.email?.toLowerCase().includes(lowerQuery);
      const matchesContact = c.primary_contact_name?.toLowerCase().includes(lowerQuery);
      if (!matchesName && !matchesEmail && !matchesContact) return false;
    }
    return true;
  }).sort((a, b) => {
    if (sortOrder === "a-z") return (a.name || "").localeCompare(b.name || "");
    if (sortOrder === "z-a") return (b.name || "").localeCompare(a.name || "");
    return 0; 
  });

  const allColumns = [
    { 
      key: "name", 
      label: "Name", 
      width: isMobile ? "auto" : "180px",
      render: (name, row) => {
        if (editingInlineId === row.id) {
          return (
            <Input 
              value={inlineEditData.name} 
              onChange={(e) => setInlineEditData({...inlineEditData, name: e.target.value})}
              className="h-8"
            />
          );
        }
        if (isMobile) {
          return (
            <div className="flex flex-col py-1 min-w-0 max-w-[200px]">
              <span className="font-medium text-slate-900 truncate block" title={name}>{name}</span>
              <Link to={`/ClientDetail?id=${row.id}`} onClick={(e) => e.stopPropagation()} className="text-xs text-amber-600 hover:text-amber-700 mt-1 inline-block truncate">View Profile</Link>
            </div>
          );
        }
        return name;
      }
    },
    { 
      key: "type", 
      label: "Type", 
      width: "120px", 
      render: (type, row) => {
        if (editingInlineId === row.id) {
          return (
            <Select value={inlineEditData.type} onValueChange={(v) => setInlineEditData({...inlineEditData, type: v})}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Residential">Residential</SelectItem>
                <SelectItem value="Commercial">Commercial</SelectItem>
              </SelectContent>
            </Select>
          );
        }
        return <Badge variant="outline" className="text-[10px]">{type}</Badge>;
      }
    },
    { 
      key: "primary_contact_name", 
      label: "Contact", 
      width: "150px",
      render: (contact, row) => {
        if (editingInlineId === row.id) {
          return (
            <Input 
              value={inlineEditData.primary_contact_name} 
              onChange={(e) => setInlineEditData({...inlineEditData, primary_contact_name: e.target.value})}
              className="h-8"
            />
          );
        }
        return contact || "—";
      }
    },
    { 
      key: "email", 
      label: "Email", 
      width: "180px",
      render: (email, row) => {
        if (editingInlineId === row.id) {
          return (
            <div className="space-y-1">
              <Input 
                type="email"
                value={inlineEditData.email} 
                onChange={(e) => setInlineEditData({...inlineEditData, email: e.target.value})}
                className="h-8"
                placeholder="Email"
              />
              <Input 
                value={inlineEditData.phone} 
                onChange={(e) => setInlineEditData({...inlineEditData, phone: e.target.value})}
                className="h-8"
                placeholder="Phone"
              />
            </div>
          );
        }
        return (
          <div className="text-sm">
            <p className="text-slate-600">{email || "—"}</p>
            {row.phone && <p className="text-xs text-slate-500">{row.phone}</p>}
          </div>
        );
      }
    },
    { 
      key: "site_address", 
      label: "Address", 
      width: "180px",
      render: (addr) => addr ? <p className="text-sm text-slate-600 truncate">{addr}</p> : "—"
    },
  ];

  const columns = isMobile ? [allColumns[0]] : allColumns;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Clients"
        description={activeSegment ? `${filtered.length} clients in "${activeSegment.name}"` : `${clients.length} clients`}
        actions={
          <div className="flex flex-wrap gap-2">
            {/* Hidden file input */}
            <input 
              type="file" 
              accept=".xlsx,.xls,.csv" 
              ref={fileInputRef} 
              className="hidden" 
              onChange={handleFileUpload} 
            />
            
            {/* CSV Template Button */}
<Button 
  variant="outline" 
  className="order-3 sm:order-1" 
  onClick={() => {
    window.open("https://ochqexofahdssmarnict.supabase.co/storage/v1/object/public/csv%20templates/clients-template-fuzed-flow.csv", "_blank");
  }}
>
  <FileText className="h-4 w-4 mr-2" /> 
  <span>CSV Template</span>
</Button>

            {/* 1. Import Button */}
            <Button 
              variant="outline" 
              className="order-1 sm:order-2"
              onClick={() => fileInputRef.current?.click()} 
              disabled={importMutation.isPending}
            >
              <Upload className="h-4 w-4 mr-2" /> 
              <span>{importMutation.isPending ? "Importing..." : "Import"}</span>
            </Button>

            {/* Export Button Wrapper */}
            <div className="order-2 sm:order-3">
              <DownloadButton
                data={filtered}
                filename="clients"
                columns={[
                  { label: "Name", key: "name" },
                  { label: "Type", key: "type" },
                  { label: "Primary Contact", key: "primary_contact_name" },
                  { label: "Email", key: "email" },
                  { label: "Phone", key: "phone" },
                  { label: "Billing Address", key: "billing_address" },
                  { label: "Site Address", key: "site_address" },
                  { label: "Notes", key: "notes" },
                ]}
              />
            </div>

            {/* New Client Button */}
            <Button 
              className="order-4 sm:order-4 bg-slate-900 hover:bg-slate-800"
              onClick={() => { setEditingClient(null); setDialogOpen(true); }} 
            >
              <Plus className="h-4 w-4 sm:mr-2" /> 
              <span className="hidden sm:inline">New Client</span>
            </Button>
          </div>
        }
        />

      {/* Updated Segment Bar: Hides Load/Save on mobile */}
      <div className="mb-4 flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
        <div className="flex flex-wrap gap-2 items-center">
          {activeSegment && (
            <Badge variant="outline" className="px-3 py-1.5 gap-2 border-amber-200 bg-amber-50 text-amber-800">
              <Bookmark className="h-3 w-3" />
              {activeSegment.name}
            </Badge>
          )}
          {/* hidden sm:inline-flex removes these from mobile */}
          <Button variant="outline" size="sm" onClick={() => setLoadSegmentOpen(true)} className="hidden sm:inline-flex">
            <FolderOpen className="h-4 w-4 mr-2" /> 
            <span>Load View</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSaveSegmentOpen(true)} className="hidden sm:inline-flex">
            <Save className="h-4 w-4 mr-2" /> 
            <span>Save View</span>
          </Button>
          {activeSegment && (
            <Button variant="ghost" size="sm" onClick={handleClearSegment}>
              Clear
            </Button>
          )}
        </div>
        {!isMobile && <ViewToggle view={view} onViewChange={handleViewChange} />}
      </div>

      {/* Updated Filter/Sort Bar: Mobile Search vs Desktop Filters */}
      <div className="mb-4 flex flex-col sm:flex-row gap-3 sm:items-start">
        
        {/* Desktop Filter Bar (Hidden on Mobile) */}
        <div className="hidden sm:block w-auto">
          <FilterBar
            filters={[
              { key: "type", label: "Type", type: "select", options: ["Residential", "Commercial"].map(t => ({ label: t, value: t })) },
              { key: "location", label: "Location", type: "text", placeholder: "Search location..." },
              { key: "tags", label: "Tags", type: "text", placeholder: "Search tags..." },
            ]}
            onFiltersChange={setFilters}
          />
        </div>

        {/* Mobile Search Bar (Hidden on Desktop) */}
        <div className="sm:hidden w-full relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input 
            placeholder="Search clients..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 bg-white"
          />
        </div>

        {/* Sort Dropdown - takes full width on mobile, sits on the right on desktop */}
        <div className="w-full sm:w-auto">
          <Select value={sortOrder} onValueChange={setSortOrder}>
            <SelectTrigger className="w-full sm:w-[180px] bg-white">
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

      {view === "list" && !isMobile ? (
        <DataTable
          columns={columns}
          data={filtered}
          searchableFields={["name", "email", "primary_contact_name"]}
          emptyMessage="No clients yet"
          onRowClick={(client) => { if (editingInlineId === client.id) return; navigate(`/ClientDetail?id=${client.id}`); }}
          actions={(client) => {
          if (editingInlineId === client.id) {
            return (
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" onClick={() => saveInlineEdit(client.id)}>
                  <Check className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-red-600" onClick={cancelInlineEdit}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            );
          }
          return (
            <ActionMenu
              actions={[
                { label: "View", onClick: () => navigate(`/ClientDetail?id=${client.id}`) },
                { label: "Quick Edit", icon: Pencil, onClick: () => startInlineEdit(client) },
                { label: "Full Edit", icon: Pencil, onClick: () => { setEditingClient(client); setDialogOpen(true); } },
                { label: "Delete", icon: Trash2, destructive: true, onClick: () => deleteMutation.mutate(client.id) },
              ]}
            />
          );
        }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(client => {
            const isEditing = editingInlineId === client.id;
            
            return (
              <Card 
                key={client.id} 
                className={`transition-all ${!isEditing ? "cursor-pointer hover:shadow-lg" : "border-amber-400 shadow-md"}`}
                onClick={() => { if (!isEditing) navigate(`/ClientDetail?id=${client.id}`); }}
              >
                {isEditing ? (
                  <div className="p-5 space-y-3 bg-amber-50/30 rounded-xl">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-amber-600 uppercase tracking-wider">Quick Edit</span>
                    </div>
                    <Input value={inlineEditData.name} onChange={(e) => setInlineEditData({...inlineEditData, name: e.target.value})} placeholder="Company / Client Name" className="bg-white font-medium" />
                    <Select value={inlineEditData.type} onValueChange={(v) => setInlineEditData({...inlineEditData, type: v})}>
                      <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Residential">Residential</SelectItem>
                        <SelectItem value="Commercial">Commercial</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input value={inlineEditData.primary_contact_name} onChange={(e) => setInlineEditData({...inlineEditData, primary_contact_name: e.target.value})} placeholder="Contact Name" className="bg-white" />
                    <Input type="email" value={inlineEditData.email} onChange={(e) => setInlineEditData({...inlineEditData, email: e.target.value})} placeholder="Email" className="bg-white" />
                    <Input value={inlineEditData.phone} onChange={(e) => setInlineEditData({...inlineEditData, phone: e.target.value})} placeholder="Phone Number" className="bg-white" />
                    
                    <div className="flex justify-end gap-2 pt-2 border-t border-amber-200/50 mt-2">
                      <Button size="sm" variant="ghost" className="text-slate-500 hover:text-slate-700" onClick={(e) => { e.stopPropagation(); cancelInlineEdit(); }}>
                        <X className="h-4 w-4 mr-1" /> Cancel
                      </Button>
                      <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={(e) => { e.stopPropagation(); saveInlineEdit(client.id); }}>
                        <Check className="h-4 w-4 mr-1" /> Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <h3 className="font-semibold text-lg text-slate-900 mb-1">{client.name}</h3>
                        <Badge variant="outline" className="text-xs">{client.type}</Badge>
                      </div>
                      <ActionMenu
                        actions={[
                          { label: "View", onClick: (e) => { e.stopPropagation(); navigate(`/ClientDetail?id=${client.id}`); } },
                          { label: "Quick Edit", icon: Pencil, onClick: (e) => { e.stopPropagation(); startInlineEdit(client); } },
                          { label: "Full Edit", icon: Pencil, onClick: (e) => { e.stopPropagation(); setEditingClient(client); setDialogOpen(true); } },
                          { label: "Delete", icon: Trash2, destructive: true, onClick: (e) => { e.stopPropagation(); deleteMutation.mutate(client.id); } },
                        ]}
                      />
                    </div>
                    <div className="space-y-2">
                      {client.primary_contact_name && (
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                          <Building2 className="h-4 w-4 shrink-0" />
                          <span className="truncate">{client.primary_contact_name}</span>
                        </div>
                      )}
                      {client.email && (
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                          <Mail className="h-4 w-4 shrink-0" />
                          <span className="truncate">{client.email}</span>
                        </div>
                      )}
                      {client.phone && (
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                          <Phone className="h-4 w-4 shrink-0" />
                          <span className="truncate">{client.phone}</span>
                        </div>
                      )}
                      {client.site_address && (
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                          <MapPin className="h-4 w-4 shrink-0" />
                          <span className="truncate">{client.site_address}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <ClientFormDialog
        open={dialogOpen}
        onOpenChange={(v) => { setDialogOpen(v); if (!v) setEditingClient(null); }}
        client={editingClient}
        onSave={handleSave}
      />

      <Dialog open={saveSegmentOpen} onOpenChange={setSaveSegmentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Client Segment</DialogTitle>
            <DialogDescription>Save the current filters as a reusable segment</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Segment Name *</Label>
              <Input 
                value={segmentForm.name} 
                onChange={(e) => setSegmentForm({...segmentForm, name: e.target.value})}
                placeholder="e.g., Calgary Commercial Clients"
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea 
                value={segmentForm.description} 
                onChange={(e) => setSegmentForm({...segmentForm, description: e.target.value})}
                placeholder="Optional description..."
                rows={3}
              />
            </div>
            <div className="flex items-center gap-2">
              <input 
                type="checkbox" 
                id="shareSegment"
                checked={segmentForm.is_shared}
                onChange={(e) => setSegmentForm({...segmentForm, is_shared: e.target.checked})}
                className="rounded"
              />
              <Label htmlFor="shareSegment" className="cursor-pointer font-normal">
                Share with all team members
              </Label>
            </div>
            <div className="bg-slate-50 p-3 rounded-lg">
              <p className="text-xs font-medium text-slate-600 mb-1">Current Filters:</p>
              <p className="text-sm text-slate-700">{JSON.stringify(filters, null, 2) || "No filters applied"}</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSaveSegmentOpen(false)}>Cancel</Button>
              <Button onClick={handleSaveSegment} className="bg-slate-900 hover:bg-slate-800" disabled={createSegmentMutation.isPending}>
                <Save className="h-4 w-4 mr-2" /> {createSegmentMutation.isPending ? "Saving..." : "Save Segment"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={loadSegmentOpen} onOpenChange={setLoadSegmentOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Load Client Segment</DialogTitle>
            <DialogDescription>Select a saved segment to apply its filters</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {segments.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-8">No saved segments yet</p>
            ) : (
              segments.map(segment => (
                <div key={segment.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-slate-50">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium text-slate-900">{segment.name}</h4>
                      {segment.is_shared && (
                        <Badge variant="outline" className="text-xs">Shared</Badge>
                      )}
                    </div>
                    {segment.description && (
                      <p className="text-sm text-slate-600 mt-1">{segment.description}</p>
                    )}
                    <p className="text-xs text-slate-500 mt-1">Created by {segment.created_by}</p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => handleLoadSegment(segment)}>
                      Load
                    </Button>
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      onClick={() => deleteSegmentMutation.mutate(segment.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}