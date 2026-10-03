import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient"; 
import { useAuth } from "@/lib/AuthContext";
import { createPageUrl } from "@/utils";
import { Link } from "react-router-dom";
import { Plus, FolderKanban, Eye, Trash2, Building2, Calendar, CheckSquare, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import PMStatusBadge from "@/components/pm/PMStatusBadge";
import { toast } from "sonner";

export default function PMProjects() {
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", status: "Active", address: "", start_date_target: "", end_date_target: "", budget_target: "", description: "", client_id: "", linked_quote_id: "" });
  const [importPhases, setImportPhases] = useState(true);
  const [importMaterials, setImportMaterials] = useState(true);
  const [importing, setImporting] = useState(false);
  const qc = useQueryClient();

  // --- SUPABASE QUERIES ---
  const { data: company } = useQuery({
    queryKey: ["company", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("companies").select("*").eq("id", companyId).single();
      return data || null;
    }
  });

  const { data: projects = [] } = useQuery({ 
    queryKey: ["pm_projects", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    }
  });

  const { data: clients = [] } = useQuery({ 
    queryKey: ["clients", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").eq("company_id", companyId);
      if (error) throw error;
      return data || [];
    }
  });

  const { data: quotes = [] } = useQuery({ 
    queryKey: ["quotes_list", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("quotes").select("*").eq("company_id", companyId);
      if (error) throw error;
      return data || [];
    }
  });

  const resetForm = () => {
    setForm({ name: "", status: "Active", address: "", start_date_target: "", end_date_target: "", budget_target: "", description: "", client_id: "", linked_quote_id: "" });
    setImportPhases(true);
    setImportMaterials(true);
  };

  const handleCreate = async () => {
    if (!companyId) {
      toast.error("Session missing. Please refresh.");
      return;
    }

    setImporting(true);
    toast.loading("Creating project workspace...");

    try {
      const projectNumber = `${company?.project_number_prefix || "PRJ-"}${company?.next_project_number || Date.now().toString().slice(-4)}`;

      // 1. Create the base project
      const { data: newProject, error: projectError } = await supabase.from("projects").insert([{ 
        company_id: companyId,
        project_number: projectNumber,
        name: form.name,
        status: form.status,
        site_address: form.address,
        start_date: form.start_date_target || null,
        target_end_date: form.end_date_target || null,
        budget: form.budget_target ? Number(form.budget_target) : null,
        budget_revenue: form.budget_target ? Number(form.budget_target) : 0,
        notes: form.description,
        client_id: form.client_id || null,
        quote_id: form.linked_quote_id || null
      }]).select().single();

      if (projectError) throw projectError;
      
      const projectId = newProject.id;

      // Increment company project counter
      await supabase.from("companies").update({ 
        next_project_number: (company?.next_project_number || 1001) + 1 
      }).eq("id", companyId);

      // 2. Import logic if a quote is linked
      if (form.linked_quote_id && (importPhases || importMaterials)) {
        
        // Fetch linked quote phases and items
        const { data: quotePhases } = await supabase.from("quote_phases").select("*").eq("quote_id", form.linked_quote_id).order("sort_order", { ascending: true });
        const { data: quoteLineItems } = await supabase.from("quote_line_items").select("*").eq("quote_id", form.linked_quote_id);

        if (importPhases && quotePhases && quotePhases.length > 0) {
          const phaseIdMap = {};
          
          // Insert phases sequentially to map IDs
          for (const qp of quotePhases) {
            const { data: pmPhase } = await supabase.from("project_phases").insert([{
              company_id: companyId,
              project_id: projectId,
              name: qp.phase_name,
              phase_order: qp.sort_order || 0,
              status: "Not Started",
              client_visible: true,
            }]).select().single();
            
            if (pmPhase) {
              phaseIdMap[qp.id] = pmPhase.id;
            }
          }

          // Import line items into project_materials
          if (importMaterials && quoteLineItems && quoteLineItems.length > 0) {
            const materialsToInsert = quoteLineItems.map(li => ({
              company_id: companyId,
              project_id: projectId,
              phase_id: phaseIdMap[li.phase_id] || null,
              custom_material_name: li.name,
              quantity: li.quantity || 1,
              unit: li.unit || "ea",
              needed_by_date: form.end_date_target || new Date().toISOString().split("T")[0],
              status: "Not Planned",
              cost_estimated: li.unit_cost ? li.unit_cost * (li.quantity || 1) : 0,
            }));
            
            await supabase.from("project_materials").insert(materialsToInsert);
          }

        } else if (importMaterials && quoteLineItems && quoteLineItems.length > 0) {
          // Import materials without linking them to phases
          const materialsToInsert = quoteLineItems.map(li => ({
            company_id: companyId,
            project_id: projectId,
            custom_material_name: li.name,
            quantity: li.quantity || 1,
            unit: li.unit || "ea",
            needed_by_date: form.end_date_target || new Date().toISOString().split("T")[0],
            status: "Not Planned",
            cost_estimated: li.unit_cost ? li.unit_cost * (li.quantity || 1) : 0,
          }));
          
          await supabase.from("project_materials").insert(materialsToInsert);
        }
      }

      qc.invalidateQueries({ queryKey: ["pm_projects"] });
      toast.dismiss();
      toast.success("Project created successfully!");
      setOpen(false);
      resetForm();
      
    } catch (error) {
      toast.dismiss();
      console.error("Error creating PM Project:", error);
      toast.error(error.message || "Failed to create project");
    } finally {
      setImporting(false);
    }
  };

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("projects").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm_projects"] });
      toast.success("Project deleted");
    },
    onError: (err) => toast.error("Failed to delete project")
  });

  const clientMap = Object.fromEntries(clients.map(c => [c.id, c.name]));

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">PM Projects</h1>
          <p className="text-slate-500 text-sm">{projects.length} total projects</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {projects.map(p => (
          <Card key={p.id} className="hover:shadow-md transition-all border-slate-200">
            <div className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <PMStatusBadge status={p.status} className="mb-2" />
                  <h3 className="font-semibold text-slate-900 text-base leading-tight truncate">{p.name}</h3>
                  {p.client_id && <p className="text-xs text-slate-500 mt-1 truncate">{clientMap[p.client_id]}</p>}
                </div>
              </div>
              {p.site_address && (
                <div className="flex items-center gap-1 text-xs text-slate-500 mb-2 truncate">
                  <Building2 className="h-3 w-3 shrink-0" />
                  <span className="truncate">{p.site_address}</span>
                </div>
              )}
              {(p.start_date || p.target_end_date) && (
                <div className="flex items-center gap-1 text-xs text-slate-500 mb-3">
                  <Calendar className="h-3 w-3 shrink-0" />
                  {p.start_date || "?"} → {p.target_end_date || "?"}
                </div>
              )}
              {p.budget && (
                <p className="text-sm font-semibold text-amber-600 mb-3">${Number(p.budget).toLocaleString()}</p>
              )}
              <div className="flex gap-2">
                <Link to={createPageUrl(`PMProjectWorkspace?id=${p.id}`)} className="flex-1">
                  <Button size="sm" variant="outline" className="w-full"><Eye className="h-3 w-3 mr-1" /> Open</Button>
                </Link>
                <Button size="sm" variant="ghost" className="text-red-500 hover:bg-red-50" onClick={() => {
                  if(window.confirm("Are you sure you want to delete this project? All associated tasks and materials will be lost.")) {
                    deleteMutation.mutate(p.id);
                  }
                }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
        {projects.length === 0 && (
          <div className="col-span-3 text-center py-16 text-slate-400">
            <FolderKanban className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No projects yet. Create your first PM project.</p>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Project</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Link to Quote <span className="text-slate-400 font-normal text-xs">(auto-fills fields below)</span></Label>
              <Select value={form.linked_quote_id || ""} onValueChange={v => {
                if (v === "none") {
                  setForm(prev => ({ ...prev, linked_quote_id: "" }));
                  return;
                }
                const quote = quotes.find(q => q.id === v);
                if (quote) {
                  const firstLine = (quote.site_address || "").split(/[\n,]/)[0].trim();
                  setForm(prev => ({
                    ...prev,
                    linked_quote_id: v,
                    name: firstLine && quote.title ? `${firstLine} - ${quote.title}` : quote.title || prev.name,
                    client_id: quote.client_id || prev.client_id,
                    address: quote.site_address || prev.address,
                    budget_target: quote.total ? String(quote.total) : prev.budget_target,
                    description: quote.overall_scope || prev.description,
                  }));
                }
              }}>
                <SelectTrigger><SelectValue placeholder="Select quote..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {quotes.filter(q => !q.is_template).map(q => (
                    <SelectItem key={q.id} value={q.id}>
                      {q.quote_number ? `${q.quote_number} — ` : ""}{q.title || 'Untitled Quote'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Project Name *</Label>
              <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="e.g. 46 Cranberry Close SE - Feature Wall and Flooring" />
              <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                <span>⚠</span> Format recommendation: <span className="font-semibold">Street Address - Type of Work</span>
              </p>
            </div>
            <div><Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm({...form, status: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["Lead","Active","In Progress","On Hold","Completed","Cancelled"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Client</Label>
              <Select value={form.client_id || ""} onValueChange={v => {
                if (v === "none") {
                  setForm(prev => ({ ...prev, client_id: "" }));
                  return;
                }
                const client = clients.find(c => c.id === v);
                if (client) {
                  setForm(prev => ({
                    ...prev,
                    client_id: v,
                    address: client.site_address || client.billing_address || prev.address,
                  }));
                }
              }}>
                <SelectTrigger><SelectValue placeholder="Select client..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {form.client_id && (() => {
              const client = clients.find(c => c.id === form.client_id);
              if (!client) return null;
              return (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Client Info</p>
                  {client.primary_contact_name && <p className="text-sm text-slate-700"><span className="text-xs text-slate-400">Contact: </span>{client.primary_contact_name}</p>}
                  {client.email && <p className="text-sm text-slate-700"><span className="text-xs text-slate-400">Email: </span>{client.email}</p>}
                  {client.phone && <p className="text-sm text-slate-700"><span className="text-xs text-slate-400">Phone: </span>{client.phone}</p>}
                  {client.billing_address && <p className="text-sm text-slate-700"><span className="text-xs text-slate-400">Billing: </span>{client.billing_address}</p>}
                  {client.site_address && <p className="text-sm text-slate-700"><span className="text-xs text-slate-400">Site: </span>{client.site_address}</p>}
                  {client.type && <p className="text-sm text-slate-700"><span className="text-xs text-slate-400">Type: </span>{client.type}</p>}
                  {client.notes && <p className="text-sm text-slate-600 italic mt-1">{client.notes}</p>}
                </div>
              );
            })()}

            <div><Label>Site Address</Label><Input value={form.address} onChange={e => setForm({...form, address: e.target.value})} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Target Start Date</Label><Input type="date" value={form.start_date_target} onChange={e => setForm({...form, start_date_target: e.target.value})} /></div>
              <div><Label>Target End Date</Label><Input type="date" value={form.end_date_target} onChange={e => setForm({...form, end_date_target: e.target.value})} /></div>
            </div>
            <div><Label>Budget Target ($)</Label><Input type="number" value={form.budget_target} onChange={e => setForm({...form, budget_target: e.target.value})} /></div>
            <div><Label>Notes / Description</Label><Textarea rows={2} value={form.description} onChange={e => setForm({...form, description: e.target.value})} /></div>

            {form.linked_quote_id && (
              <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-2 mt-2">
                <p className="text-xs font-semibold text-amber-800">Import Data from Quote</p>
                <div className="flex items-center gap-2">
                  <Checkbox id="imp-phases" checked={importPhases} onCheckedChange={setImportPhases} />
                  <label htmlFor="imp-phases" className="text-sm text-slate-700 cursor-pointer">Import quote phases as PM phases</label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="imp-materials" checked={importMaterials} onCheckedChange={setImportMaterials} />
                  <label htmlFor="imp-materials" className="text-sm text-slate-700 cursor-pointer">Import line items as materials schedule</label>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => { setOpen(false); resetForm(); }}>Cancel</Button>
              <Button className="bg-slate-900 hover:bg-slate-800 text-white" onClick={handleCreate} disabled={!form.name || importing}>
                {importing ? "Creating..." : "Create Project"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}