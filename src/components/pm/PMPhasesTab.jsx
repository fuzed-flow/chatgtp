import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { useNavigate } from "react-router-dom";
import { format, differenceInDays, parseISO, isAfter, startOfDay, isValid } from "date-fns"; 
import { Plus, ChevronDown, ChevronRight, Trash2, GitBranch, User, DollarSign, AlertTriangle, CalendarDays, HardHat } from "lucide-react"; 
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";

const safeNum = (val) => isNaN(Number(val)) ? 0 : Number(val);
const safeParseDate = (dateString) => {
  if (!dateString) return null;
  const parsed = parseISO(dateString);
  return isValid(parsed) ? parsed : null;
};

const CATEGORIES = ["General", "Plumbing", "Electrical", "HVAC", "Framing", "Drywall", "Roofing", "Concrete", "Painting", "Landscaping", "Other"];

export default function PMPhasesTab({ project }) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const navigate = useNavigate();
const [localNotes, setLocalNotes] = useState({});
  const [expanded, setExpanded] = useState({});
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ 
    name: "", phase_order: 1, status: "Not Started", start_date_target: "", 
    end_date_target: "", client_visible: true, internal_notes: "", budget: 0,
    subcontractor_id: "none"
  });

  // ⚡ FIXED: Subcontractor Creation State matches database schema perfectly
  const [subDialogOpen, setSubDialogOpen] = useState(false);
  const [activePhaseIdForSub, setActivePhaseIdForSub] = useState(null);
  const [subForm, setSubForm] = useState({ name: "", contact_name: "", category: "General", email: "", phone: "" });

  // --- SUPABASE QUERIES ---
  const { data: phases = [] } = useQuery({ 
    queryKey: ["pm_phases", project?.id], enabled: !!project?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("project_phases").select("*").eq("project_id", project.id);
      if (error) throw error; return data || [];
    } 
  });
  
  const { data: tasks = [] } = useQuery({ 
    queryKey: ["pm_tasks", project?.id], enabled: !!project?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("project_tasks").select("*").eq("project_id", project.id);
      if (error) throw error; return data || [];
    } 
  });
  
  const { data: milestones = [] } = useQuery({ 
    queryKey: ["pm_milestones", project?.id], enabled: !!project?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("project_milestones").select("*").eq("project_id", project.id);
      if (error) throw error; return data || [];
    } 
  });

  const { data: materials = [] } = useQuery({ 
    queryKey: ["pm_materials", project?.id], enabled: !!project?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("project_materials").select("*").eq("project_id", project.id);
      if (error) throw error; return data || [];
    } 
  });

  const { data: users = [] } = useQuery({ 
    queryKey: ["users", companyId], enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("users").select("*").eq("company_id", companyId);
      if (error) throw error; return data || [];
    } 
  });

  const { data: subcontractors = [] } = useQuery({
    queryKey: ["vendors", companyId], enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("vendors").select("*").eq("company_id", companyId);
      if (error) return []; return data || [];
    }
  });

  // --- SUPABASE MUTATIONS ---
  const createPhase = useMutation({ 
    mutationFn: async (d) => {
      const cleanData = { ...d };
      if (!cleanData.start_date_target) cleanData.start_date_target = null;
      if (!cleanData.end_date_target) cleanData.end_date_target = null;
      if (cleanData.subcontractor_id === "none") cleanData.subcontractor_id = null;

      const { error } = await supabase.from("project_phases").insert([{ ...cleanData, company_id: companyId, project_id: project.id }]);
      if (error) throw error;
    },
    onSuccess: () => { 
      qc.invalidateQueries({ queryKey: ["pm_phases", project.id] }); 
      setAddOpen(false); 
      setForm({ name: "", phase_order: phases.length + 1, status: "Not Started", start_date_target: "", end_date_target: "", client_visible: true, internal_notes: "", budget: 0, subcontractor_id: "none" }); 
      toast.success("Phase created");
    },
    onError: (err) => toast.error(`Failed to create phase: ${err.message}`)
  });
  
  const updatePhase = useMutation({ 
    mutationFn: async ({ id, data }) => {
      const cleanData = { ...data };
      if (cleanData.start_date_target === "") cleanData.start_date_target = null;
      if (cleanData.end_date_target === "") cleanData.end_date_target = null;
      if (cleanData.start_date_actual === "") cleanData.start_date_actual = null;
      if (cleanData.end_date_actual === "") cleanData.end_date_actual = null;
      if (cleanData.assigned_to === "none") cleanData.assigned_to = null;
      if (cleanData.subcontractor_id === "none") cleanData.subcontractor_id = null;

      const { error } = await supabase.from("project_phases").update(cleanData).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pm_phases", project.id] }),
    onError: (err) => toast.error("Failed to update phase")
  });
  
  const deletePhase = useMutation({ 
    mutationFn: async (id) => {
      const { error } = await supabase.from("project_phases").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pm_phases", project.id] }); toast.success("Phase deleted"); },
    onError: () => toast.error("Failed to delete phase")
  });

  // ⚡ FIXED: Quick Add Subcontractor explicitly matching 'vendors' columns!
  const createSubMutation = useMutation({
    mutationFn: async (data) => {
      const { data: newSub, error } = await supabase.from("vendors").insert([{
        company_id: companyId,
        name: data.name,
        contact_name: data.contact_name || "",
        category: data.category || "General",
        email: data.email || "",
        phone: data.phone || "",
        rating: 0,
        preferred: false,
        projects_worked_on: [],
        invoice_urls: []
      }]).select().single();
      
      if (error) throw error;
      return newSub;
    },
    onSuccess: (newSub) => {
      qc.invalidateQueries({ queryKey: ["vendors", companyId] });
      toast.success("Subcontractor added!");
      setSubDialogOpen(false);
      
      if (activePhaseIdForSub === "new_phase_form") {
        setForm({ ...form, subcontractor_id: newSub.id });
      } else if (activePhaseIdForSub) {
        updatePhase.mutate({ id: activePhaseIdForSub, data: { subcontractor_id: newSub.id } });
        toast.success("Subcontractor instantly assigned to phase");
      }
      
      setSubForm({ name: "", contact_name: "", category: "General", email: "", phone: "" });
      setActivePhaseIdForSub(null);
    },
    onError: (err) => toast.error(`Failed to add subcontractor: ${err.message}`)
  });

  const sortedPhases = [...phases].sort((a, b) => a.phase_order - b.phase_order);
  const today = startOfDay(new Date());

  const handleOpenVendors = () => window.open('/Vendors', '_blank');

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="font-semibold text-slate-800 text-lg">Project Phases</h2>
          <p className="text-xs text-slate-500 mt-1">Break down your timeline, assign leads, and track phase budgets.</p>
        </div>
        <Button size="sm" className="bg-slate-900 hover:bg-slate-800 text-white" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add Phase
        </Button>
      </div>

      <div className="space-y-4">
        {sortedPhases.map(ph => {
          const phaseTasks = tasks.filter(t => t.phase_id === ph.id);
          const completedTasks = phaseTasks.filter(t => t.status === "Done").length;
          const autoProgress = phaseTasks.length > 0 ? Math.round((completedTasks / phaseTasks.length) * 100) : 0;
          
          let durationText = "No dates set";
          let varianceWarning = null;
          
          const startTargetDate = safeParseDate(ph.start_date_target);
          const endTargetDate = safeParseDate(ph.end_date_target);

          if (startTargetDate && endTargetDate) {
            const days = differenceInDays(endTargetDate, startTargetDate) + 1;
            durationText = `${days} Day Duration`;
          }

          if (endTargetDate && ph.status !== "Completed" && isAfter(today, endTargetDate)) {
            const daysOver = differenceInDays(today, endTargetDate);
            varianceWarning = `${daysOver} day${daysOver === 1 ? '' : 's'} overdue`;
          }

          const phaseMaterials = materials.filter(m => m.phase_id === ph.id);
          const phaseMaterialCost = phaseMaterials.reduce((sum, m) => {
            const qty = safeNum(m.quantity) || 1; 
            const cost = safeNum(m.cost_actual) || safeNum(m.cost_estimated);
            return sum + (qty * cost);
          }, 0);
          const phaseBudget = safeNum(ph.budget);
          const isOverBudget = phaseBudget > 0 && phaseMaterialCost > phaseBudget;

          const assignedUser = users.find(u => u.id === ph.assigned_to);
          const assignedSub = subcontractors.find(s => s.id === ph.subcontractor_id);

          return (
            <Card key={ph.id} className={`overflow-hidden shadow-sm transition-all border-l-4 ${ph.status === 'Completed' ? 'border-l-emerald-500' : varianceWarning ? 'border-l-red-500' : 'border-l-amber-500'} border-y-slate-200 border-r-slate-200`}>
              <div className="p-4">
                <div className="flex flex-col md:flex-row gap-4 justify-between md:items-center">
                  
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <button onClick={() => setExpanded(e => ({...e, [ph.id]: !e[ph.id]}))} className="text-slate-400 hover:text-slate-700 shrink-0 outline-none bg-slate-50 hover:bg-slate-100 p-1 rounded transition-colors">
                      {expanded[ph.id] ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                    </button>
                    <span className="text-sm font-mono font-semibold text-slate-400 shrink-0 bg-slate-100 px-2 py-0.5 rounded">{ph.phase_order}</span>
                    
                    <div className="flex-1 min-w-0">
                      <Input
                        className="border-0 p-0 h-auto text-base sm:text-lg font-bold text-slate-900 focus-visible:ring-0 bg-transparent truncate"
                        value={ph.name || ""}
                        onChange={e => updatePhase.mutate({ id: ph.id, data: { name: e.target.value } })}
                        onBlur={() => toast.success("Phase name updated")}
                        placeholder="Phase Name..."
                      />
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        {varianceWarning ? (
                          <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs font-semibold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                            <AlertTriangle className="h-3 w-3 shrink-0" /> {varianceWarning}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs text-slate-500">
                            <CalendarDays className="h-3 w-3 shrink-0" /> {durationText}
                          </span>
                        )}
                        
                        {assignedUser && (
                          <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
                            <User className="h-3 w-3 shrink-0" /> Lead: {assignedUser.full_name || assignedUser.email}
                          </span>
                        )}

                        {assignedSub && (
                          <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs text-blue-700 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full">
                            <HardHat className="h-3 w-3 shrink-0" /> Sub: {assignedSub.name || assignedSub.contact_name}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3 md:w-auto w-full md:justify-end justify-between pl-12 md:pl-0">
                    <div className="flex flex-col items-end">
                      <Select value={ph.status || "Not Started"} onValueChange={v => {
                        updatePhase.mutate({ id: ph.id, data: { status: v } });
                        if (v === "Completed") toast.success(`${ph.name} marked as Completed!`);
                      }}>
                        <SelectTrigger className={`w-32 h-8 text-xs font-semibold ${ph.status === 'Completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-white'}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["Not Started","In Progress","Blocked","Completed"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      
                      <div className="flex items-center gap-2 mt-2 w-full justify-end">
                        <span className="text-xs text-slate-500 whitespace-nowrap">{completedTasks}/{phaseTasks.length} Tasks</span>
                        <div className="w-16 bg-slate-100 rounded-full h-2 overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-500 ${autoProgress === 100 ? 'bg-emerald-500' : 'bg-amber-400'}`} style={{ width: `${autoProgress}%` }} />
                        </div>
                      </div>
                    </div>

                    <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-400 hover:bg-red-50 hover:text-red-600 shrink-0" onClick={() => {
                      if(window.confirm("Are you sure you want to delete this phase? All tasks will be unlinked.")) {
                        deletePhase.mutate(ph.id);
                      }
                    }}>
                      <Trash2 className="h-4 w-4 shrink-0" />
                    </Button>
                  </div>
                </div>
              </div>

              {expanded[ph.id] && (
                <div className="border-t border-slate-100 bg-slate-50/80 p-4 md:p-6 space-y-6">
                  
                  <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    
                    {/* Schedule Tracker */}
                    <div className="lg:col-span-2 space-y-3 bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
                      <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5 border-b pb-2">
                        <CalendarDays className="h-3.5 w-3.5 text-blue-500 shrink-0"/> Schedule Tracker
                      </h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label className="text-xs text-slate-600">Target Start</Label>
                          <Input type="date" className="mt-1 h-9 text-sm bg-slate-50 w-full" value={ph.start_date_target || ""} onChange={e => updatePhase.mutate({ id: ph.id, data: { start_date_target: e.target.value } })} />
                        </div>
                        <div>
                          <Label className="text-xs text-slate-600">Target End</Label>
                          <Input type="date" className="mt-1 h-9 text-sm bg-slate-50 w-full" value={ph.end_date_target || ""} onChange={e => updatePhase.mutate({ id: ph.id, data: { end_date_target: e.target.value } })} />
                        </div>
                        <div>
                          <Label className="text-xs text-slate-600">Actual Start</Label>
                          <Input type="date" className="mt-1 h-9 text-sm bg-slate-50 w-full" value={ph.start_date_actual || ""} onChange={e => updatePhase.mutate({ id: ph.id, data: { start_date_actual: e.target.value } })} />
                        </div>
                        <div>
                          <Label className="text-xs text-slate-600">Actual End</Label>
                          <Input type="date" className="mt-1 h-9 text-sm bg-slate-50 w-full" value={ph.end_date_actual || ""} onChange={e => updatePhase.mutate({ id: ph.id, data: { end_date_actual: e.target.value } })} />
                        </div>
                      </div>
                    </div>

                    {/* Phase Ownership */}
                    <div className="lg:col-span-1 space-y-3 bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
                      <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5 border-b pb-2">
                        <User className="h-3.5 w-3.5 text-purple-500 shrink-0"/> Phase Ownership
                      </h4>
                      <div>
                        <Label className="text-xs text-slate-600">Assigned Lead / Foreman</Label>
                        <Select value={ph.assigned_to || "none"} onValueChange={v => updatePhase.mutate({ id: ph.id, data: { assigned_to: v } })}>
                          <SelectTrigger className="mt-1 h-9 text-sm bg-slate-50"><SelectValue placeholder="Select team member..." /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">— Internal Team —</SelectItem>
                            {users.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name || u.email}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="pt-2 border-t border-slate-100 mt-3">
                        <Label className="text-xs text-slate-600 flex justify-between">
                          <span>Subcontractor</span>
                          <button onClick={() => { setActivePhaseIdForSub(ph.id); setSubDialogOpen(true); }} className="text-[10px] text-amber-600 hover:text-amber-700 font-bold hover:underline">
                            + Quick Add
                          </button>
                        </Label>
                        <Select value={ph.subcontractor_id || "none"} onValueChange={v => {
                            if (v === "create_new") {
                              setActivePhaseIdForSub(ph.id);
                              setSubDialogOpen(true);
                              return;
                            }
                            updatePhase.mutate({ id: ph.id, data: { subcontractor_id: v === "none" ? null : v } });
                        }}>
                          <SelectTrigger className="mt-1 h-9 text-sm bg-slate-50"><SelectValue placeholder="Select Subcontractor..." /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">— No Subcontractor —</SelectItem>
                            {subcontractors.map(sub => (
                              <SelectItem key={sub.id} value={sub.id}>{sub.name || sub.contact_name}</SelectItem>
                            ))}
                            <SelectItem value="create_new" className="text-amber-600 focus:text-amber-700 focus:bg-amber-50 font-bold">+ Create New Subcontractor</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex items-center gap-2 pt-2">
                        <Switch checked={ph.client_visible} onCheckedChange={v => updatePhase.mutate({ id: ph.id, data: { client_visible: v } })} />
                        <Label className="text-xs cursor-pointer text-slate-600" onClick={() => updatePhase.mutate({ id: ph.id, data: { client_visible: !ph.client_visible } })}>Visible in Client Portal</Label>
                      </div>
                    </div>

                    {/* Micro-Costing */}
                    <div className={`lg:col-span-1 space-y-3 p-4 rounded-lg border shadow-sm ${isOverBudget ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'}`}>
                      <h4 className={`text-xs font-bold uppercase tracking-wide flex items-center gap-1.5 border-b pb-2 ${isOverBudget ? 'text-red-800 border-red-200' : 'text-slate-800 border-slate-100'}`}>
                        <DollarSign className={`h-3.5 w-3.5 shrink-0 ${isOverBudget ? 'text-red-500' : 'text-emerald-500'}`}/> Micro-Costing
                      </h4>
                      <div>
                        <Label className="text-xs text-slate-600">Phase Budget</Label>
                        <div className="relative mt-1">
                          <span className="absolute left-3 top-2.5 text-slate-500 text-sm">$</span>
                          <Input type="number" className="h-9 text-sm pl-7 bg-slate-50 w-full" value={ph.budget || ""} onChange={e => updatePhase.mutate({ id: ph.id, data: { budget: Number(e.target.value) } })} placeholder="0.00" />
                        </div>
                      </div>
                      <div className="flex justify-between items-center pt-1">
                        <span className="text-xs font-medium text-slate-500">Material Costs:</span>
                        <span className={`text-sm font-bold ${isOverBudget ? 'text-red-600' : 'text-slate-900'}`}>${phaseMaterialCost.toLocaleString()}</span>
                      </div>
                      {phaseBudget > 0 && (
                        <Progress value={Math.min(100, (phaseMaterialCost / phaseBudget) * 100)} className={`h-1.5 ${isOverBudget ? '[&>div]:bg-red-500' : '[&>div]:bg-emerald-500'}`} />
                      )}
                    </div>
                  </div>
                  
                  {/* Row 2: Notes & Associated Items */}
                  <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    <div className="lg:col-span-3">
                      <Label className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 block">Internal Phase Notes</Label>
                      <Textarea 
                        className="text-sm bg-white border-slate-200 min-h-[100px]" 
                        value={localNotes[ph.id] !== undefined ? localNotes[ph.id] : (ph.internal_notes || "")} 
                        onChange={e => setLocalNotes(prev => ({ ...prev, [ph.id]: e.target.value }))}
                        onBlur={(e) => {
                          const newValue = e.target.value;
                          if (newValue !== ph.internal_notes) {
                            updatePhase.mutate({ id: ph.id, data: { internal_notes: newValue } });
                            toast.success("Notes saved");
                          }
                        }} 
                        placeholder="Add specific instructions, gate codes, or private notes for the foreman here..." 
                      />
                    </div>

                    <div className="lg:col-span-1 bg-white border border-slate-200 rounded-lg p-4 flex flex-col shadow-sm">
                      <div className="flex gap-4 border-b border-slate-100 pb-3 mb-3">
                        <div className="flex-1">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Tasks Linked</span>
                          <span className="text-xl font-light text-slate-900">{phaseTasks.length}</span>
                        </div>
                        <div className="flex-1 border-l border-slate-100 pl-4">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Milestones</span>
                          <span className="text-xl font-light text-slate-900">{milestones.filter(m => m.phase_id === ph.id).length}</span>
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-auto leading-relaxed">
                        Use the <strong className="text-slate-500">Quick Add</strong> menu on the Overview tab to link tasks or materials.
                      </p>
                    </div>
                  </div>

                </div>
              )}
            </Card>
          );
        })}
      </div>

      {phases.length === 0 && (
        <div className="text-center bg-white border border-slate-200 border-dashed rounded-xl py-12 shadow-sm">
          <GitBranch className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-600 mb-1">No phases added yet</p>
          <p className="text-xs text-slate-400 mb-4">Break your project down into manageable stages.</p>
          <Button size="sm" className="bg-slate-900 hover:bg-slate-800" onClick={() => setAddOpen(true)}>Add First Phase</Button>
        </div>
      )}

      {/* ⚡ NEW: Inline Add Subcontractor Dialog */}
      <Dialog open={subDialogOpen} onOpenChange={setSubDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Quick Add Subcontractor</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-4">
            <div>
              <Label>Company / Name *</Label>
              <Input value={subForm.name} onChange={e => setSubForm({...subForm, name: e.target.value})} placeholder="e.g. Acme Plumbing" className="mt-1" />
            </div>
            <div>
              <Label>Contact Person</Label>
              <Input value={subForm.contact_name} onChange={e => setSubForm({...subForm, contact_name: e.target.value})} placeholder="e.g. John Doe" className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Trade Category</Label>
                <Select value={subForm.category} onValueChange={v => setSubForm({...subForm, category: v})}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={subForm.phone} onChange={e => setSubForm({...subForm, phone: e.target.value})} className="mt-1" placeholder="(555) 123-4567" />
              </div>
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={subForm.email} onChange={e => setSubForm({...subForm, email: e.target.value})} className="mt-1" placeholder="contact@example.com" />
            </div>
            <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
              <Button variant="outline" onClick={() => setSubDialogOpen(false)}>Cancel</Button>
              <Button className="bg-slate-900 text-white" onClick={() => createSubMutation.mutate(subForm)} disabled={!subForm.name || createSubMutation.isPending}>
                {createSubMutation.isPending ? "Saving..." : "Save & Assign"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Phase Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Add New Phase</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>Phase Name *</Label>
              <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="e.g. Rough-in Plumbing" />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Order / Sequence</Label>
                <Input type="number" value={form.phase_order} onChange={e => setForm({...form, phase_order: Number(e.target.value)})} />
              </div>
              <div>
                <Label>Phase Budget</Label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-500 text-sm">$</span>
                  <Input type="number" className="pl-7" value={form.budget || ""} onChange={e => setForm({...form, budget: Number(e.target.value)})} placeholder="0.00" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Target Start Date</Label>
                <Input type="date" className="h-9 w-full px-2" value={form.start_date_target} onChange={e => setForm({...form, start_date_target: e.target.value})} />
              </div>
              <div>
                <Label>Target End Date</Label>
                <Input type="date" className="h-9 w-full px-2" value={form.end_date_target} onChange={e => setForm({...form, end_date_target: e.target.value})} />
              </div>
            </div>
            
            <div>
              <Label className="flex justify-between items-center">
                <span>Assign Subcontractor</span>
                <button type="button" onClick={() => {
                  setActivePhaseIdForSub("new_phase_form");
                  setSubDialogOpen(true);
                }} className="text-amber-600 hover:text-amber-700 hover:underline text-xs font-bold">
                  + Quick Add
                </button>
              </Label>
              <Select value={form.subcontractor_id || "none"} onValueChange={v => {
                  if (v === "create_new") {
                    setActivePhaseIdForSub("new_phase_form");
                    setSubDialogOpen(true);
                  } else {
                    setForm({...form, subcontractor_id: v});
                  }
              }}>
                <SelectTrigger className="mt-1 bg-white">
                  <SelectValue placeholder="Select Subcontractor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— No Subcontractor —</SelectItem>
                  {subcontractors.map(sub => (
                    <SelectItem key={sub.id} value={sub.id}>{sub.name || sub.contact_name}</SelectItem>
                  ))}
                  <SelectItem value="create_new" className="text-amber-600 focus:text-amber-700 focus:bg-amber-50 font-bold">+ Create New Subcontractor</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
              <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button className="bg-slate-900 hover:bg-slate-800 text-white" onClick={() => createPhase.mutate({ ...form, status: "Not Started" })} disabled={!form.name || createPhase.isPending}>
                {createPhase.isPending ? "Creating..." : "Create Phase"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
