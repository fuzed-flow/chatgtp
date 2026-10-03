import React, { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient"; 
import { useAuth } from "@/lib/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, FileStack, Pencil, Trash2, Copy, Image, Upload } from "lucide-react";
import { useNavigate } from "react-router-dom"; 
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageHeader from "../components/shared/PageHeader";
import EmptyState from "../components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import LineItemRow from "../components/quotes/LineItemRow"; // ⚡ USES YOUR EXACT COMPONENT

const CATEGORIES = ["Kitchen", "Bathroom", "Basement", "Deck", "Fence", "Flooring", "Painting", "Electrical", "Plumbing", "Custom"];

export default function Templates() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  const [activeTab, setActiveTab] = useState("estimate");
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", category: "Kitchen", description: "", default_terms: "", is_active: true });
  
  // Phase template states
  const [phaseDialogOpen, setPhaseDialogOpen] = useState(false);
  const [editingPhase, setEditingPhase] = useState(null);
  const [phaseForm, setPhaseForm] = useState({ template_name: "", description: "", phase_name: "", scope_of_work: "", line_items_json: "[]", is_active: true });
  const [phaseLineItems, setPhaseLineItems] = useState([]);
  
  const queryClient = useQueryClient();

  // 1. SUPABASE QUERIES
  const { data: templates = [] } = useQuery({ 
    queryKey: ["quote-templates-list", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("quotes").select("*").eq("company_id", companyId).eq("is_template", true).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    } 
  });

  const { data: phaseTemplates = [] } = useQuery({ 
    queryKey: ["phase-templates", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("phase_templates").select("*").eq("company_id", companyId).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    } 
  });

  // 2. SUPABASE MUTATIONS
  const createMutation = useMutation({
    mutationFn: async (data) => {
      const { error } = await supabase.from("quotes").insert([{ ...data, company_id: companyId, is_template: true, title: data.name }]);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["quote-templates-list"] }); setDialogOpen(false); toast.success("Template created"); },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const { error } = await supabase.from("quotes").update({ ...data, title: data.name }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["quote-templates-list"] }); setDialogOpen(false); setEditing(null); toast.success("Template updated"); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("quotes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["quote-templates-list"] }); toast.success("Template deleted"); },
  });

  const createPhaseMutation = useMutation({
    mutationFn: async (data) => {
      const { error } = await supabase.from("phase_templates").insert([{ ...data, company_id: companyId }]);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["phase-templates"] }); setPhaseDialogOpen(false); toast.success("Phase template saved"); },
  });

  const updatePhaseMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const { error } = await supabase.from("phase_templates").update(data).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["phase-templates"] }); setPhaseDialogOpen(false); setEditingPhase(null); toast.success("Phase template updated"); },
  });

  const deletePhaseMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("phase_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["phase-templates"] }); toast.success("Phase template deleted"); },
  });

  const handleSave = async (e) => {
    e.preventDefault();
    if (editing) await updateMutation.mutateAsync({ id: editing.id, data: form });
    else await createMutation.mutateAsync(form);
  };

  const handleSavePhase = async (e) => {
    e.preventDefault();
    const dataToSave = { ...phaseForm, line_items_json: JSON.stringify(phaseLineItems) };
    if (editingPhase) await updatePhaseMutation.mutateAsync({ id: editingPhase.id, data: dataToSave });
    else await createPhaseMutation.mutateAsync(dataToSave);
    setPhaseLineItems([]);
  };

  const openNewPhase = () => {
    setEditingPhase(null);
    setPhaseForm({ template_name: "", description: "", phase_name: "", scope_of_work: "", line_items_json: "[]", is_active: true });
    setPhaseLineItems([]);
    setPhaseDialogOpen(true);
  };

  const openEditPhase = (template) => {
    setEditingPhase(template);
    setPhaseForm({ 
      template_name: template.template_name || "", description: template.description || "", 
      phase_name: template.phase_name || "", scope_of_work: template.scope_of_work || "", 
      line_items_json: template.line_items_json || "[]", is_active: template.is_active !== false 
    });
    try {
      const parsedItems = JSON.parse(template.line_items_json || "[]");
      const itemsWithIds = parsedItems.map(item => ({
        ...item,
        id: item.id || `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        unit_cost: Number(item.unit_cost) || 0,
        unit_price: Number(item.unit_price) || 0,
        material_cost: Number(item.material_cost) || 0, // ⚡ Rigidly cast so Math Engine doesn't crash
        labor_cost: Number(item.labor_cost) || 0,
      }));
      setPhaseLineItems(itemsWithIds);
    } catch {
      setPhaseLineItems([]);
    }
    setPhaseDialogOpen(true);
  };

  // --- DRAG AND DROP & ROW HANDLERS ---
  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(phaseLineItems);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    setPhaseLineItems(items);
  };

  const handleRowUpdate = (_, itemIdx, field, value) => {
    // ⚡ Using 'prev' prevents rapid-fire state overwrites
    setPhaseLineItems(prev => {
      const updated = [...prev];
      updated[itemIdx] = { ...updated[itemIdx], [field]: value };
      return updated;
    });
  };

  const handleRowDuplicate = (_, itemIdx) => {
    const items = [...phaseLineItems];
    const duplicated = { ...items[itemIdx], id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` };
    items.splice(itemIdx + 1, 0, duplicated);
    setPhaseLineItems(items);
    toast.success("Item duplicated");
  };

  const handleRowRemove = (_, itemIdx) => {
    setPhaseLineItems(phaseLineItems.filter((__, i) => i !== itemIdx));
  };

  const handleRowPhoto = async (_, itemIdx, file) => {
    try {
      const fileName = `${companyId}/templates/${Date.now()}_${file.name}`;
      const { error } = await supabase.storage.from('quotes').upload(fileName, file);
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('quotes').getPublicUrl(fileName);
      handleRowUpdate(null, itemIdx, "photo_url", publicUrl);
      toast.success("Photo uploaded to template");
    } catch (error) { toast.error("Upload failed: " + error.message); }
  };

  const filtered = templates.filter(t => !search || t.title?.toLowerCase().includes(search.toLowerCase()) || t.template_category?.toLowerCase().includes(search.toLowerCase()));
  const filteredPhases = phaseTemplates.filter(t => !search || t.template_name?.toLowerCase().includes(search.toLowerCase()) || t.phase_name?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <PageHeader title="Templates" description="Manage quote and phase templates" />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
        <TabsList>
          <TabsTrigger value="estimate">Quote Templates</TabsTrigger>
          <TabsTrigger value="phase">Phase/Room Templates</TabsTrigger>
        </TabsList>

        <TabsContent value="estimate">
          <div className="flex flex-col sm:flex-row justify-between gap-3 mb-5 mt-4">
            <div className="relative w-full sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input placeholder="Search templates..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
            </div>
            <Button onClick={() => navigate("/QuoteBuilder?is_template=true")} className="bg-slate-900 hover:bg-slate-800 w-full sm:w-auto"><Plus className="h-4 w-4 mr-2" /> New Template</Button>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(t => (
              <Card key={t.id} className="p-5 hover:shadow-md transition-shadow border-slate-200/80">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">{t.title || t.name}</h3>
                    {t.template_category && <Badge variant="outline" className="text-xs mt-1">{t.template_category}</Badge>}
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(`/QuoteBuilder?id=${t.id}&is_template=true`)}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { if (window.confirm("Are you sure you want to delete this template?")) deleteMutation.mutate(t.id); }}>
                      <Trash2 className="h-3 w-3 text-red-500" />
                    </Button>
                  </div>
                </div>
                {t.overall_scope && <p className="text-xs text-slate-500 mb-3 line-clamp-2">{t.overall_scope}</p>}
                <Button variant="outline" size="sm" className="w-full" onClick={() => navigate(`/QuoteBuilder?id=${t.id}&is_template=true`)}>
                  <FileStack className="h-3 w-3 mr-1" /> Open Template Builder
                </Button>
              </Card>
            ))}
          </div>
          {filtered.length === 0 && <EmptyState icon={FileStack} title="No templates yet" description="Create reusable quote templates" />}
        </TabsContent>

        <TabsContent value="phase">
          <div className="flex flex-col sm:flex-row justify-between gap-3 mb-5 mt-4">
            <div className="relative w-full sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input placeholder="Search phase templates..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
            </div>
            <Button onClick={openNewPhase} className="bg-amber-500 hover:bg-amber-600 w-full sm:w-auto"><Plus className="h-4 w-4 mr-2" /> New Phase Template</Button>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPhases.map(t => (
              <Card key={t.id} className="p-5 hover:shadow-md transition-shadow border-slate-200/80">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-slate-800">{t.template_name}</h3>
                    <p className="text-xs text-amber-600 mt-1">→ {t.phase_name}</p>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditPhase(t)}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { if (window.confirm("Are you sure you want to delete this phase template?")) deletePhaseMutation.mutate(t.id); }}>
                      <Trash2 className="h-3 w-3 text-red-500" />
                    </Button>
                  </div>
                </div>
                {t.description && <p className="text-xs text-slate-500 mb-2">{t.description}</p>}
                {t.scope_of_work && <p className="text-xs text-slate-600 line-clamp-2 mb-3">{t.scope_of_work}</p>}
                <div className="mt-3 mb-3 text-xs text-slate-500">
                  {(() => { try { const items = JSON.parse(t.line_items_json || "[]"); return `${items.length} line items`; } catch { return "0 line items"; } })()}
                </div>
                <Button variant="outline" size="sm" className="w-full" onClick={() => openEditPhase(t)}>
                  <FileStack className="h-3 w-3 mr-1" /> Edit Phase Template
                </Button>
              </Card>
            ))}
          </div>
          {filteredPhases.length === 0 && <EmptyState icon={FileStack} title="No phase templates yet" description="Create reusable phase/room templates" />}
        </TabsContent>
      </Tabs>

      {/* Quote Template Details Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(v) => { setDialogOpen(v); if (!v) setEditing(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "Edit Template Details" : "New Template"}</DialogTitle></DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} required /></div>
            <div><Label>Category</Label>
              <Select value={form.category} onValueChange={v => setForm({...form, category: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} rows={2} /></div>
            <div><Label>Default Terms</Label><Textarea value={form.default_terms} onChange={e => setForm({...form, default_terms: e.target.value})} rows={2} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_active} onChange={e => setForm({...form, is_active: e.target.checked})} className="rounded" /> Active</label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" className="bg-slate-900 hover:bg-slate-800">{editing ? "Update" : "Create"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Phase Template Editor Dialog */}
      <Dialog open={phaseDialogOpen} onOpenChange={(v) => { setPhaseDialogOpen(v); if (!v) { setEditingPhase(null); setPhaseLineItems([]); } }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto w-[95vw]">
          <DialogHeader><DialogTitle>{editingPhase ? "Edit Phase Template" : "New Phase Template"}</DialogTitle></DialogHeader>
          <form onSubmit={handleSavePhase} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><Label>Template Name *</Label><Input value={phaseForm.template_name} onChange={e => setPhaseForm({...phaseForm, template_name: e.target.value})} placeholder="e.g., Standard Full Bathroom" required /></div>
              <div><Label>Phase/Room Name *</Label><Input value={phaseForm.phase_name} onChange={e => setPhaseForm({...phaseForm, phase_name: e.target.value})} placeholder="e.g., Master Bath" required /></div>
              <div className="md:col-span-2"><Label>Description (Internal)</Label><Input value={phaseForm.description} onChange={e => setPhaseForm({...phaseForm, description: e.target.value})} placeholder="Brief description" /></div>
              <div className="md:col-span-2"><Label>Scope of Work (Client-Facing)</Label><Textarea value={phaseForm.scope_of_work} onChange={e => setPhaseForm({...phaseForm, scope_of_work: e.target.value})} rows={3} placeholder="Describe the work..." /></div>
            </div>
            
            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-3">
                <Label className="text-sm font-black text-slate-900 uppercase tracking-wider">Template Line Items ({phaseLineItems.length})</Label>
              </div>
              
              <div className="space-y-3 bg-slate-50/50 p-3 rounded-lg border border-slate-200">
                <DragDropContext onDragEnd={handleDragEnd}>
                  <Droppable droppableId="template-builder-items">
                    {(provided) => (
                      <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-3">
                        {phaseLineItems.length === 0 && (
                          <div className="text-center py-8 bg-white rounded-lg border-2 border-dashed border-slate-200">
                            <p className="text-sm font-bold text-slate-400 mb-3">No line items in this template yet.</p>
                          </div>
                        )}

                        {phaseLineItems.map((item, idx) => (
                          <Draggable key={item.id} draggableId={item.id} index={idx}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                className={snapshot.isDragging ? "opacity-90 shadow-2xl ring-2 ring-amber-400 rounded-lg scale-[1.02] transition-transform" : ""}
                              >
                                <LineItemRow
                                  item={item}
                                  itemIdx={idx}
                                  phaseIdx={0}
                                  phases={[{ phase_name: "Template" }]}
                                  onUpdate={handleRowUpdate}
                                  onDuplicate={handleRowDuplicate}
                                  onMove={() => {}}
                                  onRemove={handleRowRemove}
                                  onPhotoUpload={handleRowPhoto}
                                  clientSelections={null}
                                  dragHandleProps={provided.dragHandleProps}
                                />
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </DragDropContext>
                
                <Button 
                  type="button" 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setPhaseLineItems([...phaseLineItems, { 
                    id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    name: "", description: "", internal_notes: "", quantity: 1, 
                    unit: "ea", unit_cost: 0, unit_price: 0, 
                    material_cost: 0, labor_cost: 0, // ⚡ Material & Labor correctly initialized!
                    taxable: true, is_optional: false, default_selected: true, photo_url: "",
                    is_material: false, supplier: "" 
                  }])}
                  className="w-full mt-2 bg-white font-bold text-slate-600 hover:border-amber-400 hover:text-amber-700 hover:bg-amber-50 border-dashed border-2 h-10"
                >
                  <Plus className="h-4 w-4 mr-1.5" /> Add Blank Line Item
                </Button>
              </div>
            </div>
            
            <div className="border-t pt-4 flex justify-between items-center">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={phaseForm.is_active} onChange={e => setPhaseForm({...phaseForm, is_active: e.target.checked})} className="rounded" /> Active Phase Template</label>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setPhaseDialogOpen(false)}>Cancel</Button>
                <Button type="submit" className="bg-amber-500 hover:bg-amber-600 font-bold text-slate-900">{editingPhase ? "Update Template" : "Save Template"}</Button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}