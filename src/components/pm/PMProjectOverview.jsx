import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { format, differenceInDays, parseISO, isValid } from "date-fns";
import { Link } from "react-router-dom";
import { 
  Plus, Target, Package, AlertTriangle, CheckCircle2, TrendingUp, Users, 
  FileText, ChevronDown, ChevronRight, Clock, GitBranch, Zap, Receipt, 
  ShoppingCart, DollarSign, MapPin, Mail, Phone, CalendarRange, Edit2, Trash2, Circle, Download, Image 
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import PMStatusBadge from "./PMStatusBadge";
import StatusBadge from "../shared/StatusBadge";
import { toast } from "sonner";
import ClientProjectPhotos from "./ClientProjectPhotos";

const WEATHER = ["Sunny", "Cloudy", "Rainy", "Snowy", "Windy", "Hot", "Cold"];

const safeNum = (val) => isNaN(Number(val)) ? 0 : Number(val);
const safeParseDate = (dateString) => {
  if (!dateString) return null;
  const parsed = parseISO(dateString);
  return isValid(parsed) ? parsed : null;
};
const formatCurrency = (val) => {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);
};

export default function PMProjectOverview({ project }) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  const [phaseDialog, setPhaseDialog] = useState(false);
  const [taskDialog, setTaskDialog] = useState(false);
  const [matDialog, setMatDialog] = useState(false);
  const [milestoneDialog, setMilestoneDialog] = useState(false);
  const [importDialog, setImportDialog] = useState(false);
  const [noteDialog, setNoteDialog] = useState(false);

  const [phaseForm, setPhaseForm] = useState({ name: "", phase_order: 1 });
  const [taskForm, setTaskForm] = useState({ title: "", priority: "Medium", phase_id: "none", assigned_to: [] });
  const [matForm, setMatForm] = useState({ custom_material_name: "", quantity: 1, unit: "ea", needed_by_date: "", status: "To Order" });
  const [milestoneForm, setMilestoneForm] = useState({ id: null, title: "", due_date_target: "", status: "Pending" });
  const [photosDialogOpen, setPhotosDialogOpen] = useState(false);
  const [importOptions, setImportOptions] = useState({ phases: true, materials: true });
  
  const defaultNoteForm = {
    date: format(new Date(), "yyyy-MM-dd"),
    weather: "",
    crew_on_site: "",
    summary: "",
    blockers: "",
    safety_concerns: "",
    materials_used: ""
  };
  const [noteForm, setNoteForm] = useState(defaultNoteForm);

  // --- QUERIES ---
  const { data: client } = useQuery({
    queryKey: ["client", project?.client_id], enabled: !!project?.client_id,
    queryFn: async () => { const { data } = await supabase.from("clients").select("*").eq("id", project.client_id).single(); return data || null; }
  });
  
  const { data: phases = [] } = useQuery({ 
    queryKey: ["pm_phases", project?.id], enabled: !!project?.id,
    queryFn: async () => { const { data } = await supabase.from("project_phases").select("*").eq("project_id", project.id); return data || []; } 
  });
  
  const { data: milestones = [] } = useQuery({ 
    queryKey: ["pm_milestones", project?.id], enabled: !!project?.id,
    queryFn: async () => { const { data } = await supabase.from("project_milestones").select("*").eq("project_id", project.id); return data || []; } 
  });
  
  const { data: tasks = [] } = useQuery({ 
    queryKey: ["pm_tasks", project?.id], enabled: !!project?.id,
    queryFn: async () => { const { data } = await supabase.from("project_tasks").select("*").eq("project_id", project.id).order('created_at', { ascending: false }); return data || []; } 
  });
  
  const { data: materials = [] } = useQuery({ 
    queryKey: ["pm_materials", project?.id], enabled: !!project?.id,
    queryFn: async () => { const { data } = await supabase.from("project_materials").select("*").eq("project_id", project.id); return data || []; } 
  });
  
  const { data: issues = [] } = useQuery({ 
    queryKey: ["pm_issues", project?.id], enabled: !!project?.id,
    queryFn: async () => { const { data } = await supabase.from("project_issues").select("*").eq("project_id", project.id); return data || []; } 
  });

  const { data: users = [] } = useQuery({ 
    queryKey: ["users", companyId], enabled: !!companyId,
    queryFn: async () => { const { data } = await supabase.from("users").select("*").eq("company_id", companyId); return data || []; } 
  });
  const { data: profiles = [] } = useQuery({ 
    queryKey: ["profiles", companyId], enabled: !!companyId,
    queryFn: async () => { const { data } = await supabase.from("profiles").select("*").eq("company_id", companyId); return data || []; } 
  });
  const allCompanyUsers = users.length > 0 ? users : profiles;

  const { data: projectStaff = [] } = useQuery({
    queryKey: ["project_staff", project?.id], enabled: !!project?.id,
    queryFn: async () => { try { const { data } = await supabase.from("project_staff").select("*").eq("project_id", project.id); return data || []; } catch(e){ return []; } }
  });

  // --- LINKED DOCUMENTS QUERIES ---
  const { data: linkedQuotes = [] } = useQuery({
    queryKey: ["linked_quotes", project?.id, project?.quote_id], enabled: !!project?.id,
    queryFn: async () => {
      if (project.quote_id && project.quote_id !== "none") {
        const { data } = await supabase.from("quotes").select("*").eq("id", project.quote_id);
        if (data && data.length > 0) return data;
      }
      try { const { data } = await supabase.from("quotes").select("*").eq("project_id", project.id); return data || []; } catch (e) { return []; }
    }
  });

  const { data: linkedCOs = [] } = useQuery({
    queryKey: ["linked_cos", project?.id], enabled: !!project?.id,
    queryFn: async () => { try { const { data } = await supabase.from("change_orders").select("*").eq("project_id", project.id); return data || []; } catch (e) { return []; } }
  });

  const { data: linkedInvoices = [] } = useQuery({
    queryKey: ["linked_invoices", project?.id, project?.invoice_id], enabled: !!project?.id,
    queryFn: async () => {
      if (project.invoice_id && project.invoice_id !== "none") {
        const { data } = await supabase.from("invoices").select("*").eq("id", project.invoice_id);
        if (data && data.length > 0) return data;
      }
      try { const { data } = await supabase.from("invoices").select("*").eq("project_id", project.id); return data || []; } catch (e) { return []; }
    }
  });

  const { data: linkedPOs = [] } = useQuery({
    queryKey: ["linked_pos", project?.id], enabled: !!project?.id,
    queryFn: async () => { try { const { data } = await supabase.from("purchase_orders").select("*").eq("project_id", project.id); return data || []; } catch (e) { return []; } }
  });

  // --- KPI Calculation ---
  const avgProgress = phases.length > 0 ? Math.round(phases.reduce((s, p) => s + (p.percent_complete || 0), 0) / phases.length) : 0;
  const openIssues = issues.filter(i => i.status !== "Resolved" && i.status !== "Closed").length;
  const doneTasks = tasks.filter(t => t.status === "Done").length;
  const daysLeft = safeParseDate(project?.target_end_date) ? differenceInDays(safeParseDate(project.target_end_date), new Date()) : null;
  const totalMaterialCost = materials.reduce((sum, m) => sum + (safeNum(m.cost_actual) || safeNum(m.cost_estimated)), 0);

  // --- SMART IMPORT MUTATION ---
  const importFromQuoteMutation = useMutation({
    mutationFn: async () => {
      if (!project.quote_id || project.quote_id === "none") {
        throw new Error("There is no Quote linked to this project to import from.");
      }

      let phasesInsertedCount = 0;
      let materialsInsertedCount = 0;
      let skippedCount = 0;

      // Fetch quote phases once so both blocks can use it mapping
      const { data: quotePhases, error: phaseErr } = await supabase.from("quote_phases").select("*").eq("quote_id", project.quote_id);
      if (phaseErr) throw new Error("Could not read quote phases: " + phaseErr.message);

      let newProjectPhases = [];

      // 1. IMPORT PHASES
      if (importOptions.phases) {
        if (quotePhases && quotePhases.length > 0) {
          const existingNames = new Set(phases.map(ep => ep.name));
          const phasesToInsert = [];
          
          quotePhases.forEach(p => {
            const phaseName = p.phase_name || p.name || "Unnamed Phase";
            if (existingNames.has(phaseName)) {
              skippedCount++;
            } else {
              phasesToInsert.push({
                company_id: companyId, 
                project_id: project.id, 
                name: phaseName,
                phase_order: p.sort_order || p.phase_order || 1, 
                status: "Not Started", 
                client_visible: true
              });
            }
          });

          if (phasesToInsert.length > 0) {
            // .select() returns the newly created phases so we can map materials to them immediately
            const { data: insertedPhases, error: insertPhaseErr } = await supabase.from("project_phases").insert(phasesToInsert).select();
            if (insertPhaseErr) throw new Error("Failed saving new phases: " + insertPhaseErr.message);
            phasesInsertedCount = phasesToInsert.length;
            newProjectPhases = insertedPhases;
          }
        }
      }

      // 2. IMPORT MATERIALS (WITH FULL LINE DATA & PHASE MAPPING)
      if (importOptions.materials) {
        const { data: quoteItems, error: itemErr } = await supabase.from("quote_line_items").select("*").eq("quote_id", project.quote_id);
        if (itemErr) throw new Error("Could not read quote materials: " + itemErr.message);

        if (quoteItems && quoteItems.length > 0) {
          const materialsToImport = quoteItems.filter(item => item.is_material === true);
          
          if (materialsToImport.length > 0) {
            const existingMatNames = new Set(materials.map(em => em.custom_material_name));
            const materialsToInsert = [];
            
            materialsToImport.forEach(m => {
              if (existingMatNames.has(m.name)) {
                skippedCount++;
              } else {
                
                // ⚡ Match material to the correct Phase!
                let matchedPhaseId = null;
                if (m.phase_id && quotePhases) {
                   const qPhase = quotePhases.find(qp => qp.id === m.phase_id);
                   if (qPhase) {
                      // Check newly inserted phases first, then existing phases
                      const pPhase = newProjectPhases.find(pp => pp.name === qPhase.phase_name) 
                                     || phases.find(pp => pp.name === qPhase.phase_name);
                      if (pPhase) matchedPhaseId = pPhase.id;
                   }
                }

                const hasSeparateCost = Number(m.material_cost || 0) > 0;
                const finalCost = hasSeparateCost ? Number(m.material_cost) : Number(m.unit_cost || 0);

                materialsToInsert.push({
                  company_id: companyId, 
                  project_id: project.id, 
                  phase_id: matchedPhaseId,
                  custom_material_name: m.name,
                  notes: m.description || "", // ⚡ Keeps SKU/Specs from the quote line
                  quantity: m.quantity || 1, 
                  unit: m.unit || "ea", 
                  cost_estimated: finalCost, 
                  status: "To Order",
                  supplier: m.supplier || null,
                  photo_url: m.photo_url || null, // ⚡ Brings over product photo
                  product_id: m.product_id || null // ⚡ Retains root product reference
                });
              }
            });

            if (materialsToInsert.length > 0) {
              const { error: insertMatErr } = await supabase.from("project_materials").insert(materialsToInsert);
              if (insertMatErr) throw new Error("Failed saving new materials: " + insertMatErr.message);
              materialsInsertedCount = materialsToInsert.length;
            }
          }
        }
      }

      if (phasesInsertedCount === 0 && materialsInsertedCount === 0 && skippedCount === 0) {
        throw new Error("No phases or tracked materials found on the attached quote.");
      }

      return { phases: phasesInsertedCount, materials: materialsInsertedCount, skipped: skippedCount };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["pm_phases", project.id] });
      qc.invalidateQueries({ queryKey: ["pm_materials", project.id] });
      setImportDialog(false); 
      
      if (data.phases === 0 && data.materials === 0 && data.skipped > 0) {
        toast.info(`Everything is already imported! (Skipped ${data.skipped} duplicates)`);
      } else {
        const skipMsg = data.skipped > 0 ? ` (Skipped ${data.skipped} duplicates)` : "";
        toast.success(`Imported ${data.phases} phases & ${data.materials} materials!${skipMsg}`);
      }
    },
    onError: (err) => toast.error(err.message)
  });

  // --- ADD NOTE MUTATION PUSHES TO SITE DIARY ---
  const addNoteMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        project_id: project.id,
        company_id: companyId,
        user_id: profile?.id,
        date: noteForm.date || format(new Date(), "yyyy-MM-dd"),
        weather: noteForm.weather || null,
        crew_on_site: noteForm.crew_on_site || null,
        summary: noteForm.summary || null,
        blockers: noteForm.blockers || null,
        safety_concerns: noteForm.safety_concerns || null,
        materials_used: noteForm.materials_used || null
      };

      const { error } = await supabase.from("project_daily_logs").insert([payload]);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project_daily_logs"] });
      setNoteDialog(false);
      setNoteForm(defaultNoteForm);
      toast.success("Note saved to Site Diary!");
    },
    onError: (err) => toast.error(err.message)
  });

  const createTask = useMutation({ 
    mutationFn: async (d) => {
      const payload = { 
        title: d.title, priority: d.priority || "Medium", status: "To Do",
        company_id: companyId, project_id: project.id, 
        phase_id: d.phase_id === "none" ? null : Number(d.phase_id),
        assigned_to: (d.assigned_to || []).length > 0 ? d.assigned_to : null,
      };
      const { error } = await supabase.from("project_tasks").insert([payload]);
      if (error) throw error;
    }, 
    onSuccess: () => { 
      qc.invalidateQueries({ queryKey: ["pm_tasks", project.id] }); 
      setTaskForm({ title: "", priority: "Medium", phase_id: "none", assigned_to: [] });
      setTaskDialog(false); 
      toast.success("Task created successfully!"); 
    },
    onError: (err) => toast.error(err.message)
  });

  const toggleTaskStatus = useMutation({
    mutationFn: async (task) => {
      const newStatus = task.status === "Done" ? "To Do" : "Done";
      const { error } = await supabase.from("project_tasks").update({ status: newStatus }).eq("id", task.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pm_tasks", project.id] })
  });

  const createPhase = useMutation({ 
    mutationFn: async (d) => {
      const { error } = await supabase.from("project_phases").insert([{ ...d, company_id: companyId, project_id: project.id }]);
      if (error) throw error;
    }, 
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pm_phases", project.id] }); setPhaseDialog(false); toast.success("Phase created"); },
    onError: (err) => toast.error(err.message)
  });

  const createMat = useMutation({ 
    mutationFn: async (d) => {
      const { error } = await supabase.from("project_materials").insert([{ ...d, company_id: companyId, project_id: project.id, status: "To Order" }]);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pm_materials", project.id] }); setMatDialog(false); toast.success("Material added"); },
    onError: (err) => toast.error(err.message)
  });

  const saveMilestone = useMutation({ 
    mutationFn: async (payload) => {
      const dbPayload = { 
        title: payload.title, status: payload.status, company_id: companyId, 
        project_id: project.id, due_date_target: payload.due_date_target || null
      };

      if (payload.id) {
        const { error } = await supabase.from("project_milestones").update(dbPayload).eq("id", payload.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("project_milestones").insert([dbPayload]);
        if (error) throw error;
      }
    }, 
    onSuccess: () => { 
      qc.invalidateQueries({ queryKey: ["pm_milestones", project.id] }); 
      setMilestoneDialog(false); 
      setMilestoneForm({ id: null, title: "", due_date_target: "", status: "Pending" });
      toast.success("Milestone saved"); 
    },
    onError: (err) => toast.error(err.message)
  });

  const deleteMilestone = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("project_milestones").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pm_milestones", project.id] }); toast.success("Milestone deleted"); },
    onError: (err) => toast.error(`Delete failed: ${err.message}`)
  });

  const updateProjectStatus = useMutation({
    mutationFn: async (newStatus) => {
      const { error } = await supabase
        .from("projects")
        .update({ status: newStatus })
        .eq("id", project.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      toast.success("Project status updated!");
    },
    onError: (err) => toast.error(`Failed to update status: ${err.message}`)
  });

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">

      {/* HEADER & QUICK ADD */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h1 className="text-2xl font-black text-slate-900 truncate">{project.name || "Project Overview"}</h1>
            <DropdownMenu>
              <DropdownMenuTrigger className="focus:outline-none">
                <div className="hover:opacity-80 transition-opacity cursor-pointer flex items-center gap-1">
                  <PMStatusBadge status={project.status} />
                  <ChevronDown className="h-3 w-3 text-slate-400" />
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-40">
                <DropdownMenuItem onClick={() => updateProjectStatus.mutate("Planning")}>Planning</DropdownMenuItem>
                <DropdownMenuItem onClick={() => updateProjectStatus.mutate("Active")}>Active</DropdownMenuItem>
                <DropdownMenuItem onClick={() => updateProjectStatus.mutate("On Hold")}>On Hold</DropdownMenuItem>
                <DropdownMenuItem onClick={() => updateProjectStatus.mutate("Completed")}>Completed</DropdownMenuItem>
                <DropdownMenuItem onClick={() => updateProjectStatus.mutate("Cancelled")}>Cancelled</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <p className="text-sm font-medium text-slate-500 mt-1">Review top-level health and metrics.</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => {
              if (!project.quote_id || project.quote_id === "none") {
                toast.error("No Quote Attached! Edit the project details to link a Quote first.");
                return;
              }
              setImportDialog(true);
            }} 
            className="bg-white font-bold text-slate-700 shadow-sm border-slate-300 hover:bg-amber-400 hover:text-slate-900 hover:border-amber-500 transition-all disabled:opacity-50"
          >
            <Download className="h-4 w-4 mr-1.5" /> Import Data
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold shadow-sm">
                <Plus className="h-4 w-4 mr-1.5" /> Quick Add <ChevronDown className="h-3 w-3 ml-1 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => { setTaskForm({ title: "", priority: "Medium", phase_id: "none", assigned_to: [] }); setTaskDialog(true); }} className="cursor-pointer font-bold">
                <CheckCircle2 className="h-4 w-4 mr-2 text-amber-600" /> New Task
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPhaseDialog(true)} className="cursor-pointer font-bold">
                <GitBranch className="h-4 w-4 mr-2 text-purple-500" /> New Phase
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setMatDialog(true)} className="cursor-pointer font-bold">
                <Package className="h-4 w-4 mr-2 text-orange-500" /> New Material
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setMilestoneForm({ id: null, title: "", due_date_target: "", status: "Pending" }); setMilestoneDialog(true); }} className="cursor-pointer font-bold">
                <Target className="h-4 w-4 mr-2 text-emerald-500" /> New Milestone
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setNoteForm(defaultNoteForm); setNoteDialog(true); }} className="cursor-pointer font-bold border-t border-slate-100 mt-1 pt-1">
                <Edit2 className="h-4 w-4 mr-2 text-slate-500" /> Project Note
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button 
            size="sm" 
            variant="outline" 
            onClick={() => setPhotosDialogOpen(true)}
            className="bg-white font-bold text-slate-700 shadow-sm border-slate-300 hover:bg-slate-50 transition-all"
          >
            <Image className="h-4 w-4 mr-1.5" /> Project Photos
          </Button>

        </div>
      </div>

      {/* DETAILS */}
      <Card className="p-5 border-slate-200 shadow-sm bg-white">
        <h3 className="text-sm font-bold text-slate-800 mb-4 pb-2 border-b border-slate-100 flex items-center gap-2">
          <FileText className="h-4 w-4 text-slate-400" /> Project Details
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Client Info</p>
            <p className="font-bold text-slate-900 truncate">{client?.name || "No Client Linked"}</p>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Site Address</p>
            <p className="text-sm font-medium text-slate-900">{project.site_address || "No address set"}</p>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Timeline</p>
            <p className="text-sm text-slate-600">Start: {project.start_date ? format(new Date(project.start_date), "MMM d, yyyy") : "—"}</p>
            <p className="text-sm text-slate-600">End: {project.target_end_date ? format(new Date(project.target_end_date), "MMM d, yyyy") : "—"}</p>
          </div>
        </div>
      </Card>

      {/* HEALTH KPIS */}
      <Card className="p-5 border-slate-200 shadow-sm bg-white">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
          <div><span className="text-xs font-bold text-slate-500 block mb-1">PROGRESS</span><div className="text-2xl font-black text-slate-900">{avgProgress}%</div></div>
          <div><span className="text-xs font-bold text-slate-500 block mb-1">TIME LEFT</span><div className="text-2xl font-black text-slate-900">{daysLeft !== null ? `${daysLeft}d` : "—"}</div></div>
          <div><span className="text-xs font-bold text-slate-500 block mb-1">TASKS DONE</span><div className="text-2xl font-black text-slate-900">{doneTasks}/{tasks.length}</div></div>
          <div><span className="text-xs font-bold text-slate-500 block mb-1">OPEN ISSUES</span><div className="text-2xl font-black text-slate-900">{openIssues}</div></div>
          <div><span className="text-xs font-bold text-slate-500 block mb-1">MAT SPENT</span><div className="text-lg font-black text-slate-900">{formatCurrency(totalMaterialCost)}</div></div>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* ACTIVE TASKS LISTING */}
        <Card className="p-5 border-slate-200 shadow-sm bg-white">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-blue-500" /> Active Tasks ({tasks.filter(t => t.status !== "Done").length})
            </h3>
          </div>
          {tasks.filter(t => t.status !== "Done").length > 0 ? (
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
              {tasks.filter(t => t.status !== "Done").map(task => {
                const assignedIds = Array.isArray(task.assigned_to) ? task.assigned_to : (task.assigned_to ? [task.assigned_to] : []);
                const assignedUsers = assignedIds.map(id => allCompanyUsers.find(u => u.id === id)).filter(Boolean);

                return (
                  <div key={task.id} className="flex items-start gap-3 p-2 bg-slate-50 border border-slate-100 rounded-lg">
                    <button onClick={() => toggleTaskStatus.mutate(task)} className="mt-0.5 shrink-0 text-slate-400 hover:text-emerald-500">
                      <Circle className="h-4 w-4" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-900 truncate">{task.title}</p>
                      {task.priority && (
                        <span className={`inline-block mt-1 mr-2 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${task.priority === "Urgent" || task.priority === "High" ? "bg-red-100 text-red-700" : "bg-slate-200 text-slate-600"}`}>
                          {task.priority}
                        </span>
                      )}
                      {assignedUsers.length > 0 && (
                        <span className="text-[10px] text-blue-600 font-bold flex items-center gap-1 mt-1">
                          <Users className="h-3 w-3"/> 
                          {assignedUsers.map(u => u.full_name || u.email).join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-slate-400 italic text-center py-6">No active tasks found.</p>
          )}
        </Card>

        {/* MILESTONES */}
        <Card className="p-5 border-slate-200 shadow-sm bg-white">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <Target className="h-4 w-4 text-emerald-500" /> Project Milestones
            </h3>
            <Button size="sm" variant="ghost" className="h-8 text-xs text-slate-500 hover:text-emerald-600 hover:bg-emerald-50" onClick={() => { setMilestoneForm({ id: null, title: "", due_date_target: "", status: "Pending" }); setMilestoneDialog(true); }}>
              <Plus className="h-3 w-3 mr-1" /> Add Milestone
            </Button>
          </div>
          {milestones.length > 0 ? (
            <div className="space-y-2">
              {milestones.map(m => (
                <div key={m.id} className="p-2 border border-slate-100 rounded-lg bg-slate-50 flex justify-between items-center group">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-900">{m.title}</span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                      <button onClick={() => { setMilestoneForm({ id: m.id, title: m.title, due_date_target: m.due_date_target || "", status: m.status }); setMilestoneDialog(true); }} className="p-1 text-slate-400 hover:text-amber-700 focus-visible:text-amber-700 focus-visible:ring-2 focus-visible:ring-amber-600"><Edit2 className="h-3 w-3"/></button>
                      <button onClick={() => { if(window.confirm("Delete milestone?")) deleteMilestone.mutate(m.id); }} className="p-1 text-slate-400 hover:text-red-600"><Trash2 className="h-3 w-3"/></button>
                    </div>
                  </div>
                  <PMStatusBadge status={m.status} />
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-slate-400 italic text-center py-6">No milestones set.</p>}
        </Card>
      </div>

      {/* --- LINKED DOCUMENTS SECTION --- */}
      <div className="pt-4 space-y-6">
        
        {/* QUOTES STRIP */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2 px-1 border-b border-slate-200 pb-2">
            <FileText className="h-4 w-4 text-slate-500" /> Quotes ({linkedQuotes.length})
          </h3>
          {linkedQuotes.length > 0 ? (
            <div className="grid grid-cols-1 gap-2">
              {linkedQuotes.map(q => (
                <Link key={q.id} to={`/QuoteView?id=${q.id}`}>
                  <Card className="p-3.5 flex items-center justify-between hover:border-slate-400 hover:shadow-sm transition-all cursor-pointer group bg-white">
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 bg-slate-100 rounded-lg flex items-center justify-center shrink-0 group-hover:bg-slate-200 transition-colors"><FileText className="h-5 w-5 text-slate-600" /></div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-slate-900 group-hover:text-slate-700 transition-colors">{q.quote_number || "Draft Quote"}</p>
                          <StatusBadge status={q.status} />
                        </div>
                        <p className="text-sm text-slate-500">{q.title}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-right">
                      <div className="hidden sm:block">
                        <p className="font-black text-slate-900">{formatCurrency(q.total)}</p>
                        <p className="text-xs font-medium text-slate-400">{q.issue_date ? format(new Date(q.issue_date), "MMM d, yyyy") : ""}</p>
                      </div>
                      <ChevronRight className="h-5 w-5 text-slate-300 group-hover:text-slate-500" />
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          ) : <p className="text-xs font-medium text-slate-400 italic px-2">No quotes linked to this project.</p>}
        </div>

        {/* CHANGE ORDERS STRIP */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2 px-1 border-b border-slate-200 pb-2">
            <Zap className="h-4 w-4 text-orange-500" /> Change Orders ({linkedCOs.length})
          </h3>
          {linkedCOs.length > 0 ? (
            <div className="grid grid-cols-1 gap-2">
              {linkedCOs.map(co => (
                <Link key={co.id} to={`/ChangeOrderView?id=${co.id}`}>
                  <Card className="p-3.5 flex items-center justify-between hover:border-orange-400 hover:shadow-sm transition-all cursor-pointer group bg-white">
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 bg-orange-50 rounded-lg flex items-center justify-center shrink-0 group-hover:bg-orange-100 transition-colors"><Zap className="h-5 w-5 text-orange-600" /></div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-slate-900 group-hover:text-orange-700 transition-colors">{co.change_order_number || "Draft CO"}</p>
                          <StatusBadge status={co.status} />
                        </div>
                        <p className="text-sm text-slate-500">{co.title}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-right">
                      <div className="hidden sm:block">
                        <p className="font-black text-slate-900">{formatCurrency(co.total)}</p>
                        <p className="text-xs font-medium text-slate-400">{co.issue_date ? format(new Date(co.issue_date), "MMM d, yyyy") : ""}</p>
                      </div>
                      <ChevronRight className="h-5 w-5 text-slate-300 group-hover:text-orange-500" />
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          ) : <p className="text-xs font-medium text-slate-400 italic px-2">No change orders linked.</p>}
        </div>

        {/* INVOICES STRIP */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2 px-1 border-b border-slate-200 pb-2">
            <Receipt className="h-4 w-4 text-emerald-500" /> Invoices ({linkedInvoices.length})
          </h3>
          {linkedInvoices.length > 0 ? (
            <div className="grid grid-cols-1 gap-2">
              {linkedInvoices.map(inv => (
                <Link key={inv.id} to={`/InvoiceView?id=${inv.id}`}>
                  <Card className="p-3.5 flex items-center justify-between hover:border-emerald-400 hover:shadow-md transition-all cursor-pointer group bg-white border-emerald-100">
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 bg-emerald-50 rounded-lg flex items-center justify-center shrink-0 group-hover:bg-emerald-100 transition-colors"><Receipt className="h-5 w-5 text-emerald-600" /></div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-slate-900 group-hover:text-emerald-700 transition-colors">{inv.invoice_number || "Draft Invoice"}</p>
                          <StatusBadge status={inv.status} />
                        </div>
                        <p className="text-sm text-slate-500">Progress Billing</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-right">
                      <div className="hidden sm:block">
                        <p className="font-black text-emerald-600">{formatCurrency(inv.total)}</p>
                        <p className="text-xs font-medium text-slate-400">Due: {inv.due_date ? format(new Date(inv.due_date), "MMM d, yyyy") : "N/A"}</p>
                      </div>
                      <ChevronRight className="h-5 w-5 text-slate-300 group-hover:text-emerald-500" />
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          ) : <p className="text-xs font-medium text-slate-400 italic px-2">No invoices linked.</p>}
        </div>

        {/* PURCHASE ORDERS STRIP */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2 px-1 border-b border-slate-200 pb-2">
            <ShoppingCart className="h-4 w-4 text-amber-500" /> Purchase Orders ({linkedPOs.length})
          </h3>
          {linkedPOs.length > 0 ? (
            <div className="grid grid-cols-1 gap-2">
              {linkedPOs.map(po => (
                <Link key={po.id} to={`/PurchaseOrderView?id=${po.id}`}>
                  <Card className="p-3.5 flex items-center justify-between hover:border-amber-400 hover:shadow-md transition-all cursor-pointer group bg-white border-amber-100">
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 bg-amber-50 rounded-lg flex items-center justify-center shrink-0 group-hover:bg-amber-100 transition-colors"><ShoppingCart className="h-5 w-5 text-amber-600" /></div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-slate-900 group-hover:text-amber-700 transition-colors">{po.po_number || "Draft PO"}</p>
                          <StatusBadge status={po.status} />
                        </div>
                        <p className="text-sm text-slate-500">Materials Order</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-right">
                      <div className="hidden sm:block">
                        <p className="font-black text-slate-900">{formatCurrency(po.total)}</p>
                        <p className="text-xs font-medium text-slate-400">Exp: {po.expected_delivery_date ? format(new Date(po.expected_delivery_date), "MMM d, yyyy") : "TBD"}</p>
                      </div>
                      <ChevronRight className="h-5 w-5 text-slate-300 group-hover:text-amber-500" />
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          ) : <p className="text-xs font-medium text-slate-400 italic px-2">No purchase orders linked.</p>}
        </div>

      </div>

      {/* --- ALL DIALOGS --- */}
      
      {/* IMPORT DIALOG */}
      <Dialog open={importDialog} onOpenChange={setImportDialog}>
        <DialogContent className="bg-slate-50 border-slate-200 shadow-xl max-w-md" aria-describedby={undefined}>
          <DialogHeader><DialogTitle className="font-black text-xl text-slate-900 flex items-center gap-2"><Download className="h-5 w-5 text-amber-500" /> Import Linked Data</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-sm font-medium text-slate-600">Select what to pull over from the attached Quote.</p>
            
            <label className="flex items-start gap-3 p-4 bg-white border border-slate-200 rounded-xl shadow-sm cursor-pointer hover:border-amber-400 transition-all">
              <input type="checkbox" className="mt-1 w-4 h-4 text-amber-500 rounded border-slate-300 focus:ring-amber-600" checked={importOptions.phases} onChange={e => setImportOptions({...importOptions, phases: e.target.checked})} />
              <div className="flex flex-col">
                <span className="font-black text-slate-800">Import Project Phases</span>
                <span className="text-[11px] font-semibold text-slate-400 mt-0.5">Creates phases exactly as they were structured on the quote.</span>
              </div>
            </label>
            
            <label className="flex items-start gap-3 p-4 bg-white border border-slate-200 rounded-xl shadow-sm cursor-pointer hover:border-amber-400 transition-all">
              <input type="checkbox" className="mt-1 w-4 h-4 text-amber-500 rounded border-slate-300 focus:ring-amber-600" checked={importOptions.materials} onChange={e => setImportOptions({...importOptions, materials: e.target.checked})} />
              <div className="flex flex-col">
                <span className="font-black text-slate-800">Import Tracked Materials</span>
                <span className="text-[11px] font-semibold text-slate-400 mt-0.5">Pulls line items tagged "Track as physical material".</span>
              </div>
            </label>

            <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
              <Button variant="outline" onClick={() => setImportDialog(false)} className="font-bold border-slate-300">Cancel</Button>
              <Button 
                className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md" 
                onClick={() => importFromQuoteMutation.mutate()} 
                disabled={importFromQuoteMutation.isPending || (!importOptions.phases && !importOptions.materials)}
              >
                {importFromQuoteMutation.isPending ? "Importing..." : "Run Import"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* PROJECT NOTE DIALOG */}
      <Dialog open={noteDialog} onOpenChange={setNoteDialog}>
        <DialogContent aria-describedby={undefined} className="max-w-xl max-h-[90vh] overflow-y-auto bg-slate-50">
          <DialogHeader><DialogTitle className="text-xl font-black text-slate-900 flex items-center gap-2"><Edit2 className="h-5 w-5 text-blue-600"/> Add Project Note</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Date *</Label>
                <Input type="date" className="mt-1 bg-white font-medium" value={noteForm.date || ""} onChange={e => setNoteForm({ ...noteForm, date: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Weather</Label>
                <Select value={noteForm.weather || ""} onValueChange={v => setNoteForm({ ...noteForm, weather: v })}>
                  <SelectTrigger className="mt-1 bg-white font-medium"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>{WEATHER.map(w => <SelectItem key={w} value={w}>{w}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Crew on Site</Label>
              <Input className="mt-1 bg-white font-medium" placeholder="E.g. John, Mike, Sarah (or total count)" value={noteForm.crew_on_site || ""} onChange={e => setNoteForm({ ...noteForm, crew_on_site: e.target.value })} />
            </div>

            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Work Completed Today</Label>
              <Textarea className="mt-1 bg-white font-medium" rows={3} placeholder="Describe the work done..." value={noteForm.summary || ""} onChange={e => setNoteForm({ ...noteForm, summary: e.target.value })} />
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider text-orange-600">Issues / Delays</Label>
                <Textarea className="mt-1 bg-white border-orange-200" rows={2} placeholder="Any blockers?" value={noteForm.blockers || ""} onChange={e => setNoteForm({ ...noteForm, blockers: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider text-red-600">Safety Concerns</Label>
                <Textarea className="mt-1 bg-white border-red-200" rows={2} placeholder="Any incidents?" value={noteForm.safety_concerns || ""} onChange={e => setNoteForm({ ...noteForm, safety_concerns: e.target.value })} />
              </div>
            </div>
            
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Materials Used</Label>
              <Input className="mt-1 bg-white font-medium" placeholder="E.g. 5 sheets of drywall" value={noteForm.materials_used || ""} onChange={e => setNoteForm({ ...noteForm, materials_used: e.target.value })} />
            </div>
            
            <div className="flex gap-2 pt-4 border-t border-slate-200 mt-4">
              <Button variant="outline" className="flex-1 font-bold" onClick={() => setNoteDialog(false)}>Cancel</Button>
              <Button className="flex-1 bg-amber-600 hover:bg-amber-500 text-white font-black shadow-md" onClick={() => addNoteMutation.mutate()} disabled={addNoteMutation.isPending}>
                {addNoteMutation.isPending ? "Saving..." : "Add Project Note"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* TASK DIALOG */}
      <Dialog open={taskDialog} onOpenChange={setTaskDialog}>
        <DialogContent aria-describedby={undefined} className="bg-slate-50 border-slate-200 shadow-xl">
          <DialogHeader><DialogTitle className="font-black text-xl">{taskForm.id ? "Edit Task" : "Add Task"}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div><Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Task Title *</Label><Input value={taskForm.title} onChange={e => setTaskForm({...taskForm, title: e.target.value})} placeholder="What needs to be done?" className="bg-white" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Link to Phase</Label>
                <Select value={taskForm.phase_id} onValueChange={v => setTaskForm({...taskForm, phase_id: v})}>
                  <SelectTrigger className="bg-white font-medium"><SelectValue placeholder="Select phase" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— No Phase —</SelectItem>
                    {phases.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Priority</Label>
                <Select value={taskForm.priority} onValueChange={v => setTaskForm({...taskForm, priority: v})}>
                  <SelectTrigger className="bg-white font-medium"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["Low","Medium","High","Urgent"].map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            {/* MULTI-SELECT STAFF CHECKBOXES */}
            <div>
              <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-2 block">Assign Staff (Select Multiple)</Label>
              {projectStaff.length === 0 ? (
                <p className="text-xs text-slate-400 italic">No staff assigned to this project yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {projectStaff.map(ps => {
                    const u = allCompanyUsers.find(user => user.id === ps.user_id);
                    if (!u) return null;
                    
                    const isSelected = (taskForm.assigned_to || []).includes(u.id);

                    return (
                      <div 
                        key={u.id}
                        onClick={() => {
                          if (isSelected) {
                            setTaskForm(f => ({...f, assigned_to: (f.assigned_to || []).filter(id => id !== u.id)}));
                          } else {
                            setTaskForm(f => ({...f, assigned_to: [...(f.assigned_to || []), u.id]}));
                          }
                        }}
                        className={`px-3 py-1.5 rounded-md text-xs font-bold cursor-pointer border shadow-sm transition-colors ${
                          isSelected 
                            ? 'bg-amber-500 text-slate-900 border-amber-500' 
                            : 'bg-white text-slate-600 border-slate-200 hover:border-amber-400 hover:text-slate-900'
                        }`}
                      >
                        {u.full_name || u.email || "Unnamed User"}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
              <Button variant="outline" onClick={() => setTaskDialog(false)} className="font-bold border-slate-300">Cancel</Button>
              <Button className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md" onClick={() => createTask.mutate(taskForm)} disabled={!taskForm.title || createTask.isPending}>
                {createTask.isPending ? "Saving..." : "Save Task"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* MILESTONE DIALOG */}
      <Dialog open={milestoneDialog} onOpenChange={setMilestoneDialog}>
        <DialogContent className="bg-slate-50 border-slate-200 shadow-xl max-w-sm" aria-describedby={undefined}>
          <DialogHeader><DialogTitle className="font-black text-xl flex items-center gap-2"><Target className="h-5 w-5 text-emerald-500" /> {milestoneForm.id ? "Edit Milestone" : "Add Milestone"}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div><Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Milestone Title *</Label><Input value={milestoneForm.title} onChange={e => setMilestoneForm({...milestoneForm, title: e.target.value})} className="bg-white" placeholder="e.g. Rough-in inspection" /></div>
            <div><Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Target Date</Label><Input type="date" value={milestoneForm.due_date_target} onChange={e => setMilestoneForm({...milestoneForm, due_date_target: e.target.value})} className="bg-white font-medium" /></div>
            
            {milestoneForm.id && (
              <div>
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Status</Label>
                <Select value={milestoneForm.status} onValueChange={v => setMilestoneForm({...milestoneForm, status: v})}>
                  <SelectTrigger className="bg-white font-bold"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Pending">Pending</SelectItem>
                    <SelectItem value="In Progress">In Progress</SelectItem>
                    <SelectItem value="Completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
              <Button variant="outline" onClick={() => setMilestoneDialog(false)} className="font-bold border-slate-300">Cancel</Button>
              <Button className="bg-emerald-500 hover:bg-emerald-600 text-white font-black shadow-md" onClick={() => saveMilestone.mutate(milestoneForm)} disabled={!milestoneForm.title || saveMilestone.isPending}>
                {saveMilestone.isPending ? "Saving..." : "Save Milestone"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* MATERIAL DIALOG */}
      <Dialog open={matDialog} onOpenChange={setMatDialog}>
        <DialogContent className="bg-slate-50 border-slate-200 shadow-xl max-w-sm" aria-describedby={undefined}>
          <DialogHeader><DialogTitle className="font-black text-xl flex items-center gap-2"><Package className="h-5 w-5 text-orange-500" /> Add Material</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div><Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Material Name *</Label><Input value={matForm.custom_material_name} onChange={e => setMatForm({...matForm, custom_material_name: e.target.value})} placeholder="e.g. 2x4 Lumber" className="bg-white font-bold" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Quantity</Label><Input type="number" value={matForm.quantity} onChange={e => setMatForm({...matForm, quantity: Number(e.target.value)})} className="bg-white font-black" /></div>
              <div><Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Unit</Label><Input value={matForm.unit} onChange={e => setMatForm({...matForm, unit: e.target.value})} placeholder="ea, sqft..." className="bg-white font-bold uppercase" /></div>
            </div>
            <div><Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Needed By Date *</Label><Input type="date" value={matForm.needed_by_date} onChange={e => setMatForm({...matForm, needed_by_date: e.target.value})} className="bg-white font-medium" /></div>
            <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
              <Button variant="outline" onClick={() => setMatDialog(false)} className="font-bold border-slate-300">Cancel</Button>
              <Button className="bg-orange-500 hover:bg-orange-600 text-white font-black shadow-md" onClick={() => createMat.mutate({ ...matForm, project_id: project.id })} disabled={!matForm.custom_material_name || !matForm.needed_by_date}>
                Add Material
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

{/* PROJECT PHOTOS DIALOG */}
      <Dialog open={photosDialogOpen} onOpenChange={setPhotosDialogOpen}>
        <DialogContent className="max-w-6xl w-full max-h-[90vh] overflow-x-hidden overflow-y-auto bg-slate-50 p-0 border-none sm:rounded-xl">
          {/* Pass the setPhotosDialogOpen down so the component can close itself */}
          <ClientProjectPhotos projectId={project.id} onClose={() => setPhotosDialogOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* PHASE DIALOG */}
      <Dialog open={phaseDialog} onOpenChange={setPhaseDialog}>
        <DialogContent className="bg-slate-50 border-slate-200 shadow-xl max-w-sm" aria-describedby={undefined}>
          <DialogHeader><DialogTitle className="font-black text-xl flex items-center gap-2"><GitBranch className="h-5 w-5 text-purple-500" /> Add Phase</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div><Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Phase Name *</Label><Input value={phaseForm.name} onChange={e => setPhaseForm({...phaseForm, name: e.target.value})} className="bg-white font-bold" placeholder="e.g. Demolition" /></div>
            <div><Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Order / Sequence</Label><Input type="number" value={phaseForm.phase_order} onChange={e => setPhaseForm({...phaseForm, phase_order: Number(e.target.value)})} className="bg-white font-black w-24" /></div>
            <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
              <Button variant="outline" onClick={() => setPhaseDialog(false)} className="font-bold border-slate-300">Cancel</Button>
              <Button className="bg-purple-600 hover:bg-purple-700 text-white font-black shadow-md" onClick={() => createPhase.mutate({ ...phaseForm, project_id: project.id, status: "Not Started", client_visible: true })} disabled={!phaseForm.name}>
                Create Phase
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}