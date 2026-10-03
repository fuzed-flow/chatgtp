import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Plus, Building2, Edit, Trash2, Star, Upload, FileUp, X, Send, Search, MoreVertical, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator  } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import ViewToggle from "../components/shared/ViewToggle";
import PageHeader from "../components/shared/PageHeader";
import DataTable from "../components/shared/DataTable";
import FilterBar from "../components/shared/FilterBar";
import ActionMenu from "../components/shared/ActionMenu";
import DownloadButton from "../components/shared/DownloadButton";
import VendorRequestDialog from "../components/vendors/VendorRequestDialog";
import { toast } from "sonner";
import { createPageUrl } from "../utils";
import { Link } from "react-router-dom";
import Papa from "papaparse";

const CATEGORIES = ["Cabinets", "Deck Builder", "Drywall", "Electrical", "Fence/Deck", "Flooring", "Framing", "General", "Glass & Mirrors", "HVAC", "Painting", "Plumbing", "Roofing", "Stone Work", "Tile Work", "Other"];

export default function Vendors() {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState({});
  const [sortOrder, setSortOrder] = useState("default");
  const [view, setView] = useState(() => localStorage.getItem("vendorsView") || "list");
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", contact_name: "", email: "", phone: "", address: "", notes: "", category: "Other", preferred: false, rating: 0, projects_worked_on: [], invoice_urls: [] });
  
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [requestVendor, setRequestVendor] = useState(null);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleViewChange = (newView) => {
    setView(newView);
    localStorage.setItem("vendorsView", newView);
  };

  // Check if user has proper management role
  const hasAccess = !!profile && ["admin", "office_admin", "project_manager"].includes(profile.role);

  // --- SUPABASE QUERIES ---
  const { data: vendors = [] } = useQuery({ 
    queryKey: ["vendors", companyId], 
    enabled: hasAccess && !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("vendors").select("*").eq("company_id", companyId).order("created_date", { ascending: false });
      if (error) throw error;
      return data || [];
    }, 
  });

  const { data: projects = [] } = useQuery({ 
    queryKey: ["projects", companyId], 
    enabled: hasAccess && !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("*").eq("company_id", companyId);
      if (error) throw error;
      return data || [];
    },
  });

  // --- SUPABASE MUTATIONS ---
  const createMutation = useMutation({
    mutationFn: async (data) => {
      const { error } = await supabase.from("vendors").insert([{ ...data, company_id: companyId }]);
      if (error) throw error;
    },
    onSuccess: () => { 
      queryClient.invalidateQueries({ queryKey: ["vendors", companyId] }); 
      setDialogOpen(false); 
      toast.success("Subcontractor created successfully");
    },
    onError: () => toast.error("Failed to create subcontractor")
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const { error } = await supabase.from("vendors").update(data).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { 
      queryClient.invalidateQueries({ queryKey: ["vendors", companyId] }); 
      setDialogOpen(false); 
      setEditing(null); 
      toast.success("Subcontractor updated");
    },
    onError: () => toast.error("Failed to update subcontractor")
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("vendors").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendors", companyId] });
      toast.success("Subcontractor deleted");
    },
    onError: () => toast.error("Failed to delete subcontractor")
  });

  if (profile && !hasAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center">
          <ShieldAlert className="h-12 w-12 text-slate-300 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Access Denied</h1>
          <p className="text-slate-600">Only admin and manager roles can access the global Subcontractor directory.</p>
        </div>
      </div>
    );
  }

  const handleSave = async (e) => {
    e.preventDefault();
    if (editing) {
      await updateMutation.mutateAsync({ id: editing.id, data: form });
    } else {
      await createMutation.mutateAsync(form);
    }
  };

  const openNew = () => {
    setEditing(null);
    setForm({ name: "", contact_name: "", email: "", phone: "", address: "", notes: "", category: "Other", preferred: false, rating: 0, projects_worked_on: [], invoice_urls: [] });
    setDialogOpen(true);
  };

  const openEdit = (vendor) => {
    setEditing(vendor);
    setForm({ 
      name: vendor.name || "", 
      contact_name: vendor.contact_name || "", 
      email: vendor.email || "", 
      phone: vendor.phone || "", 
      address: vendor.address || "", 
      notes: vendor.notes || "", 
      category: vendor.category || "Other", 
      preferred: vendor.preferred || false,
      rating: vendor.rating || 0,
      projects_worked_on: vendor.projects_worked_on || [],
      invoice_urls: vendor.invoice_urls || []
    });
    setDialogOpen(true);
  };

  const openRequest = (vendor = null) => {
    setRequestVendor(vendor);
    setRequestDialogOpen(true);
  };

  const handleFileImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          if (results.data && results.data.length > 0) {
            const vendorsToInsert = results.data.map(sub => {
              const rawName = sub["Name"] || sub.name || "";
              const rawCategory = sub["Category"] || sub.category || "";
              
              return {
                company_id: companyId,
                name: rawName.trim(),
                contact_name: (sub["Contact Name"] || sub.contact_name)?.trim() || null,
                email: (sub["Email"] || sub.email)?.trim() || null,
                phone: (sub["Phone"] || sub.phone)?.trim() || null,
                address: (sub["Address"] || sub.address)?.trim() || null,
                category: CATEGORIES.includes(rawCategory) ? rawCategory : "Other",
                notes: (sub["Notes"] || sub.notes)?.trim() || null,
                rating: parseInt(sub["Rating"] || sub.rating, 10) || 0,
                preferred: String(sub["Preferred"] || sub.preferred).toLowerCase() === 'true' || String(sub["Preferred"] || sub.preferred).toLowerCase() === 'yes',
              };
            }).filter(v => v.name !== "");

            if (vendorsToInsert.length === 0) {
              toast.error("No valid vendors found. Ensure your CSV has a 'Name' column.");
              setImporting(false);
              return;
            }

            const { error } = await supabase.from("vendors").insert(vendorsToInsert);
            if (error) throw error;

            queryClient.invalidateQueries({ queryKey: ["vendors", companyId] });
            toast.success(`Successfully imported ${vendorsToInsert.length} subcontractors!`);
            setImportDialogOpen(false);
          } else {
            toast.error("No valid data found in CSV");
          }
        } catch (error) {
          console.error("Import error:", error);
          toast.error(`Import failed: ${error.message}`);
        } finally {
          setImporting(false);
          e.target.value = ""; 
        }
      },
      error: (error) => {
        toast.error(`Failed to parse file: ${error.message}`);
        setImporting(false);
        e.target.value = "";
      }
    });
  };

  const handleInvoiceUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    toast.loading("Uploading documents...");
    const uploadedUrls = [];
    
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const cleanFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '');
        const fileName = `${companyId}/${Date.now()}_${cleanFileName}`;
        
        const { error } = await supabase.storage.from("vendor").upload(fileName, file);
        if (error) throw error;

        const { data: { publicUrl } } = supabase.storage.from("vendor").getPublicUrl(fileName);
        uploadedUrls.push(publicUrl);
      }
      
      setForm({ ...form, invoice_urls: [...form.invoice_urls, ...uploadedUrls] });
      toast.dismiss();
      toast.success("Documents uploaded successfully");
    } catch (err) {
      toast.dismiss();
      toast.error(`Failed to upload documents: ${err.message}`);
    } finally {
        e.target.value = "";
    }
  };

  const removeInvoice = (index) => {
    setForm({ ...form, invoice_urls: form.invoice_urls.filter((_, i) => i !== index) });
  };

  // --- FILTERING ---
  const filtered = vendors.filter(v => {
    if (filters.category && v.category !== filters.category) return false;
    if (filters.preferred === "true" && !v.preferred) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchesSearch = 
        (v.name || "").toLowerCase().includes(q) ||
        (v.contact_name || "").toLowerCase().includes(q) ||
        (v.email || "").toLowerCase().includes(q) ||
        (v.phone || "").toLowerCase().includes(q);
      if (!matchesSearch) return false;
    }
    return true;
  }).sort((a, b) => {
    if (sortOrder === "a-z") return (a.name || "").localeCompare(b.name || "");
    if (sortOrder === "z-a") return (b.name || "").localeCompare(a.name || "");
    return 0; 
  });

  const togglePreferred = async (vendor) => {
    try {
      await updateMutation.mutateAsync({
        id: vendor.id,
        data: { preferred: !vendor.preferred }
      });
    } catch (error) {
      console.error("Failed to toggle preferred status", error);
    }
  };

  const columns = [
    { 
      key: "name", 
      label: "Subcontractor Name", 
      width: "200px",
      render: (name) => <span className="font-medium text-slate-700">{name}</span>
    },
    { key: "category", label: "Category", width: "120px", render: (cat) => <Badge variant="outline">{cat}</Badge> },
    { 
      key: "rating", 
      label: "Rating", 
      width: "120px", 
      render: (rating) => (
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <Star key={star} className={`h-3 w-3 ${star <= (rating || 0) ? "fill-amber-400 text-amber-400" : "text-slate-200"}`} />
          ))}
        </div>
      )
    },
    { 
      key: "preferred", 
      label: "Preferred", 
      width: "100px", 
      render: (preferred, vendor) => (
        <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={preferred || false}
            onChange={() => togglePreferred(vendor)}
            className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
          />
        </div>
      )
    },
    { key: "contact_name", label: "Contact", width: "150px", render: (name) => name || "—" },
    { key: "email", label: "Email", width: "180px", render: (email) => email || "—" },
    { 
      key: "projects_worked_on", 
      label: "Projects", 
      width: "100px", 
      render: (projects) => <span className="text-slate-600 font-medium">{projects?.length || 0}</span> 
    },
  ];

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-slate-500 font-medium animate-pulse">Loading directory...</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      
      <PageHeader 
        title="Subcontractors Directory" 
        description={`${vendors.length} subcontractors & suppliers`} 
        actions={
          <>
            {/* DESKTOP ACTIONS */}
            <div className="hidden md:flex gap-2">
              <Button onClick={() => openRequest(null)} className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold shadow-sm">
                <Send className="h-4 w-4 mr-2" /> Send Request
              </Button>
              <Button onClick={() => setImportDialogOpen(true)} variant="outline" className="border-slate-300">
                <Upload className="h-4 w-4 mr-2" /> Import Excel
              </Button>
              <DownloadButton
                data={vendors}
                filename="subcontractors"
                columns={[
                  { label: "Name", key: "name" },
                  { label: "Category", key: "category" },
                  { label: "Rating", key: "rating" },
                  { label: "Contact Name", key: "contact_name" },
                  { label: "Email", key: "email" },
                  { label: "Phone", key: "phone" },
                  { label: "Address", key: "address" },
                  { label: "Preferred", key: "preferred" },
                ]}
              />
              <Button onClick={openNew} className="bg-slate-900 hover:bg-slate-800 text-white font-bold shadow-sm">
                <Plus className="h-4 w-4 mr-2" /> New Subcontractor
              </Button>
            </div>

            {/* MOBILE ACTIONS */}
<div className="md:hidden flex items-center">
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button size="sm" className="bg-slate-900 text-white font-bold shadow-sm">
        <MoreVertical className="h-4 w-4 mr-1" /> Actions
      </Button>
    </DropdownMenuTrigger>
    
    <DropdownMenuContent 
      align="start" 
      sideOffset={8} 
      collisionPadding={16} 
      className="w-56 font-medium"
    >
      <DropdownMenuItem onClick={() => openRequest(null)} className="cursor-pointer font-bold text-amber-600">
        <Send className="h-4 w-4 mr-2" /> Send Request
      </DropdownMenuItem>
      
      <DropdownMenuItem onClick={openNew} className="cursor-pointer font-bold">
        <Plus className="h-4 w-4 mr-2 text-slate-500" /> New Subcontractor
      </DropdownMenuItem>
      
      <DropdownMenuSeparator />
      
      <DropdownMenuItem onClick={() => setImportDialogOpen(true)} className="cursor-pointer font-bold">
        <Upload className="h-4 w-4 mr-2 text-slate-500" /> Import Excel
      </DropdownMenuItem>

      {/* Export button flattened to match the other plain-text menu items */}
      <DropdownMenuItem asChild className="cursor-pointer font-bold">
        <div className="w-full [&_button]:w-full [&_button]:justify-start [&_button]:gap-4 [&_button]:border-none [&_button]:bg-transparent [&_button]:shadow-none [&_button]:!p-0 [&_button]:h-auto [&_button]:font-bold hover:[&_button]:bg-transparent [&_button_svg]:h-4 [&_button_svg]:w-4 [&_button_svg]:text-slate-500 [&_button_svg]:!m-0">
          <DownloadButton
            data={vendors}
            filename="subcontractors"
            columns={[
              { label: "Name", key: "name" },
              { label: "Category", key: "category" },
              { label: "Rating", key: "rating" },
              { label: "Contact Name", key: "contact_name" },
              { label: "Email", key: "email" },
              { label: "Phone", key: "phone" },
              { label: "Address", key: "address" },
              { label: "Preferred", key: "preferred" },
            ]}
          />
        </div>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</div>
          </>
        }
      />

      {/* FILTER & SEARCH BAR */}
      <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-3 items-center justify-between">
        
        {/* MOBILE & DESKTOP SEARCH BAR */}
        <div className="relative w-full md:flex-1 md:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input 
            placeholder="Search name, contact, or email..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-slate-50 border-slate-200 focus:bg-white transition-colors h-10 w-full" 
          />
        </div>

        <div className="flex flex-wrap items-center justify-between w-full md:w-auto gap-2">
          <FilterBar
            filters={[
              { key: "category", label: "Category", type: "select", options: CATEGORIES.map(c => ({ label: c, value: c })) },
              { key: "preferred", label: "Preferred Only", type: "select", options: [{ label: "Yes", value: "true" }] },
            ]}
            onFiltersChange={setFilters}
          />
          <Select value={sortOrder} onValueChange={setSortOrder}>
            <SelectTrigger className="w-[130px] sm:w-[150px] bg-slate-50 border-slate-200">
              <SelectValue placeholder="Sort by..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Newest First</SelectItem>
              <SelectItem value="a-z">A-Z</SelectItem>
              <SelectItem value="z-a">Z-A</SelectItem>
            </SelectContent>
          </Select>
          {!isMobile && <ViewToggle view={view} onViewChange={handleViewChange} />}
        </div>
      </div>

      {/* VIEW RENDERER */}
      {view === "list" && !isMobile ? (
        <Card className="shadow-sm border-slate-200">
          <DataTable
            columns={columns}
            data={filtered}
            searchableFields={[]} // Relying on our custom global search above
            emptyMessage="No subcontractors found matching your criteria."
            actions={(vendor) => (
              <ActionMenu
                actions={[
                  { label: "Send Request", icon: Send, onClick: () => openRequest(vendor) },
                  { label: "Edit", icon: Edit, onClick: () => openEdit(vendor) },
                  { label: "Delete", icon: Trash2, destructive: true, onClick: () => {
                    if (window.confirm("Are you sure you want to delete this subcontractor?")) deleteMutation.mutate(vendor.id);
                  }},
                ]}
              />
            )}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.length === 0 && (
            <div className="col-span-full py-12 text-center text-slate-500 bg-white rounded-xl border border-dashed border-slate-200 shadow-sm">
              <Building2 className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <p className="font-medium">No subcontractors found matching your criteria</p>
            </div>
          )}
          {filtered.map(vendor => (
            <Card key={vendor.id} className="p-5 shadow-sm border-slate-200 hover:border-amber-300 transition-colors bg-white">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0 pr-2">
                  <h3 className="font-bold text-lg text-slate-900 mb-1 leading-tight truncate">{vendor.name}</h3>
                  <Badge variant="outline" className="mb-2 bg-slate-50 text-slate-600">{vendor.category}</Badge>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star key={star} className={`h-3 w-3 ${star <= (vendor.rating || 0) ? "fill-amber-400 text-amber-400" : "text-slate-200"}`} />
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={vendor.preferred || false}
                      onChange={() => togglePreferred(vendor)}
                      className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                      title="Mark as Preferred"
                    />
                  </div>
                  <ActionMenu
                    actions={[
                      { label: "Send Request", icon: Send, onClick: () => openRequest(vendor) },
                      { label: "Edit", icon: Edit, onClick: () => openEdit(vendor) },
                      { label: "Delete", icon: Trash2, destructive: true, onClick: () => {
                        if (window.confirm("Delete this subcontractor?")) deleteMutation.mutate(vendor.id);
                      }},
                    ]}
                  />
                </div>
              </div>
              <div className="space-y-2 mt-4 pt-4 border-t border-slate-100 text-sm">
                <div className="flex justify-between items-center gap-2">
                  <span className="text-slate-500 text-xs uppercase tracking-wider font-bold shrink-0">Contact</span>
                  <span className="text-slate-900 font-medium truncate">{vendor.contact_name || "—"}</span>
                </div>
                <div className="flex justify-between items-center gap-2">
                  <span className="text-slate-500 text-xs uppercase tracking-wider font-bold shrink-0">Email</span>
                  <span className="text-slate-900 font-medium truncate">{vendor.email || "—"}</span>
                </div>
                <div className="flex justify-between items-center gap-2">
                  <span className="text-slate-500 text-xs uppercase tracking-wider font-bold shrink-0">Phone</span>
                  <span className="text-slate-900 font-medium truncate">{vendor.phone || "—"}</span>
                </div>
                <div className="flex justify-between items-center pt-2">
                  <span className="text-slate-500 text-xs uppercase tracking-wider font-bold shrink-0">Projects Linked</span>
                  <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full font-bold text-xs">{vendor.projects_worked_on?.length || 0}</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* CREATE / EDIT DIALOG */}
      <Dialog open={dialogOpen} onOpenChange={(v) => { setDialogOpen(v); if (!v) setEditing(null); }}>
        <DialogContent aria-describedby={undefined} className="max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-50">
          <DialogHeader><DialogTitle className="text-xl font-black">{editing ? "Edit Subcontractor" : "New Subcontractor"}</DialogTitle></DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 pt-2">
            <div><Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Subcontractor / Company Name *</Label><Input className="mt-1 bg-white font-bold" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required /></div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Contact Name</Label><Input className="mt-1 bg-white" value={form.contact_name} onChange={e => setForm({...form, contact_name: e.target.value})} /></div>
              <div><Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Trade / Category</Label>
                <Select value={form.category} onValueChange={v => setForm({...form, category: v})}>
                  <SelectTrigger className="mt-1 bg-white font-medium"><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Email</Label><Input type="email" className="mt-1 bg-white" value={form.email} onChange={e => setForm({...form, email: e.target.value})} /></div>
              <div><Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Phone</Label><Input className="mt-1 bg-white" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} /></div>
            </div>

            <div><Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Physical Address</Label><Input className="mt-1 bg-white" value={form.address} onChange={e => setForm({...form, address: e.target.value})} /></div>

            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Internal Rating (1-5)</Label>
              <div className="flex items-center gap-2 mt-1 bg-white p-3 rounded-lg border border-slate-200 inline-flex shadow-sm">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setForm({...form, rating: star})}
                    className="focus:outline-none hover:scale-110 transition-transform"
                  >
                    <Star className={`h-6 w-6 ${star <= (form.rating || 0) ? "fill-amber-400 text-amber-400" : "text-slate-200"}`} />
                  </button>
                ))}
                <span className="text-sm font-bold text-slate-600 ml-2">{form.rating || 0}/5</span>
              </div>
            </div>

            <div className="pt-2">
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Projects Worked On</Label>
              <Select 
                value="none" 
                onValueChange={(v) => {
                  if (v !== "none" && !form.projects_worked_on.includes(v)) {
                    setForm({...form, projects_worked_on: [...form.projects_worked_on, v]});
                  }
                }}
              >
                <SelectTrigger className="mt-1 bg-white font-medium"><SelectValue placeholder="Tag a past project..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Select a project —</SelectItem>
                  {projects.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name || p.project_number}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.projects_worked_on.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3 bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                  {form.projects_worked_on.map(projectId => {
                    const project = projects.find(p => p.id === projectId);
                    return (
                      <Badge key={projectId} variant="outline" className="flex items-center gap-1.5 bg-slate-50 py-1 border-slate-200">
                        <Link to={createPageUrl(`ProjectDetail?id=${projectId}`)} className="hover:text-blue-600">
                          {project?.name || project?.project_number || "Unknown Project"}
                        </Link>
                        <X 
                          className="h-3.5 w-3.5 cursor-pointer text-slate-400 hover:text-red-500" 
                          onClick={() => setForm({...form, projects_worked_on: form.projects_worked_on.filter(id => id !== projectId)})}
                        />
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="pt-2">
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Invoices & Files from Subcontractor</Label>
              <div className="mt-2">
                <label className="cursor-pointer inline-block w-full sm:w-auto">
                  <input 
                    type="file" 
                    multiple 
                    accept=".pdf,.png,.jpg,.jpeg"
                    onChange={handleInvoiceUpload}
                    className="hidden"
                  />
                  <div className="flex items-center justify-center sm:justify-start gap-2 px-4 py-2 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 transition-colors shadow-sm text-slate-700 font-bold">
                    <FileUp className="h-4 w-4 text-slate-500" />
                    <span className="text-sm">Upload File</span>
                  </div>
                </label>
              </div>
              {form.invoice_urls.length > 0 && (
                <div className="mt-3 space-y-1.5 bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                  {form.invoice_urls.map((url, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 bg-slate-50 rounded border border-slate-200 text-sm">
                      <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-600 font-bold hover:underline truncate flex-1">
                        Attached Document {idx + 1}
                      </a>
                      <X className="h-4 w-4 cursor-pointer text-slate-400 hover:text-red-500 ml-3 shrink-0" onClick={() => removeInvoice(idx)} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div><Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Internal Notes</Label><Textarea className="mt-1 bg-white" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} rows={3} placeholder="Quality of work, payment terms, unreliability issues..." /></div>
            
            <label className="flex items-center gap-3 text-sm font-bold text-slate-700 bg-amber-50 border border-amber-200 p-4 rounded-xl cursor-pointer shadow-sm">
              <input type="checkbox" checked={form.preferred} onChange={e => setForm({...form, preferred: e.target.checked})} className="rounded h-5 w-5 text-amber-500 focus:ring-amber-500 border-slate-300" /> 
              Mark as Preferred Subcontractor
            </label>

            <div className="flex flex-col sm:flex-row justify-end gap-2 pt-4 border-t border-slate-200 mt-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} className="font-bold order-2 sm:order-1">Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold shadow-md order-1 sm:order-2">
                {editing ? "Save Changes" : "Create Subcontractor"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* IMPORT DIALOG */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent aria-describedby={undefined} className="bg-slate-50">
          <DialogHeader><DialogTitle className="font-black text-xl">Import Subcontractors</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-sm text-slate-600 font-medium">
              Upload an Excel file (or CSV). Automatically read the columns and extract the data into your Subcontractor Directory.
            </p>
            <div className="bg-white p-3 rounded-lg text-xs font-medium text-slate-500 border border-slate-200 shadow-sm">
              <strong className="text-slate-800">Ideal columns:</strong> Name, Contact Name, Email, Phone, Address, Category, Notes, Rating
            </div>
            <div>
              <label className="cursor-pointer">
                <input 
                  type="file" 
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileImport}
                  disabled={importing}
                  className="hidden"
                />
                <div className={`flex flex-col items-center justify-center gap-3 px-4 py-10 border-2 border-dashed rounded-xl transition-colors shadow-sm ${importing ? 'bg-slate-100 border-slate-300' : 'bg-white border-amber-200 hover:border-amber-400 hover:bg-amber-50'}`}>
                  <Upload className={`h-8 w-8 ${importing ? 'text-slate-400 animate-bounce' : 'text-amber-500'}`} />
                  <span className="text-sm font-bold text-slate-700">
                    {importing ? "AI is reading your spreadsheet..." : "Click to upload Excel / CSV"}
                  </span>
                </div>
              </label>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* VENDOR REQUEST DIALOG */}
      <VendorRequestDialog 
        open={requestDialogOpen} 
        onOpenChange={setRequestDialogOpen} 
        initialVendor={requestVendor} 
      />
    </div>
  );
}