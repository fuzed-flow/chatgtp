import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Plus, Package, Edit2, Trash2, ShoppingCart, CheckCircle, Clock, Search, Filter, TrendingUp, DownloadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import ActionMenu from "../shared/ActionMenu";

export default function PMMaterialsTab({ projectId }) {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const queryClient = useQueryClient();

  const [dialogOpen, setDialog] = useState(false);
  const [editingId, setEditingId] = useState(null);
  
  // --- FILTERS & SEARCH ---
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [form, setForm] = useState({
    custom_material_name: "",
    notes: "",
    phase_id: "none",
    quantity: 1,
    unit: "ea",
    cost_estimated: 0,
    supplier: "",
    status: "To Order",
    photo_url: ""
  });

  // --- QUERIES ---
  const { data: materials = [], isLoading } = useQuery({
    queryKey: ["project_materials", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_materials")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    }
  });

  const { data: phases = [] } = useQuery({
    queryKey: ["project_phases", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_phases")
        .select("id, name, phase_order")
        .eq("project_id", projectId)
        .order("phase_order", { ascending: true });
      if (error) throw error;
      return data || [];
    }
  });

  // --- MUTATIONS ---
  const saveMaterialMutation = useMutation({
    mutationFn: async (materialData) => {
      const payload = {
        ...materialData,
        company_id: companyId,
        project_id: projectId,
        phase_id: materialData.phase_id === "none" ? null : materialData.phase_id,
      };

      if (editingId) {
        const { error } = await supabase.from("project_materials").update(payload).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("project_materials").insert([payload]);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project_materials", projectId] });
      setDialog(false);
      resetForm();
      toast.success(editingId ? "Material updated!" : "Material added!");
    },
    onError: (err) => toast.error(`Failed to save: ${err.message}`)
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("project_materials").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project_materials", projectId] });
      toast.success("Material removed.");
    }
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }) => {
      const { error } = await supabase.from("project_materials").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project_materials", projectId] });
      toast.success("Status updated!");
    }
  });

  // ⚡ UPGRADED: Imports Description/SKU, Photo, and maps Phase automatically
  const importMaterialsMutation = useMutation({
    mutationFn: async () => {
      const { data: project, error: projErr } = await supabase.from("projects").select("quote_id").eq("id", projectId).single();
      if (projErr) throw projErr;
      if (!project || !project.quote_id) throw new Error("No quote attached to this project.");

      const quoteId = project.quote_id;

      const { data: items, error: itemsErr } = await supabase.from("quote_line_items").select("*").eq("quote_id", quoteId).eq("is_material", true); 
      if (itemsErr) throw itemsErr;
      if (!items || items.length === 0) throw new Error("No items flagged as materials found in the quote.");

      const { data: quotePhases } = await supabase.from("quote_phases").select("id, phase_name").eq("quote_id", quoteId);

      const existingNames = new Set(materials.map(m => m.custom_material_name));
      const materialsToInsert = [];
      let skipped = 0;

      items.forEach((item) => {
        const matName = item.name || "Tracked Material";
        
        if (existingNames.has(matName)) {
          skipped++;
        } else {
          const hasSeparateMaterialCost = Number(item.material_cost || 0) > 0;
          const finalEstimatedCost = hasSeparateMaterialCost ? Number(item.material_cost) : Number(item.unit_cost || 0);

          let matchedPhaseId = null;
          if (item.phase_id && quotePhases) {
            const qPhase = quotePhases.find(qp => qp.id === item.phase_id);
            if (qPhase) {
              const pPhase = phases.find(pp => pp.name === qPhase.phase_name);
              if (pPhase) matchedPhaseId = pPhase.id;
            }
          }

          materialsToInsert.push({
            company_id: companyId,
            project_id: projectId,
            phase_id: matchedPhaseId,
            custom_material_name: matName,
            notes: item.description || "", 
            quantity: item.quantity || 1,
            unit: item.unit || "ea",
            cost_estimated: finalEstimatedCost,
            status: "To Order",
            supplier: item.supplier || null,
            photo_url: item.photo_url || null,
            product_id: item.product_id || null
          });
        }
      });

      if (materialsToInsert.length > 0) {
        const { error: insertErr } = await supabase.from("project_materials").insert(materialsToInsert);
        if (insertErr) throw insertErr;
      }

      return { imported: materialsToInsert.length, skipped };
    },
    onSuccess: ({ imported, skipped }) => {
      queryClient.invalidateQueries({ queryKey: ["project_materials", projectId] });
      if (imported === 0 && skipped > 0) {
        toast.info(`All ${skipped} materials are already imported!`);
      } else {
        toast.success(`Imported ${imported} materials! ${skipped > 0 ? `(${skipped} duplicates skipped)` : ""}`);
      }
    },
    onError: (err) => {
      toast.error(err.message);
    }
  });

  // --- HANDLERS ---
  const resetForm = () => {
    setEditingId(null);
    setForm({ 
      custom_material_name: "", notes: "", phase_id: "none", quantity: 1, 
      unit: "ea", cost_estimated: 0, supplier: "", status: "To Order", photo_url: "" 
    });
  };

  const handleAddMaterial = (prefillPhaseId = "none") => {
    resetForm();
    setForm(prev => ({ ...prev, phase_id: prefillPhaseId }));
    setDialog(true);
  };

  const handleEdit = (mat) => {
    setEditingId(mat.id);
    setForm({
      custom_material_name: mat.custom_material_name || "",
      notes: mat.notes || "",
      phase_id: mat.phase_id || "none",
      quantity: mat.quantity || 1,
      unit: mat.unit || "ea",
      cost_estimated: mat.cost_estimated || 0,
      supplier: mat.supplier || "",
      status: mat.status || "To Order",
      photo_url: mat.photo_url || ""
    });
    setDialog(true);
  };

  // --- DATA PROCESSING & FILTERING ---
  const enrichedMaterials = materials.map(m => ({
    ...m,
    total_cost: Number(m.quantity || 0) * Number(m.cost_estimated || 0),
    safe_status: m.status || "To Order"
  }));

  const filteredMaterials = enrichedMaterials.filter(m => {
    const matchSearch = !searchQuery || 
      m.custom_material_name?.toLowerCase().includes(searchQuery.toLowerCase()) || 
      (m.notes && m.notes.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchStatus = statusFilter === "all" || m.safe_status === statusFilter;
    return matchSearch && matchStatus;
  });

  const groupedData = [
    { id: "none", name: "General / Unassigned Materials", items: filteredMaterials.filter(m => !m.phase_id) },
    ...phases.map(phase => ({ ...phase, items: filteredMaterials.filter(m => m.phase_id === phase.id) }))
  ].filter(group => group.items.length > 0 || group.id !== "none");

  const totalCost = enrichedMaterials.reduce((sum, m) => sum + m.total_cost, 0);
  const toOrderItems = enrichedMaterials.filter(m => m.safe_status === "To Order");
  const orderedItems = enrichedMaterials.filter(m => m.safe_status === "Ordered");
  const receivedItems = enrichedMaterials.filter(m => m.safe_status === "Received");

  const toOrderCost = toOrderItems.reduce((sum, m) => sum + m.total_cost, 0);
  const orderedCost = orderedItems.reduce((sum, m) => sum + m.total_cost, 0);
  const receivedCost = receivedItems.reduce((sum, m) => sum + m.total_cost, 0);

  const totalItemsCount = enrichedMaterials.length;
  const receivedPercentage = totalItemsCount > 0 ? Math.round((receivedItems.length / totalItemsCount) * 100) : 0;

  const renderStatusBadge = (status) => {
    if (status === "Received") return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800"><CheckCircle className="h-3 w-3" /> Received</span>;
    if (status === "Ordered") return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider bg-blue-100 text-blue-800"><ShoppingCart className="h-3 w-3" /> Ordered</span>;
    return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-800"><Clock className="h-3 w-3" /> To Order</span>;
  };

  if (isLoading) return <div className="p-8 text-center text-slate-500 animate-pulse font-medium">Loading project materials...</div>;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        
        {/* LEFT COLUMN: MAIN CONTENT */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input placeholder="Search materials..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-9 bg-slate-50 border-slate-200 focus:bg-white transition-colors"/>
            </div>
            
            <div className="flex w-full sm:w-auto items-center gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[150px] bg-slate-50 border-slate-200">
                  <Filter className="h-3 w-3 mr-2 text-slate-400"/>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="To Order">To Order</SelectItem>
                  <SelectItem value="Ordered">Ordered</SelectItem>
                  <SelectItem value="Received">Received</SelectItem>
                </SelectContent>
              </Select>

              <Button onClick={() => importMaterialsMutation.mutate()} variant="outline" className="w-full sm:w-auto font-bold border-slate-200 text-slate-700 bg-white hover:bg-slate-50 shadow-sm" disabled={importMaterialsMutation.isPending}>
                <DownloadCloud className="h-4 w-4 mr-2 text-slate-500" /> 
                {importMaterialsMutation.isPending ? "Importing..." : "Import Quote"}
              </Button>

              <Button onClick={() => handleAddMaterial("none")} className="w-full sm:w-auto bg-slate-900 hover:bg-slate-800 text-white font-bold">
                <Plus className="h-4 w-4 mr-2" /> Material
              </Button>
            </div>
          </div>

          <div className="space-y-6">
            {groupedData.length === 0 ? (
              <div className="text-center py-12 bg-white border border-slate-200 border-dashed rounded-xl">
                <Package className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">No materials match your filters.</p>
              </div>
            ) : (
              groupedData.map((group) => {
                const groupTotal = group.items.reduce((sum, m) => sum + m.total_cost, 0);
                
                return (
                  <Card key={group.id} className="overflow-hidden border-slate-200 shadow-sm">
                    <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-center border-l-4 border-l-slate-400">
                      <div className="flex items-center gap-3">
                        <h3 className="font-bold text-slate-900 text-sm sm:text-base">{group.name}</h3>
                        <span className="text-xs font-semibold text-slate-500 bg-slate-200/50 px-2 py-0.5 rounded-full">{group.items.length} item{group.items.length !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-sm font-bold text-slate-700 hidden sm:inline-block">{groupTotal > 0 ? `$${groupTotal.toLocaleString("en-US", {minimumFractionDigits: 2})}` : ''}</span>
                        <Button variant="ghost" size="sm" onClick={() => handleAddMaterial(group.id)} className="h-8 text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-200"><Plus className="h-3 w-3 mr-1" /> Add</Button>
                      </div>
                    </div>

                    <div className="divide-y divide-slate-100 bg-white">
                      {group.items.length === 0 ? (
                        <div className="p-4 text-center text-sm text-slate-400 italic">No materials assigned yet.</div>
                      ) : (
                        group.items.map((mat) => (
                          <div key={mat.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50 transition-colors">
                            
                            <div className="flex-1 min-w-0 flex gap-3.5">
                              {/* ⚡ UI UPDATE: Renders the photo if available */}
                              {mat.photo_url ? (
                                <img src={mat.photo_url} alt="" className="h-14 w-14 rounded-lg object-cover border border-slate-200 shrink-0 shadow-sm" />
                              ) : (
                                <div className="h-14 w-14 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                                  <Package className="h-6 w-6 text-slate-300" />
                                </div>
                              )}

                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <p className="font-bold text-slate-900 text-sm truncate">{mat.custom_material_name}</p>
                                  {renderStatusBadge(mat.safe_status)}
                                </div>
                                {mat.notes && <p className="text-xs text-slate-500 whitespace-pre-wrap leading-relaxed line-clamp-2">{mat.notes}</p>}
                                {mat.supplier && <p className="text-[10px] text-blue-600 font-bold mt-1">Supplier: {mat.supplier}</p>}
                              </div>
                            </div>

                            <div className="flex items-center justify-between sm:justify-end gap-6 shrink-0">
                              <div className="text-left sm:text-right">
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Qty: <span className="text-slate-700">{mat.quantity} {mat.unit}</span></p>
                                <p className="font-black text-slate-900">${mat.total_cost.toLocaleString("en-US", {minimumFractionDigits: 2})}</p>
                              </div>

                              <ActionMenu actions={[
                                ...(mat.safe_status !== "To Order" ? [{ label: "Mark 'To Order'", icon: Clock, onClick: () => statusMutation.mutate({ id: mat.id, status: "To Order" }) }] : []),
                                ...(mat.safe_status !== "Ordered" ? [{ label: "Mark 'Ordered'", icon: ShoppingCart, onClick: () => statusMutation.mutate({ id: mat.id, status: "Ordered" }) }] : []),
                                ...(mat.safe_status !== "Received" ? [{ label: "Mark 'Received'", icon: CheckCircle, onClick: () => statusMutation.mutate({ id: mat.id, status: "Received" }) }] : []),
                                { label: "Edit Material", icon: Edit2, onClick: () => handleEdit(mat) },
                                { label: "Delete", icon: Trash2, destructive: true, onClick: () => { if(window.confirm("Remove this material?")) deleteMutation.mutate(mat.id); } },
                              ]} />
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </Card>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT SIDEBAR */}
        <div className="lg:col-span-1 space-y-6">
          <Card className="p-6 border-slate-200 shadow-sm sticky top-6 bg-white">
            <div className="flex items-center gap-2 mb-6">
              <TrendingUp className="h-5 w-5 text-blue-600" />
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Purchasing Overview</h3>
            </div>

            <div className="space-y-6">
              <div>
                <div className="flex justify-between text-xs font-bold text-slate-500 mb-2">
                  <span>Materials Received</span>
                  <span className="text-emerald-600">{receivedPercentage}%</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                  <div className="bg-emerald-500 h-2.5 rounded-full transition-all duration-500" style={{ width: `${receivedPercentage}%` }}></div>
                </div>
                <p className="text-xs text-slate-400 mt-2">{receivedItems.length} of {totalItemsCount} items are on-site.</p>
              </div>
              <div className="h-px bg-slate-100 w-full" />
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-amber-50 border border-amber-100 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-amber-500" />
                    <div>
                      <p className="text-xs font-bold text-amber-900 uppercase tracking-wider">To Order</p>
                      <p className="text-xs font-medium text-amber-700">{toOrderItems.length} Items</p>
                    </div>
                  </div>
                  <p className="font-black text-amber-700">${toOrderCost.toLocaleString("en-US", {minimumFractionDigits: 2})}</p>
                </div>
                <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-100 rounded-lg">
                  <div className="flex items-center gap-2">
                    <ShoppingCart className="h-4 w-4 text-blue-500" />
                    <div>
                      <p className="text-xs font-bold text-blue-900 uppercase tracking-wider">Ordered</p>
                      <p className="text-xs font-medium text-blue-700">{orderedItems.length} Items</p>
                    </div>
                  </div>
                  <p className="font-black text-blue-700">${orderedCost.toLocaleString("en-US", {minimumFractionDigits: 2})}</p>
                </div>
                <div className="flex items-center justify-between p-3 bg-emerald-50 border border-emerald-100 rounded-lg">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-emerald-500" />
                    <div>
                      <p className="text-xs font-bold text-emerald-900 uppercase tracking-wider">Received</p>
                      <p className="text-xs font-medium text-emerald-700">{receivedItems.length} Items</p>
                    </div>
                  </div>
                  <p className="font-black text-emerald-700">${receivedCost.toLocaleString("en-US", {minimumFractionDigits: 2})}</p>
                </div>
              </div>
              <div className="pt-4 border-t border-slate-100 flex justify-between items-center">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Est. Cost</p>
                <p className="text-xl font-black text-slate-900">${totalCost.toLocaleString("en-US", {minimumFractionDigits: 2})}</p>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* ADD / EDIT DIALOG */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialog(open); if(!open) resetForm(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editingId ? "Edit Material" : "Add Material"}</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); saveMaterialMutation.mutate(form); }} className="space-y-4 pt-2">
            <div><Label>Material Name *</Label><Input required placeholder="e.g., 2x4x8 Lumber, Delta Faucet..." value={form.custom_material_name} onChange={e => setForm({...form, custom_material_name: e.target.value})} className="mt-1 bg-white font-medium" /></div>
            <div>
              <Label>Assign to Phase</Label>
              <Select value={form.phase_id} onValueChange={v => setForm({...form, phase_id: v})}>
                <SelectTrigger className="mt-1 bg-white font-medium"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">General / Unassigned</SelectItem>
                  {phases.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Quantity</Label><Input type="number" min="0" step="0.01" required value={form.quantity} onChange={e => setForm({...form, quantity: e.target.value})} className="mt-1 bg-white font-bold" /></div>
              <div><Label>Unit</Label><Input placeholder="e.g., ea, feet, sqft" required value={form.unit} onChange={e => setForm({...form, unit: e.target.value})} className="mt-1 bg-white font-medium" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Estimated Unit Cost</Label>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-2.5 text-slate-500 font-bold">$</span>
                  <Input type="number" min="0" step="0.01" value={form.cost_estimated} onChange={e => setForm({...form, cost_estimated: e.target.value})} className="pl-7 bg-white font-bold" />
                </div>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm({...form, status: v})}>
                  <SelectTrigger className="mt-1 bg-white font-bold"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="To Order" className="text-amber-700 font-bold">To Order</SelectItem>
                    <SelectItem value="Ordered" className="text-blue-700 font-bold">Ordered</SelectItem>
                    <SelectItem value="Received" className="text-emerald-700 font-bold">Received On-Site</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Supplier</Label><Input placeholder="e.g. Home Depot, Build.com" value={form.supplier} onChange={e => setForm({...form, supplier: e.target.value})} className="mt-1 bg-white" /></div>
            <div><Label>Notes / Details (Optional)</Label><Input placeholder="Supplier info, SKUs, or specs..." value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className="mt-1 bg-white" /></div>
            <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
              <Button type="button" variant="outline" onClick={() => setDialog(false)} className="font-bold">Cancel</Button>
              <Button type="submit" className="bg-slate-900 hover:bg-slate-800 text-white font-bold shadow-md" disabled={saveMaterialMutation.isPending}>
                {saveMaterialMutation.isPending ? "Saving..." : "Save Material"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}