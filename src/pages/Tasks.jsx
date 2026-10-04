import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { 
  ListChecks, Search, Calendar, AlertCircle, ChevronLeft, ChevronRight, 
  Plus, Edit2, Trash2, Flame, CalendarPlus, MoreVertical, Building2, User, Hammer, ClipboardList, Clock
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { format, parseISO, isValid } from "date-fns";
import CreateTaskDialog from "../components/tasks/CreateTaskDialog"; 

const STATUSES = ["To Do", "Doing", "Blocked", "Done", "Pending", "Active", "Under Review", "Completed"];
const PRIORITIES = ["Low", "Medium", "High", "Urgent"];
const TASK_TYPES = ["General", "Request for Quote", "Request for Pricing", "Site Visit", "Follow Up", "Administrative", "Other"];
const ITEMS_PER_PAGE = 15;

const safeParseDate = (dateString) => {
  if (!dateString) return null;
  const parsed = parseISO(dateString);
  return isValid(parsed) ? parsed : null;
};

const normalizeStatus = (dbStatus) => {
  const s = dbStatus?.toLowerCase() || "";
  if (s.includes("to do") || s === "pending") return "Pending";
  if (s.includes("progress") || s.includes("active") || s.includes("doing")) return "Active";
  if (s.includes("review") || s.includes("blocked")) return "Under Review";
  if (s.includes("done") || s.includes("complete")) return "Completed";
  return "Pending";
};

const getPriorityColor = (priority) => {
  switch (priority?.toLowerCase()) {
    case "urgent": return "text-white bg-red-600 border-red-700 shadow-md ring-2 ring-red-200 animate-pulse";
    case "high": return "text-red-800 bg-red-100 border-red-300";
    case "medium": return "text-amber-800 bg-amber-100 border-amber-300";
    case "low": return "text-green-800 bg-green-100 border-green-300";
    default: return "text-slate-600 bg-slate-100 border-slate-200";
  }
};

const getClientName = (c) => {
  if (!c) return "Unknown Client";
  if (c.name && c.name.trim() !== "") return c.name;
  const fullName = [c.first_name, c.surname].filter(Boolean).join(" ");
  if (fullName && fullName.trim() !== "") return fullName;
  if (c.primary_contact_name && c.primary_contact_name.trim() !== "") return c.primary_contact_name;
  return "Unnamed Client";
};

const getProjectName = (p) => {
  if (!p) return "Unknown Project";
  if (p.name && p.name.trim() !== "") return p.name;
  if (p.project_number) return `Project #${p.project_number}`;
  return "Unnamed Project";
};

export default function Tasks() {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all"); 
  const [currentPage, setCurrentPage] = useState(1);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [viewingTask, setViewingTask] = useState(null);

  const [editForm, setEditForm] = useState({
    id: null,
    title: "",
    description: "",
    client_id: "none",
    project_id: "none",
    lead_id: "none",
    vendor_id: "none",
    task_type: "General",
    status: "Pending",
    priority: "Medium",
    due_date: "",
    estimated_hours: "",
    assigned_to: "none",
    source_table: "tasks" // ⚡ Tracks which table to update
  });

  // --- QUERIES ---
  const { data: companyData } = useQuery({ queryKey: ["company", companyId], enabled: !!companyId, queryFn: async () => (await supabase.from("companies").select("name").eq("id", companyId).single()).data || { name: "Company" }});
  const { data: rawProjects = [] } = useQuery({ queryKey: ["projects", companyId], enabled: !!companyId, queryFn: async () => (await supabase.from("projects").select("id, name, project_number, client_id").eq("company_id", companyId)).data || [] });
  const { data: rawClients = [] } = useQuery({ queryKey: ["clients", companyId], enabled: !!companyId, queryFn: async () => (await supabase.from("clients").select("id, name, first_name, surname, primary_contact_name").eq("company_id", companyId)).data || [] });
  const { data: rawLeads = [] } = useQuery({ queryKey: ["leads", companyId], enabled: !!companyId, queryFn: async () => (await supabase.from("leads").select("id, contact_name").eq("company_id", companyId)).data || [] });
  const { data: rawVendors = [] } = useQuery({ queryKey: ["vendors", companyId], enabled: !!companyId, queryFn: async () => (await supabase.from("vendors").select("id, name").eq("company_id", companyId)).data || [] });
  const { data: rawUsers = [] } = useQuery({ queryKey: ["company_users", companyId], enabled: !!companyId, queryFn: async () => (await supabase.from("profiles").select("id, full_name").eq("company_id", companyId)).data || [] });

  // ⚡ DUAL QUERY: Fetch BOTH CRM Tasks and Project Tasks, then merge them
  const { data: allTasks = [], isLoading } = useQuery({ 
    queryKey: ["all_tasks", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const [crmData, prodData] = await Promise.all([
        supabase.from("tasks").select("*").eq("company_id", companyId),
        supabase.from("project_tasks").select("*").eq("company_id", companyId)
      ]);
      
      const crmTasks = (crmData.data || []).map(t => ({ ...t, source_table: 'tasks' }));
      const prodTasks = (prodData.data || []).map(t => ({ ...t, source_table: 'project_tasks', due_date: t.due_date_target }));

      return [...crmTasks, ...prodTasks].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } 
  });

  // MEMOIZED ARRAYS & MAPS
  const projects = useMemo(() => rawProjects.filter(p => p?.id), [rawProjects]);
  const clients = useMemo(() => rawClients.filter(c => c?.id), [rawClients]);
  const leads = useMemo(() => rawLeads.filter(l => l?.id), [rawLeads]);
  const vendors = useMemo(() => rawVendors.filter(v => v?.id), [rawVendors]);
  const users = useMemo(() => rawUsers.filter(u => u?.id), [rawUsers]);

  const projectMap = useMemo(() => Object.fromEntries(projects.map(p => [p.id, getProjectName(p)])), [projects]);
  const clientMap = useMemo(() => Object.fromEntries(clients.map(c => [c.id, getClientName(c)])), [clients]);
  const leadMap = useMemo(() => Object.fromEntries(leads.map(l => [l.id, l.contact_name])), [leads]);
  const vendorMap = useMemo(() => Object.fromEntries(vendors.map(v => [v.id, v.name])), [vendors]);
  const userMap = useMemo(() => Object.fromEntries(users.map(u => [u.id, u.full_name])), [users]);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("notificationTask");
    const task = allTasks.find(t => t.id === requested);
    if (task) setViewingTask(task);
  }, [allTasks]);

  const safeEditClientId = clients.some(c => String(c.id) === String(editForm.client_id)) ? String(editForm.client_id) : "none";
  const safeEditProjectId = projects.some(p => String(p.id) === String(editForm.project_id)) ? String(editForm.project_id) : "none";
  const safeEditLeadId = leads.some(l => String(l.id) === String(editForm.lead_id)) ? String(editForm.lead_id) : "none";
  const safeEditVendorId = vendors.some(v => String(v.id) === String(editForm.vendor_id)) ? String(editForm.vendor_id) : "none";
  const safeEditAssignedTo = users.some(u => String(u.id) === String(editForm.assigned_to)) ? String(editForm.assigned_to) : "none";
  const safePriority = PRIORITIES.includes(editForm.priority) ? editForm.priority : "Medium";
  const safeStatus = STATUSES.includes(editForm.status) ? editForm.status : "To Do";
  const safeTaskType = TASK_TYPES.includes(editForm.task_type) ? editForm.task_type : "General";

  // --- MUTATIONS ---
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status, source_table }) => await supabase.from(source_table).update({ status }).eq("id", id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["all_tasks"] }); toast.success("Status updated"); }
  });

  const handleCreateSubmit = useMutation({
    mutationFn: async (payload) => {
      // ⚡ ROUTING: Project task or CRM task?
      const tableName = payload.is_project_task ? "project_tasks" : "tasks";
      delete payload.is_project_task; // Remove flag before DB insert

      if (tableName === "project_tasks") {
         payload.due_date_target = payload.due_date; // Project Tasks uses due_date_target
         delete payload.due_date;
         
         if (payload.assigned_to) {
           payload.assigned_to = [payload.assigned_to]; // Project tasks expect an array
         }
      }

      const { error } = await supabase.from(tableName).insert([{ ...payload, company_id: companyId }]);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["all_tasks"] }); setCreateDialogOpen(false); toast.success("Task created!"); },
    onError: (err) => toast.error(`Error: ${err.message}`)
  });

  const handleEditSubmit = useMutation({
    mutationFn: async (payload) => {
      const taskPayload = {
        title: payload.title,
        description: payload.description || null,
        project_id: (!payload.project_id || payload.project_id === "none") ? null : payload.project_id,
        client_id: (!payload.client_id || payload.client_id === "none") ? null : payload.client_id,
        lead_id: (!payload.lead_id || payload.lead_id === "none") ? null : payload.lead_id,
        vendor_id: (!payload.vendor_id || payload.vendor_id === "none") ? null : payload.vendor_id,
        task_type: payload.task_type || "General",
        status: payload.status || "To Do",
        priority: payload.priority || "Medium",
        estimated_hours: payload.estimated_hours ? Number(payload.estimated_hours) : null,
      };

      if (payload.source_table === "project_tasks") {
         taskPayload.due_date_target = payload.due_date || null;
         taskPayload.assigned_to = (!payload.assigned_to || payload.assigned_to === "none") ? null : [payload.assigned_to];
      } else {
         taskPayload.due_date = payload.due_date || null;
         taskPayload.assigned_to = (!payload.assigned_to || payload.assigned_to === "none") ? null : payload.assigned_to;
      }

      const { error } = await supabase.from(payload.source_table).update(taskPayload).eq("id", payload.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["all_tasks"] }); setEditDialogOpen(false); toast.success("Task updated!"); },
    onError: (err) => toast.error(`Error: ${err.message}`)
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async ({ id, source_table }) => await supabase.from(source_table).delete().eq("id", id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["all_tasks"] }); toast.success("Task deleted."); setViewingTask(null); }
  });

  // --- HANDLERS ---
  const openEditModal = (task) => {
    const assigneeVal = Array.isArray(task.assigned_to) && task.assigned_to.length > 0 ? task.assigned_to[0] : task.assigned_to;
    
    setEditForm({
      id: task.id,
      title: task.title || "",
      description: task.description || "",
      project_id: task.project_id ? String(task.project_id) : "none",
      client_id: task.client_id ? String(task.client_id) : "none",
      lead_id: task.lead_id ? String(task.lead_id) : "none",
      vendor_id: task.vendor_id ? String(task.vendor_id) : "none",
      task_type: task.task_type || "General",
      status: task.status || "Pending",
      priority: task.priority || "Medium",
      due_date: task.due_date || task.due_date_target || "",
      estimated_hours: task.estimated_hours || "",
      assigned_to: (assigneeVal && typeof assigneeVal === "string") ? assigneeVal : "none",
      source_table: task.source_table
    });
    setEditDialogOpen(true);
  };

  const handleAddToCalendar = (task) => {
    const targetDate = task.due_date || task.due_date_target;
    if (!targetDate) return toast.error("Please set a target date on this task first!");
    const cleanDate = targetDate.split("T")[0].replace(/-/g, "");
    const projectName = projectMap[task.project_id] || "No Project";
    const title = encodeURIComponent(`Task: ${task.title}`);
    const desc = encodeURIComponent(`${task.description || "No extra details."}\n\nProject: ${projectName}`);
    window.open(`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${cleanDate}/${cleanDate}&details=${desc}`, "_blank");
  };

  // --- FILTERING ---
  const filteredTasks = allTasks.filter(t => {
    const matchSearch = !search || t.title?.toLowerCase().includes(search.toLowerCase());
    const taskStatus = normalizeStatus(t.status);
    let matchStatus = filterStatus === "all" ? true : filterStatus === "unfinished" ? taskStatus !== "Completed" : taskStatus === filterStatus;
    return matchSearch && matchStatus;
  }).sort((a, b) => {
    const aComp = normalizeStatus(a.status) === "Completed";
    const bComp = normalizeStatus(b.status) === "Completed";
    const aDate = safeParseDate(a.due_date || a.due_date_target);
    const bDate = safeParseDate(b.due_date || b.due_date_target);
    const aOverdue = aDate && aDate < new Date() && !aComp;
    const bOverdue = bDate && bDate < new Date() && !bComp;

    if (!aComp && a.priority === "Urgent" && (bComp || b.priority !== "Urgent")) return -1;
    if (!bComp && b.priority === "Urgent" && (aComp || a.priority !== "Urgent")) return 1;
    if (aOverdue && !bOverdue) return -1;
    if (bOverdue && !aOverdue) return 1;
    return 0;
  });

  const totalPages = Math.ceil(filteredTasks.length / ITEMS_PER_PAGE);
  const indexOfLastItem = currentPage * ITEMS_PER_PAGE;
  const indexOfFirstItem = indexOfLastItem - ITEMS_PER_PAGE;
  const currentItems = filteredTasks.slice(indexOfFirstItem, indexOfLastItem);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4 md:space-y-6">
      
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row justify-between gap-4 items-start sm:items-end">
        <div>
          <h1 className="text-xl md:text-3xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <ListChecks className="h-6 w-6 md:h-7 md:w-7 text-amber-500" /> {companyData?.name || "Company"} Action Items
          </h1>
          <p className="text-xs md:text-sm font-bold text-slate-500 mt-1 uppercase tracking-wider">{filteredTasks.length} matching tasks across all projects</p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)} className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold shadow-md shrink-0 w-full sm:w-auto">
          <Plus className="h-4 w-4 mr-2" /> New Task
        </Button>
      </div>

      {/* FILTER BAR */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input 
            placeholder="Search tasks..." 
            value={search} 
            onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }} 
            className="pl-9 w-full bg-white font-medium h-10 border-slate-200" 
          />
        </div>
        <div className="w-full sm:w-[200px]">
          <Select value={filterStatus} onValueChange={(val) => { setFilterStatus(val); setCurrentPage(1); }}>
            <SelectTrigger className="w-full bg-white font-bold h-10 border-slate-200"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Every Status</SelectItem>
              <SelectItem value="unfinished" className="font-bold text-blue-700">All Unfinished Tasks</SelectItem>
              <div className="border-t border-slate-100 my-1"></div>
              {["Pending", "Active", "Under Review", "Completed"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* TASKS LIST */}
      <Card className="overflow-hidden border-slate-200 shadow-sm bg-slate-50 md:bg-white flex flex-col">
        {isLoading ? (
          <div className="flex justify-center items-center py-20">
            <div className="h-8 w-8 border-4 border-amber-200 border-t-amber-500 rounded-full animate-spin"></div>
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="text-center py-16 px-4 bg-white">
            <ListChecks className="h-12 w-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-slate-700">No tasks found</h3>
            <p className="text-sm text-slate-500 mt-1">Check your search spelling or change your filters.</p>
          </div>
        ) : (
          <div className="w-full flex-1 md:pb-4">
            
            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm text-left whitespace-nowrap border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase font-black text-slate-500 tracking-wider">
                  <tr>
                    <th className="px-4 md:px-6 py-3 md:py-4 w-1/3">Action Item</th>
                    <th className="px-4 md:px-6 py-3 md:py-4">Relations</th>
                    <th className="px-4 md:px-6 py-3 md:py-4">Status</th>
                    <th className="px-4 md:px-6 py-3 md:py-4">Priority</th>
                    <th className="px-4 md:px-6 py-3 md:py-4">Target Date</th>
                    <th className="px-4 md:px-6 py-3 md:py-4">Assigned To</th>
                    <th className="px-4 md:px-6 py-3 md:py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {currentItems.map(task => {
                    const targetDate = task.due_date || task.due_date_target;
                    const dueDateObj = safeParseDate(targetDate);
                    const isCompleted = normalizeStatus(task.status) === "Completed";
                    const isOverdue = dueDateObj && dueDateObj < new Date() && !isCompleted;
                    const isUrgent = task.priority?.toLowerCase() === "urgent" && !isCompleted;
                    const isHigh = task.priority?.toLowerCase() === "high" && !isCompleted;

                    let assigneeName = "Unassigned";
                    if (Array.isArray(task.assigned_to) && task.assigned_to.length > 0) {
                      assigneeName = userMap[task.assigned_to[0]] || "Unassigned";
                    } else if (task.assigned_to && typeof task.assigned_to === "string" && task.assigned_to !== "none") {
                      assigneeName = userMap[task.assigned_to] || "Unassigned";
                    }

                    let rowClass = "transition-all hover:bg-slate-50 relative group cursor-pointer";
                    if (isCompleted) rowClass = "transition-all bg-slate-50 opacity-60 relative cursor-pointer";
                    else if (isOverdue) rowClass = "transition-all bg-rose-50/70 hover:bg-rose-100/80 relative group cursor-pointer";
                    else if (isUrgent) rowClass = "transition-all bg-red-50 hover:bg-red-100 relative group cursor-pointer";
                    else if (isHigh) rowClass = "transition-all bg-orange-50/30 hover:bg-orange-50 relative group cursor-pointer";

                    return (
                      <tr key={task.id} className={rowClass} onClick={() => setViewingTask(task)}>
                        <td className="px-4 md:px-6 py-3 md:py-4 relative">
                          {!isCompleted && (isOverdue || isUrgent) && <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-red-600"></div>}
                          {!isCompleted && isHigh && !isOverdue && <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-400"></div>}

                          <div className="flex items-start gap-2 pl-1">
                            {!isCompleted && isUrgent && <Flame className="h-4 w-4 text-red-600 fill-red-600 animate-bounce shrink-0 mt-0.5" />}
                            <div className="text-left w-full">
                              <p className={`font-bold truncate max-w-[200px] md:max-w-[280px] group-hover:text-blue-600 group-hover:underline transition-colors ${isCompleted ? 'text-slate-500 line-through' : (isUrgent || isOverdue) ? 'text-red-900 font-extrabold' : 'text-slate-900'}`}>{task.title}</p>
                              <div className="flex items-center gap-2 mt-1">
                                {task.task_type && task.task_type !== "General" && (
                                  <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${isCompleted ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
                                    {task.task_type}
                                  </span>
                                )}
                                {task.description && <p className={`text-[10px] truncate max-w-[150px] md:max-w-[200px] ${(isUrgent || isOverdue) ? 'text-red-700/70 font-semibold' : 'text-slate-500'}`}>{task.description}</p>}
                              </div>
                            </div>
                          </div>
                        </td>
                        
                        <td className="px-4 md:px-6 py-3 md:py-4">
                          <div className="flex flex-col gap-1 items-start">
                            {task.source_table === "project_tasks" && <Badge variant="outline" className={`text-[9px] uppercase tracking-wider border-blue-200 font-bold bg-blue-50 text-blue-800`}>Production</Badge>}
                            {task.source_table === "tasks" && <Badge variant="outline" className={`text-[9px] uppercase tracking-wider border-slate-200 font-bold bg-slate-50 text-slate-600`}>CRM</Badge>}

                            {task.project_id && <Badge variant="outline" className={`text-[10px] uppercase tracking-wider border-slate-200 mt-1 ${(isUrgent || isOverdue) ? 'bg-white/70 text-red-800 font-bold border-red-200' : 'bg-white'}`}>{projectMap[task.project_id] || "Unknown Project"}</Badge>}
                            {task.client_id && <Badge variant="outline" className="text-[9px] bg-slate-100 text-slate-600 border-slate-200 mt-1">{clientMap[task.client_id] || "Unknown Client"}</Badge>}
                            {task.lead_id && <Badge variant="outline" className="text-[9px] bg-indigo-50 text-indigo-700 border-indigo-200 mt-1">{leadMap[task.lead_id] || "Unknown Lead"}</Badge>}
                          </div>
                        </td>
                        
                        <td className="px-4 md:px-6 py-3 md:py-4" onClick={(e) => e.stopPropagation()}>
                          <Select value={normalizeStatus(task.status)} onValueChange={v => updateStatusMutation.mutate({ id: task.id, status: v, source_table: task.source_table })}>
                            <SelectTrigger className={`w-[130px] h-8 text-xs font-bold ${isCompleted ? 'bg-green-50 text-green-700 border-green-200' : (isUrgent || isOverdue) ? 'bg-white border-red-300 text-red-900 shadow-sm' : 'bg-white'}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {["Pending", "Active", "Under Review", "Completed"].map(s => <SelectItem key={s} value={s} className="text-xs font-bold">{s}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </td>
                        
                        <td className="px-4 md:px-6 py-3 md:py-4">
                          {task.priority ? <Badge variant="outline" className={`text-[10px] uppercase tracking-wider font-black ${getPriorityColor(task.priority)}`}>{task.priority}</Badge> : <span className="text-xs text-slate-400">—</span>}
                        </td>
                        
                        <td className="px-4 md:px-6 py-3 md:py-4">
                          {dueDateObj ? (
                            isOverdue ? (
                              <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-100 text-red-700 border border-red-300 text-xs font-black shadow-sm ring-2 ring-red-100/50 animate-pulse">
                                <AlertCircle className="h-3.5 w-3.5 stroke-[3]" />OVERDUE: {format(dueDateObj, "MMM d")}
                              </div>
                            ) : (
                              <div className={`flex items-center gap-1.5 text-xs font-bold ${isUrgent ? 'text-red-800' : 'text-slate-600'}`}>
                                <Calendar className={`h-3.5 w-3.5 ${isUrgent ? 'text-red-500' : 'text-slate-400'}`} />{format(dueDateObj, "MMM d, yyyy")}
                              </div>
                            )
                          ) : <span className="text-xs text-slate-400 italic">No date</span>}
                        </td>
                        
                        <td className="px-4 md:px-6 py-3 md:py-4">
                          {assigneeName !== "Unassigned" ? (
                            <div className={`inline-block h-7 w-7 rounded-full ring-2 ring-white flex items-center justify-center text-[10px] font-black title ${(isUrgent || isOverdue) ? 'bg-red-200 text-red-900' : 'bg-blue-100 text-blue-800'}`} title={assigneeName}>{assigneeName.charAt(0).toUpperCase()}</div>
                          ) : <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${(isUrgent || isOverdue) ? 'text-red-600 bg-red-100' : 'text-slate-400 bg-slate-100'}`}>Unassigned</span>}
                        </td>

                        <td className="px-4 md:px-6 py-3 md:py-4 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="h-8 w-8 p-0 text-slate-400 hover:text-slate-600 transition-colors">
                                  <span className="sr-only">Open menu</span><MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-40">
                                <DropdownMenuItem onClick={() => handleAddToCalendar(task)} className="cursor-pointer text-emerald-600 font-medium"><CalendarPlus className="h-4 w-4 mr-2" /> Calendar</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => openEditModal(task)} className="cursor-pointer text-blue-600 font-medium"><Edit2 className="h-4 w-4 mr-2" /> Edit Task</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => { if(window.confirm("Delete this task?")) deleteTaskMutation.mutate({ id: task.id, source_table: task.source_table }); }} className="cursor-pointer text-red-600 focus:text-red-600 font-medium"><Trash2 className="h-4 w-4 mr-2" /> Delete</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden flex flex-col gap-3 p-3">
              {currentItems.map(task => {
                const targetDate = task.due_date || task.due_date_target;
                const dueDateObj = safeParseDate(targetDate);
                const isCompleted = normalizeStatus(task.status) === "Completed";
                const isOverdue = dueDateObj && dueDateObj < new Date() && !isCompleted;
                const isUrgent = task.priority?.toLowerCase() === "urgent" && !isCompleted;
                const isHigh = task.priority?.toLowerCase() === "high" && !isCompleted;

                let cardClass = "bg-white p-4 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden cursor-pointer";
                if (isCompleted) cardClass = "bg-slate-50 p-4 rounded-xl border border-slate-200 opacity-70 relative overflow-hidden cursor-pointer";
                else if (isOverdue) cardClass = "bg-rose-50 p-4 rounded-xl border border-rose-200 shadow-sm relative overflow-hidden cursor-pointer";
                else if (isUrgent) cardClass = "bg-red-50 p-4 rounded-xl border border-red-200 shadow-sm relative overflow-hidden cursor-pointer";
                else if (isHigh) cardClass = "bg-amber-50/50 p-4 rounded-xl border border-amber-200 shadow-sm relative overflow-hidden cursor-pointer";

                return (
                  <div key={task.id} className={cardClass} onClick={() => setViewingTask(task)}>
                    {!isCompleted && (isOverdue || isUrgent) && <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-red-600"></div>}
                    {!isCompleted && isHigh && !isOverdue && <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-400"></div>}

                    <div className="pl-2">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex flex-col items-start pr-2 w-full text-left">
                          <div className="flex items-center gap-2">
                            {!isCompleted && isUrgent && <Flame className="h-4 w-4 text-red-600 fill-red-600 animate-bounce shrink-0" />}
                            <h3 className={`font-bold text-base line-clamp-2 ${isCompleted ? 'text-slate-500 line-through' : (isUrgent || isOverdue) ? 'text-red-900 font-extrabold' : 'text-slate-900'}`}>{task.title}</h3>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            {task.source_table === "project_tasks" && <Badge variant="outline" className={`text-[9px] uppercase tracking-wider border-blue-200 font-bold bg-blue-50 text-blue-800`}>Production</Badge>}
                            {task.source_table === "tasks" && <Badge variant="outline" className={`text-[9px] uppercase tracking-wider border-slate-200 font-bold bg-slate-50 text-slate-600`}>CRM</Badge>}
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" onClick={() => handleAddToCalendar(task)} className="h-7 w-7 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"><CalendarPlus className="h-3.5 w-3.5" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => openEditModal(task)} className="h-7 w-7 text-slate-400 hover:text-blue-600 hover:bg-blue-50"><Edit2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 mb-3 mt-2">
                        {task.project_id && <Badge variant="outline" className={`text-[10px] uppercase tracking-wider ${(isUrgent || isOverdue) ? 'bg-white/70 text-red-800 border-red-200' : 'bg-white'}`}>{projectMap[task.project_id] || "Project"}</Badge>}
                        {task.client_id && <Badge variant="outline" className="text-[10px] uppercase tracking-wider bg-slate-100 text-slate-700 border-slate-300">{clientMap[task.client_id] || "Client"}</Badge>}
                        {task.priority && <Badge variant="outline" className={`text-[10px] uppercase tracking-wider font-black ${getPriorityColor(task.priority)}`}>{task.priority}</Badge>}
                      </div>

                      <div className="flex items-center justify-between border-t border-slate-100/50 pt-3" onClick={e => e.stopPropagation()}>
                        <Select value={normalizeStatus(task.status)} onValueChange={v => updateStatusMutation.mutate({ id: task.id, status: v, source_table: task.source_table })}>
                          <SelectTrigger className={`w-[110px] h-8 text-xs font-bold ${isCompleted ? 'bg-green-50 text-green-700 border-green-200' : (isUrgent || isOverdue) ? 'bg-white border-red-300 text-red-900' : 'bg-white'}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {["Pending", "Active", "Under Review", "Completed"].map(s => <SelectItem key={s} value={s} className="text-xs font-bold">{s}</SelectItem>)}
                          </SelectContent>
                        </Select>

                        {dueDateObj ? (
                          isOverdue ? (
                            <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-red-100 text-red-700 border border-red-300 text-[10px] font-black animate-pulse"><AlertCircle className="h-3 w-3 stroke-[3]" />DUE {format(dueDateObj, "MMM d")}</div>
                          ) : (
                            <div className={`flex items-center gap-1.5 text-xs font-bold ${isUrgent ? 'text-red-800' : 'text-slate-600'}`}><Calendar className={`h-3.5 w-3.5 ${isUrgent ? 'text-red-500' : 'text-slate-400'}`} />{format(dueDateObj, "MMM d, yyyy")}</div>
                          )
                        ) : <span className="text-[10px] text-slate-400 italic">No date</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* PAGINATION */}
        {!isLoading && filteredTasks.length > 0 && (
          <div className="border-t border-slate-200 bg-white md:bg-slate-50 px-4 md:px-6 py-3 flex items-center justify-between mt-auto">
            <span className="text-xs font-medium text-slate-500 hidden sm:inline-block">
              Showing <span className="font-bold text-slate-900">{indexOfFirstItem + 1}</span> to <span className="font-bold text-slate-900">{Math.min(indexOfLastItem, filteredTasks.length)}</span> of <span className="font-bold text-slate-900">{filteredTasks.length}</span>
            </span>
            <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
              <Button variant="outline" size="sm" className="h-8 bg-white font-bold" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}><ChevronLeft className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">Previous</span></Button>
              <span className="text-xs font-bold text-slate-600 sm:hidden">Page {currentPage} of {totalPages || 1}</span>
              <Button variant="outline" size="sm" className="h-8 bg-white font-bold" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages || totalPages === 0}><span className="hidden sm:inline">Next</span><ChevronRight className="h-4 w-4 sm:ml-1" /></Button>
            </div>
          </div>
        )}
      </Card>

      {/* VIEW FULL DETAILS DIALOG */}
      <Dialog open={!!viewingTask} onOpenChange={(val) => !val && setViewingTask(null)}>
        <DialogContent className="sm:max-w-2xl w-[95vw] rounded-xl p-0 overflow-hidden bg-white" aria-describedby={undefined}>
          
          <div className="p-6 bg-slate-50 border-b border-slate-200">
            <DialogHeader>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" className={`text-[10px] uppercase tracking-wider font-black ${getPriorityColor(viewingTask?.priority)}`}>{viewingTask?.priority || "Medium"}</Badge>
                {viewingTask?.source_table === "project_tasks" && <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200 uppercase tracking-wider font-bold">Production Task</Badge>}
                {viewingTask?.source_table === "tasks" && <Badge variant="outline" className="text-[10px] bg-slate-100 text-slate-600 border-slate-200 uppercase tracking-wider font-bold">CRM Task</Badge>}
              </div>
              <DialogTitle className="text-2xl font-black text-slate-900 leading-tight">
                {viewingTask?.title}
              </DialogTitle>
            </DialogHeader>
          </div>

          <div className="p-6 space-y-6">
            
            {/* Metadata Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-6 gap-x-4">
              
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1.5"><AlertCircle className="h-3 w-3" /> Status</p>
                <p className="font-semibold text-sm text-slate-800">{normalizeStatus(viewingTask?.status)}</p>
              </div>

              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1.5"><Calendar className="h-3 w-3" /> Due Date</p>
                <p className={`font-semibold text-sm ${(viewingTask?.due_date || viewingTask?.due_date_target) ? 'text-slate-800' : 'text-slate-400 italic'}`}>
                  {(viewingTask?.due_date || viewingTask?.due_date_target) ? format(safeParseDate(viewingTask?.due_date || viewingTask?.due_date_target), "MMMM d, yyyy") : "None"}
                </p>
              </div>

              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1.5"><Clock className="h-3 w-3" /> Est. Hours</p>
                <p className={`font-semibold text-sm ${viewingTask?.estimated_hours ? 'text-slate-800' : 'text-slate-400 italic'}`}>
                  {viewingTask?.estimated_hours ? `${viewingTask.estimated_hours} hrs` : "Not set"}
                </p>
              </div>

              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1.5"><User className="h-3 w-3" /> Assignee</p>
                <p className={`font-semibold text-sm ${(viewingTask?.assigned_to && viewingTask.assigned_to !== "none") ? 'text-blue-700' : 'text-slate-400 italic'}`}>
                  {(() => {
                    if (!viewingTask?.assigned_to || viewingTask.assigned_to === "none") return "Unassigned";
                    const assigneeId = Array.isArray(viewingTask.assigned_to) ? viewingTask.assigned_to[0] : viewingTask.assigned_to;
                    return userMap[assigneeId] || "Unknown User";
                  })()}
                </p>
              </div>

              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1.5"><ClipboardList className="h-3 w-3" /> Project</p>
                <p className={`font-semibold text-sm ${viewingTask?.project_id ? 'text-slate-800' : 'text-slate-400 italic'}`}>
                  {viewingTask?.project_id ? projectMap[viewingTask.project_id] : "None"}
                </p>
              </div>

              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1.5"><Building2 className="h-3 w-3" /> Client</p>
                <p className={`font-semibold text-sm ${viewingTask?.client_id ? 'text-slate-800' : 'text-slate-400 italic'}`}>
                  {viewingTask?.client_id ? clientMap[viewingTask.client_id] : "None"}
                </p>
              </div>

              {viewingTask?.lead_id && (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1.5"><User className="h-3 w-3" /> Lead</p>
                  <p className="font-semibold text-sm text-indigo-700">{leadMap[viewingTask.lead_id] || "Unknown Lead"}</p>
                </div>
              )}

              {viewingTask?.vendor_id && (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1.5"><Hammer className="h-3 w-3" /> Subcontractor</p>
                  <p className="font-semibold text-sm text-emerald-700">{vendorMap[viewingTask.vendor_id] || "Unknown Vendor"}</p>
                </div>
              )}

            </div>

            <div className="pt-4 border-t border-slate-100">
              <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 block">Task Description</Label>
              <div className="text-sm font-medium text-slate-700 whitespace-pre-wrap bg-slate-50 p-4 rounded-xl border border-slate-200 min-h-[80px] max-h-[300px] overflow-y-auto custom-scrollbar">
                {viewingTask?.description || <span className="italic text-slate-400">No description provided for this task.</span>}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row justify-end gap-2 pt-2 mt-4">
              <Button variant="outline" className="w-full sm:w-auto font-bold order-2 sm:order-1" onClick={() => setViewingTask(null)}>Close</Button>
              <Button className="w-full sm:w-auto bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold shadow-sm order-1 sm:order-2" onClick={() => { openEditModal(viewingTask); setViewingTask(null); }}>
                <Edit2 className="h-4 w-4 mr-2" /> Edit Task Details
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* INLINE EDIT TASK DIALOG */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-xl w-[95vw] max-h-[90vh] overflow-y-auto rounded-xl p-4 sm:p-6 bg-slate-50" aria-describedby={undefined}>
          <DialogHeader><DialogTitle className="text-xl font-black text-slate-900">Edit Task</DialogTitle></DialogHeader>
          
          <form onSubmit={(e) => { e.preventDefault(); handleEditSubmit.mutate(editForm); }} className="space-y-4 pt-2">
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2 sm:col-span-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Task Title *</Label>
                <Input value={editForm.title} onChange={e => setEditForm({...editForm, title: e.target.value})} className="font-bold border-slate-200 bg-white" required />
              </div>
              
              <div className="space-y-2 sm:col-span-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Description</Label>
                <Textarea value={editForm.description} onChange={e => setEditForm({...editForm, description: e.target.value})} className="flex min-h-[80px] w-full resize-none font-medium border-slate-200 bg-white" />
              </div>

              <div className="space-y-2 border border-slate-200 bg-white p-3 rounded-xl col-span-2 sm:col-span-1">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Project</Label>
                <Select disabled={editForm.source_table !== "project_tasks"} value={safeEditProjectId} onValueChange={v => setEditForm({...editForm, project_id: v})}>
                  <SelectTrigger className="font-medium border-slate-200 text-sm"><SelectValue placeholder="Select Project" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Project</SelectItem>
                    {projects.map((p) => {
                      const projectClient = clients.find(c => String(c.id) === String(p.client_id));
                      const clientName = projectClient ? getClientName(projectClient) : "";
                      return (
                        <SelectItem key={String(p.id)} value={String(p.id)}>
                          {getProjectName(p)} {clientName ? `— ${clientName}` : ""}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 border border-slate-200 bg-white p-3 rounded-xl col-span-2 sm:col-span-1">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Client</Label>
                <Select disabled={editForm.source_table === "project_tasks"} value={safeEditClientId} onValueChange={v => setEditForm({...editForm, client_id: v})}>
                  <SelectTrigger className="font-medium border-slate-200 text-sm">
                    <SelectValue placeholder="Select Client" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Client</SelectItem>
                    {clients.map((c) => (
                      <SelectItem key={String(c.id)} value={String(c.id)}>
                        {getClientName(c)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 border border-slate-200 bg-white p-3 rounded-xl col-span-2 sm:col-span-1">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Lead</Label>
                <Select disabled={editForm.source_table === "project_tasks"} value={safeEditLeadId} onValueChange={v => setEditForm({...editForm, lead_id: v})}>
                  <SelectTrigger className="font-medium border-slate-200 text-sm"><SelectValue placeholder="Select Lead" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Lead</SelectItem>
                    {leads.map((l) => (
                      <SelectItem key={String(l.id)} value={String(l.id)}>
                        {l.contact_name || "Unnamed Lead"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 border border-slate-200 bg-white p-3 rounded-xl col-span-2 sm:col-span-1">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Assignee</Label>
                <Select value={safeEditAssignedTo} onValueChange={v => setEditForm({...editForm, assigned_to: v})}>
                  <SelectTrigger className="font-medium border-slate-200 text-sm"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {users.map((u) => (
                      <SelectItem key={String(u.id)} value={String(u.id)}>
                        {u.full_name || "Unknown User"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Priority</Label>
                <Select value={safePriority} onValueChange={v => setEditForm({...editForm, priority: v})}>
                  <SelectTrigger className="font-medium border-slate-200 text-sm bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Status</Label>
                <Select value={safeStatus} onValueChange={v => setEditForm({...editForm, status: v})}>
                  <SelectTrigger className="font-medium border-slate-200 text-sm bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Target Date</Label>
                <Input type="date" value={editForm.due_date || ""} onChange={e => setEditForm({...editForm, due_date: e.target.value})} className="font-medium border-slate-200 text-sm block w-full bg-white" />
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Est. Hours</Label>
                <Input type="number" min="0" step="0.5" value={editForm.estimated_hours || ""} onChange={(e) => setEditForm({ ...editForm, estimated_hours: e.target.value })} className="font-medium border-slate-200 text-sm bg-white" />
              </div>
            </div>

            <DialogFooter className="pt-4 border-t border-slate-200 flex-col sm:flex-row gap-2 sm:gap-0 mt-4">
              <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)} className="w-full sm:w-auto font-bold border-slate-300 order-2 sm:order-1 bg-white">Cancel</Button>
              <Button type="submit" disabled={handleEditSubmit.isPending} className="w-full sm:w-auto bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold shadow-md order-1 sm:order-2">
                {handleEditSubmit.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      
      {/* ⚡ CREATE TASK DIALOG */}
      <CreateTaskDialog 
        open={createDialogOpen} 
        onOpenChange={setCreateDialogOpen} 
      />
    </div>
  );
}