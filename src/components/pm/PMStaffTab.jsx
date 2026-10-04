import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea"; 
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { 
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { 
  Users, Plus, CheckCircle2, Circle, Edit2, Trash2, GitBranch, MoreVertical, ShieldCheck, Calendar
} from "lucide-react";
import { toast } from "sonner";
import CreateTaskDialog from "../tasks/CreateTaskDialog"; 

// --- HELPERS ---
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

const getTaskAssignees = (task) => (
  Array.isArray(task.assigned_to) ? task.assigned_to : task.assigned_to ? [task.assigned_to] : []
).filter(id => id && id !== "none").map(String);

export default function PMStaffTab({ project }) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  const [view, setView] = useState("tasks"); 
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  useEffect(() => { setAssigneeFilter("all"); }, [project?.id]);
  
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [taskForm, setTaskForm] = useState({ 
    id: null, 
    title: "", 
    description: "",
    priority: "Medium", 
    status: "To Do",
    phase_id: "none", 
    client_id: "none",
    project_id: "none",
    assigned_to: [],
    due_date: "",
    estimated_hours: ""
  });

  const [assignDialog, setAssignDialog] = useState(false);
  const [selectedUserToAssign, setSelectedUserToAssign] = useState("none");

  // --- QUERIES ---
  const { data: rawProjects = [] } = useQuery({ 
    queryKey: ["projects", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id, name, project_number, client_id").eq("company_id", companyId);
      return data || [];
    } 
  });

  const { data: rawClients = [] } = useQuery({ 
    queryKey: ["clients", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("id, name, first_name, surname, primary_contact_name").eq("company_id", companyId);
      return data || [];
    } 
  });

  const { data: users = [] } = useQuery({ 
    queryKey: ["users", companyId], 
    enabled: !!companyId,
    queryFn: async () => { 
      const { data } = await supabase.from("users").select("*").eq("company_id", companyId); 
      return data || []; 
    } 
  });

  const { data: profiles = [] } = useQuery({ 
    queryKey: ["profiles", companyId], 
    enabled: !!companyId,
    queryFn: async () => { 
      const { data } = await supabase.from("profiles").select("*").eq("company_id", companyId); 
      return data || []; 
    } 
  });

  const { data: phases = [] } = useQuery({ 
    queryKey: ["pm_phases", project?.id], 
    enabled: !!project?.id,
    queryFn: async () => { 
      const { data } = await supabase.from("project_phases").select("*").eq("project_id", project.id); 
      return data || []; 
    } 
  });

  const { data: tasks = [] } = useQuery({ 
    queryKey: ["pm_tasks", project?.id], 
    enabled: !!project?.id,
    queryFn: async () => { 
      const { data } = await supabase.from("project_tasks").select("*").eq("project_id", project.id).order('created_at', { ascending: false }); 
      return data || []; 
    } 
  });

  const { data: projectStaff = [] } = useQuery({
    queryKey: ["project_staff", project?.id], 
    enabled: !!project?.id,
    queryFn: async () => { 
      try { 
        const { data } = await supabase.from("project_staff").select("*").eq("project_id", project.id); 
        return data || []; 
      } catch (e) { return []; } 
    }
  });

  // --- SAFE MEMOIZED ARRAYS ---
  const projects = useMemo(() => {
    const unique = [];
    const map = new Set();
    for (const p of rawProjects) { if (p?.id && !map.has(p.id)) { map.add(p.id); unique.push(p); } }
    return unique;
  }, [rawProjects]);

  const clients = useMemo(() => {
    const unique = [];
    const map = new Set();
    for (const c of rawClients) { if (c?.id && !map.has(c.id)) { map.add(c.id); unique.push(c); } }
    return unique;
  }, [rawClients]);

  const allCompanyUsers = useMemo(() => {
    return users.length > 0 ? users : profiles;
  }, [users, profiles]);

  const filterUsers = useMemo(() => {
    const directory = new Map();
    for (const user of [...users, ...profiles]) {
      if (user?.id) directory.set(String(user.id), { ...directory.get(String(user.id)), ...user });
    }
    return [...directory.values()].sort((a, b) => (a.full_name || a.email || "Unnamed User").localeCompare(b.full_name || b.email || "Unnamed User"));
  }, [users, profiles]);

  const filteredTasks = useMemo(() => {
    if (assigneeFilter === "all") return tasks;
    const user = filterUsers.find(u => String(u.id) === assigneeFilter);
    return tasks.filter(task => {
      const assigned = getTaskAssignees(task);
      if (assigneeFilter === "unassigned") return assigned.length === 0;
      return assigned.includes(assigneeFilter) || !!(user?.email && assigned.includes(user.email));
    });
  }, [tasks, assigneeFilter, filterUsers]);

  const unassignedCompanyUsers = useMemo(() => {
    return allCompanyUsers.filter(u => !projectStaff.some(ps => ps.user_id === u.id));
  }, [allCompanyUsers, projectStaff]);

  // SAFE IDS FOR EDIT FORM (Prevents Radix UI from crashing)
  const safeEditClientId = clients.some(c => String(c.id) === String(taskForm.client_id)) ? String(taskForm.client_id) : "none";
  const safeEditProjectId = projects.some(p => String(p.id) === String(taskForm.project_id)) ? String(taskForm.project_id) : "none";


  // --- MUTATIONS ---
  const handleCreateSubmit = useMutation({
    mutationFn: async (payload) => {
      const dbPayload = { 
        company_id: companyId,
        project_id: payload.project_id && payload.project_id !== "none" ? payload.project_id : project.id, 
        client_id: payload.client_id && payload.client_id !== "none" ? payload.client_id : null,
        title: payload.title,
        description: payload.description || null,
        priority: payload.priority || "Medium", 
        status: payload.status || "To Do",
        due_date_target: payload.due_date || null,
        estimated_hours: payload.estimated_hours ? Number(payload.estimated_hours) : null,
        assigned_to: payload.assigned_to && payload.assigned_to !== "none" ? [payload.assigned_to] : null,
      };

      const { error } = await supabase.from("project_tasks").insert([dbPayload]);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm_tasks", project.id] });
      setCreateDialogOpen(false);
      toast.success("Task created successfully!");
    },
    onError: (err) => toast.error(`Failed to create task: ${err.message}`)
  });

  const saveEditedTask = useMutation({
    mutationFn: async (payload) => {
      const dbPayload = { 
        title: payload.title,
        description: payload.description || null,
        priority: payload.priority || "Medium", 
        status: payload.status || "To Do",
        phase_id: payload.phase_id === "none" || !payload.phase_id ? null : payload.phase_id,
        client_id: payload.client_id === "none" ? null : payload.client_id,
        project_id: payload.project_id === "none" ? null : payload.project_id,
        due_date_target: payload.due_date || null,
        estimated_hours: payload.estimated_hours ? Number(payload.estimated_hours) : null,
        assigned_to: payload.assigned_to.length > 0 ? payload.assigned_to : null,
      };
      const { error } = await supabase.from("project_tasks").update(dbPayload).eq("id", payload.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm_tasks", project.id] });
      setEditDialogOpen(false);
      toast.success("Task updated successfully!");
    },
    onError: (err) => toast.error(`Failed to update task: ${err.message}`)
  });

  const toggleTaskStatus = useMutation({
    mutationFn: async (task) => {
      const newStatus = task.status === "Done" ? "To Do" : "Done";
      const { error } = await supabase.from("project_tasks").update({ status: newStatus }).eq("id", task.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pm_tasks", project.id] })
  });

  const deleteTask = useMutation({
    mutationFn: async (id) => { 
      const { error } = await supabase.from("project_tasks").delete().eq("id", id); 
      if (error) throw error; 
    },
    onSuccess: () => { 
      qc.invalidateQueries({ queryKey: ["pm_tasks", project.id] }); 
      toast.success("Task deleted."); 
    }
  });

  const assignStaff = useMutation({
    mutationFn: async (userId) => {
      if (userId === "none") return;
      const { error } = await supabase.from("project_staff").insert([{ project_id: project.id, user_id: userId, company_id: companyId }]);
      if (error) throw error;
    },
    onSuccess: () => { 
      qc.invalidateQueries({ queryKey: ["project_staff", project.id] }); 
      setAssignDialog(false);
      setSelectedUserToAssign("none");
      toast.success("Team member assigned to project!"); 
    },
    onError: (err) => toast.error(`Assign failed: ${err.message}`)
  });

  const removeStaff = useMutation({
    mutationFn: async (assignmentId) => { 
      const { error } = await supabase.from("project_staff").delete().eq("id", assignmentId); 
      if (error) throw error; 
    },
    onSuccess: () => { 
      qc.invalidateQueries({ queryKey: ["project_staff", project.id] }); 
      toast.success("Team member removed from project."); 
    }
  });

  const openEditTask = (t) => { 
    let safeAssignedTo = [];
    if (Array.isArray(t.assigned_to)) {
      safeAssignedTo = t.assigned_to;
    } else if (t.assigned_to) {
      safeAssignedTo = [t.assigned_to];
    }
    
    setTaskForm({ 
      id: t.id, 
      title: t.title || "", 
      description: t.description || "",
      priority: t.priority || "Medium", 
      status: t.status || "To Do",
      phase_id: t.phase_id ? String(t.phase_id) : "none", 
      client_id: t.client_id ? String(t.client_id) : "none",
      project_id: t.project_id ? String(t.project_id) : "none",
      assigned_to: safeAssignedTo,
      due_date: t.due_date_target || "",
      estimated_hours: t.estimated_hours || ""
    }); 
    setEditDialogOpen(true); 
  };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-black text-slate-900 flex items-center gap-2 tracking-tight">
            <Users className="h-6 w-6 text-amber-500" /> Staff & Tasks
          </h2>
          <p className="text-sm font-medium text-slate-500 mt-1">Assign company team members and manage their tasks.</p>
        </div>
      </div>

      {/* VIEW TOGGLES */}
      <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg w-full sm:w-max border border-slate-200">
        <button onClick={() => setView("tasks")} className={`min-w-0 flex-1 sm:flex-none justify-center px-2 sm:px-5 py-2 rounded-md text-xs sm:text-sm font-bold flex items-center transition-all ${view === "tasks" ? "bg-white text-amber-700 shadow-sm border border-slate-200/50" : "text-slate-500 hover:text-slate-900 hover:bg-slate-200/50"}`}>
          <CheckCircle2 className="h-4 w-4 mr-2" /> Task Board
        </button>
        <button onClick={() => setView("staff")} className={`min-w-0 flex-1 sm:flex-none justify-center px-2 sm:px-5 py-2 rounded-md text-xs sm:text-sm font-bold flex items-center transition-all ${view === "staff" ? "bg-white text-amber-700 shadow-sm border border-slate-200/50" : "text-slate-500 hover:text-slate-900 hover:bg-slate-200/50"}`}>
          <Users className="h-4 w-4 mr-2" /> Assigned Team
        </button>
      </div>

      {/* --- TASKS VIEW --- */}
      {view === "tasks" && (
        <Card className="p-0 sm:p-5 border-none sm:border-solid sm:border-slate-200 shadow-none sm:shadow-sm bg-transparent sm:bg-white">
          <div className="flex flex-wrap justify-between items-center gap-3 mb-4 sm:pb-2 sm:border-b sm:border-slate-100 px-1 sm:px-0">
            <h3 className="shrink-0 text-sm font-bold text-slate-800 uppercase tracking-wider">Project Tasks ({assigneeFilter === "all" ? tasks.length : `${filteredTasks.length} of ${tasks.length}`})</h3>
            <Button onClick={() => setCreateDialogOpen(true)} size="sm" className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold shadow-sm">
              <Plus className="h-4 w-4 mr-1.5" /> Add Task
            </Button>
          </div>

          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="w-full sm:w-64 space-y-1.5">
              <Label htmlFor="pm-task-assignee" className="text-xs font-semibold text-slate-600">Assigned to</Label>
              <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
                <SelectTrigger id="pm-task-assignee" aria-label="Filter tasks by assigned user" className="h-11 bg-white border-slate-200"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="min-h-11">All users</SelectItem>
                  <SelectItem value="unassigned" className="min-h-11">Unassigned</SelectItem>
                  {filterUsers.map(user => <SelectItem key={user.id} value={String(user.id)} className="min-h-11">{user.full_name || user.email || "Unnamed User"}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {assigneeFilter !== "all" && <Button variant="ghost" className="h-11 self-start text-amber-800" onClick={() => setAssigneeFilter("all")}>Clear filter</Button>}
          </div>

          {tasks.length === 0 ? (
            <div className="text-center py-16 bg-white sm:bg-slate-50 rounded-xl border border-dashed border-slate-300">
              <CheckCircle2 className="h-12 w-12 text-slate-300 mx-auto mb-3" />
              <h3 className="text-lg font-bold text-slate-700">No tasks created</h3>
              <p className="text-sm font-medium text-slate-500 mb-4 mt-1">Get started by creating the first project task.</p>
              <Button onClick={() => setCreateDialogOpen(true)} variant="outline" className="border-amber-200 text-amber-700 bg-amber-50 font-bold hover:bg-amber-100">
                Create First Task
              </Button>
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="text-center py-12 bg-white sm:bg-slate-50 rounded-xl border border-dashed border-slate-300">
              <Users className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <h3 className="font-bold text-slate-700">No tasks match this filter</h3>
              <p className="mt-1 text-sm text-slate-500">Choose another user or clear the filter to see all project tasks.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {filteredTasks.map(task => {
                const isDone = task.status === "Done";
                const phaseName = phases.find(p => p.id === task.phase_id)?.name;
                
                const assignedIds = Array.isArray(task.assigned_to) ? task.assigned_to : (task.assigned_to ? [task.assigned_to] : []);
                const assignedUsers = assignedIds.map(id => allCompanyUsers.find(u => u.id === id)).filter(Boolean);
                
                return (
                  <div key={task.id} className={`p-4 rounded-xl flex flex-row items-center justify-between gap-4 transition-colors border group ${isDone ? "bg-slate-50/70 border-slate-200 opacity-80" : "bg-white border-slate-200 shadow-sm hover:border-amber-300"}`}>
                    
                    <div className="flex items-start gap-3 sm:gap-4 flex-1 min-w-0">
                      <button onClick={() => toggleTaskStatus.mutate(task)} className="mt-0.5 shrink-0 text-slate-300 hover:text-emerald-500 transition-colors focus:outline-none">
                        {isDone ? <CheckCircle2 className="h-5 w-5 sm:h-6 sm:w-6 text-emerald-500" /> : <Circle className="h-5 w-5 sm:h-6 sm:w-6" />}
                      </button>
                      <div className="min-w-0">
                        <h4 className={`text-sm sm:text-base font-bold truncate ${isDone ? "text-slate-500 line-through" : "text-slate-900"}`}>{task.title}</h4>
                        {task.description && (
                          <p className="text-xs text-slate-500 truncate mt-0.5">{task.description}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          {task.status && !isDone && (
                             <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 border border-slate-200">
                               {task.status}
                             </span>
                          )}
                          {task.priority && (
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider ${task.priority === "Urgent" || task.priority === "High" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                              {task.priority}
                            </span>
                          )}
                          {phaseName && <span className="text-[10px] sm:text-xs text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md font-bold flex items-center gap-1 border border-purple-100"><GitBranch className="h-3 w-3"/> {phaseName}</span>}
                          
                          {task.due_date_target && (
                            <span className="text-[10px] sm:text-xs text-slate-500 font-bold flex items-center gap-1">
                              <Calendar className="h-3 w-3"/> {task.due_date_target}
                            </span>
                          )}

                          {assignedUsers.length > 0 && (
                            <span className="text-[10px] sm:text-xs text-blue-700 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-md font-bold flex items-center gap-1">
                              <Users className="h-3 w-3"/> 
                              {assignedUsers.map(u => u.full_name || u.email).join(", ")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center shrink-0 opacity-100 sm:opacity-50 sm:group-hover:opacity-100 transition-opacity">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0 text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                            <span className="sr-only">Open menu</span>
                            <MoreVertical className="h-5 w-5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44 font-medium">
                          <DropdownMenuItem onClick={() => toggleTaskStatus.mutate(task)} className="cursor-pointer">
                            {isDone ? (
                              <><Circle className="h-4 w-4 mr-2 text-slate-400" /> Mark as 'To Do'</>
                            ) : (
                              <><CheckCircle2 className="h-4 w-4 mr-2 text-emerald-600" /> Mark as 'Done'</>
                            )}
                          </DropdownMenuItem>
                          <div className="h-px bg-slate-100 my-1" />
                          <DropdownMenuItem onClick={() => openEditTask(task)} className="cursor-pointer text-amber-700">
                            <Edit2 className="h-4 w-4 mr-2 text-amber-500" /> Edit Task
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => { if(window.confirm("Delete this task?")) deleteTask.mutate(task.id); }} className="cursor-pointer text-red-600 focus:text-red-700 focus:bg-red-50">
                            <Trash2 className="h-4 w-4 mr-2 text-red-500" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* --- STAFF VIEW --- */}
      {view === "staff" && (
        <Card className="p-0 sm:p-5 border-none sm:border-solid sm:border-slate-200 shadow-none sm:shadow-sm bg-transparent sm:bg-white">
          <div className="flex justify-between items-center mb-4 sm:pb-2 sm:border-b sm:border-slate-100 px-1 sm:px-0">
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
              Assigned Team ({projectStaff.length})
            </h3>
            <Button size="sm" onClick={() => setAssignDialog(true)} className="bg-slate-900 hover:bg-slate-800 text-white font-bold shadow-sm">
              <Plus className="h-4 w-4 mr-1.5" /> Assign Staff
            </Button>
          </div>
          
          {projectStaff.length === 0 ? (
            <div className="text-center py-16 bg-white sm:bg-slate-50 rounded-xl border border-dashed border-slate-300">
              <ShieldCheck className="h-12 w-12 text-slate-300 mx-auto mb-3" />
              <h3 className="text-lg font-bold text-slate-700">No team members assigned</h3>
              <p className="text-sm font-medium text-slate-500 mb-4 mt-1">Grant access to staff members to collaborate on this project.</p>
              <Button onClick={() => setAssignDialog(true)} className="bg-slate-900 hover:bg-slate-800 text-white font-bold">
                Assign Staff Member
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {projectStaff.map(ps => {
                const u = allCompanyUsers.find(user => user.id === ps.user_id);
                if (!u) return null;

                return (
                  <div key={ps.id} className="p-5 border border-slate-200 shadow-sm rounded-xl flex flex-col justify-between gap-5 bg-white relative overflow-hidden group">
                    <div className="absolute top-0 left-0 w-1 h-full bg-amber-500"></div>
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 rounded-full flex items-center justify-center text-sm font-black shrink-0 bg-amber-100 text-amber-700 border border-amber-200">
                        {u.full_name?.charAt(0) || u.email?.charAt(0)?.toUpperCase() || "?"}
                      </div>
                      <div className="min-w-0 flex-1 pt-0.5">
                        <p className="font-bold text-slate-900 truncate leading-tight">{u.full_name || "Unnamed Team Member"}</p>
                        {u.role && <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mt-1">{u.role}</p>}
                        {u.email && <p className="text-xs font-medium text-slate-500 truncate mt-0.5">{u.email}</p>}
                      </div>
                    </div>
                    <div>
                      <Button size="sm" variant="outline" onClick={() => { if(window.confirm(`Remove ${u.full_name || 'this member'} from the project?`)) removeStaff.mutate(ps.id); }} className="w-full h-8 text-xs font-bold text-slate-500 border-slate-200 hover:bg-red-50 hover:text-red-700 hover:border-red-200 transition-colors">
                        Remove Access
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* --- DIALOGS --- */}
      
      {/* ⚡ UPDATED: Passing default context so it auto-selects the client & project */}
      <CreateTaskDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        clients={clients} 
        projects={projects} 
        users={allCompanyUsers}
        defaultProjectId={project?.id ? String(project.id) : "none"}
        defaultClientId={project?.client_id ? String(project.client_id) : "none"}
        isLoading={handleCreateSubmit.isPending}
        onSubmit={(payload) => handleCreateSubmit.mutate(payload)}
      />

      <Dialog open={assignDialog} onOpenChange={setAssignDialog}>
        <DialogContent aria-describedby={undefined} className="sm:max-w-md w-[95vw] rounded-xl p-4 sm:p-6 bg-white">
          <DialogHeader><DialogTitle className="text-xl font-black text-slate-900">Assign Staff</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-sm font-medium text-slate-500 mb-2">Select a member from your company directory to grant them access to this project.</p>
            
            <div>
              <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Company User</Label>
              <Select value={selectedUserToAssign} onValueChange={setSelectedUserToAssign}>
                <SelectTrigger className="bg-slate-50 mt-1 font-medium border-slate-200">
                  <SelectValue placeholder="Select a user..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Select User —</SelectItem>
                  {unassignedCompanyUsers.length === 0 && (
                    <SelectItem value="empty" disabled className="italic text-slate-400">
                      {allCompanyUsers.length === 0 ? "No users found in database." : "All users are already assigned."}
                    </SelectItem>
                  )}
                  {unassignedCompanyUsers.map(u => (
                    <SelectItem key={u.id} value={String(u.id)} className="font-medium">
                      {u.full_name || u.email} {u.role ? `(${u.role})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col sm:flex-row justify-end gap-2 pt-4 border-t border-slate-100 mt-2">
              <Button variant="outline" onClick={() => setAssignDialog(false)} className="w-full sm:w-auto font-bold order-2 sm:order-1">Cancel</Button>
              <Button 
                className="w-full sm:w-auto bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold shadow-md order-1 sm:order-2" 
                onClick={() => assignStaff.mutate(selectedUserToAssign)} 
                disabled={selectedUserToAssign === "none" || assignStaff.isPending}
              >
                {assignStaff.isPending ? "Assigning..." : "Assign to Project"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent aria-describedby={undefined} className="sm:max-w-lg w-[95vw] rounded-xl p-4 sm:p-6 bg-white">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-slate-900">Edit Task</DialogTitle>
          </DialogHeader>

          <form onSubmit={(e) => { e.preventDefault(); saveEditedTask.mutate(taskForm); }} className="space-y-4 pt-2">
            
            <div className="space-y-2">
              <Label htmlFor="edit-title" className="text-[10px] font-black uppercase tracking-wider text-slate-500">Task Title *</Label>
              <Input 
                id="edit-title"
                value={taskForm.title} 
                onChange={e => setTaskForm({...taskForm, title: e.target.value})} 
                placeholder="Enter task title" 
                className="font-bold border-slate-200" 
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-description" className="text-[10px] font-black uppercase tracking-wider text-slate-500">Description</Label>
              <Textarea
                id="edit-description"
                placeholder="Task description (optional)"
                value={taskForm.description}
                onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
                className="h-24 resize-none font-medium border-slate-200"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Client</Label>
                <Select value={safeEditClientId} onValueChange={v => setTaskForm({...taskForm, client_id: v})}>
                  <SelectTrigger className="font-medium border-slate-200 text-sm"><SelectValue placeholder="Select Client" /></SelectTrigger>
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

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Project</Label>
                <Select value={safeEditProjectId} onValueChange={v => setTaskForm({...taskForm, project_id: v})}>
                  <SelectTrigger className="font-medium border-slate-200 text-sm"><SelectValue placeholder="Select Project" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Project</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={String(p.id)} value={String(p.id)}>
                        {getProjectName(p)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Project Phase</Label>
                <Select value={taskForm.phase_id} onValueChange={v => setTaskForm({...taskForm, phase_id: v})}>
                  <SelectTrigger className="font-medium border-slate-200 text-sm"><SelectValue placeholder="Select phase" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— No Phase —</SelectItem>
                    {phases.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Priority</Label>
                <Select value={taskForm.priority || "Medium"} onValueChange={v => setTaskForm({...taskForm, priority: v})}>
                  <SelectTrigger className="font-medium border-slate-200 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["Low","Medium","High","Urgent"].map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Status</Label>
                <Select value={taskForm.status || "To Do"} onValueChange={v => setTaskForm({...taskForm, status: v})}>
                  <SelectTrigger className="font-medium border-slate-200 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["To Do", "Doing", "Blocked", "Done"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Due Date</Label>
                <Input
                  type="date"
                  value={taskForm.due_date || ""}
                  onChange={(e) => setTaskForm({ ...taskForm, due_date: e.target.value })}
                  className="font-medium border-slate-200 text-sm block w-full"
                />
              </div>
              
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Est. Hours</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  placeholder="e.g. 2.5"
                  value={taskForm.estimated_hours || ""}
                  onChange={(e) => setTaskForm({ ...taskForm, estimated_hours: e.target.value })}
                  className="font-medium border-slate-200 text-sm"
                />
              </div>
            </div>
            
            <div className="space-y-2 pt-2">
              <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Assign Staff (Select Multiple)</Label>
              {projectStaff.length === 0 ? (
                <p className="text-xs font-medium text-slate-400 italic bg-slate-50 p-3 rounded-lg border border-dashed border-slate-200">No staff assigned to this project yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2 mt-1">
                  {projectStaff.map(ps => {
                    const u = allCompanyUsers.find(user => user.id === ps.user_id);
                    if (!u) return null;
                    
                    const isSelected = taskForm.assigned_to.includes(u.id);

                    return (
                      <div 
                        key={u.id}
                        onClick={() => {
                          if (isSelected) {
                            setTaskForm(f => ({...f, assigned_to: f.assigned_to.filter(id => id !== u.id)}));
                          } else {
                            setTaskForm(f => ({...f, assigned_to: [...f.assigned_to, u.id]}));
                          }
                        }}
                        className={`px-3 py-1.5 rounded-md text-xs font-bold cursor-pointer border transition-all ${
                          isSelected 
                            ? 'bg-amber-500 text-slate-900 border-amber-600 shadow-sm scale-[0.98]' 
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-slate-300'
                        }`}
                      >
                        {u.full_name || u.email || "Unnamed User"}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row justify-end gap-2 pt-4 border-t border-slate-100 mt-2">
              <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)} className="w-full sm:w-auto font-bold order-2 sm:order-1">Cancel</Button>
              <Button type="submit" className="w-full sm:w-auto bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold shadow-md order-1 sm:order-2" disabled={!taskForm.title || saveEditedTask.isPending}>
                {saveEditedTask.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
