import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient"; 
import { useAuth } from "@/lib/AuthContext";
import { Link } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, Clock, Upload, MapPin, User, Calendar, AlertCircle, CheckCircle2, MoreVertical, Edit, Package, FileText, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import StatusBadge from "../components/shared/StatusBadge";
import NotesFeed from "../components/shared/NotesFeed";
import GanttChart from "../components/projects/GanttChart";
import ResourceAllocationView from "../components/projects/ResourceAllocationView";
import ProjectProgressDashboard from "../components/projects/ProjectProgressDashboard";
import AISchedulingAssistant from "../components/projects/AISchedulingAssistant";
import PermitsTab from "../components/projects/PermitsTab";
import { format } from "date-fns";
import { toast } from "sonner";

const TASK_STATUSES = ["To Do", "Doing", "Blocked", "Done"];

// Helper to safely convert numbers
const safeNum = (val) => isNaN(Number(val)) ? 0 : Number(val);

export default function ProjectDetail() {
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get("id");
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  const [taskDialog, setTaskDialog] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [taskForm, setTaskForm] = useState({ title: "", description: "", status: "To Do", priority: "Medium", assigned_to: "", due_date: "", estimated_hours: "" });
  const [timeDialog, setTimeDialog] = useState(false);
  const [timeForm, setTimeForm] = useState({ hours: "", date: "", notes: "", billable: true, task_id: "" });
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // --- SUPABASE QUERIES ---
  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    enabled: !!projectId,
    queryFn: async () => { 
      const { data, error } = await supabase.from("projects").select("*").eq("id", projectId).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ["project-tasks", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.from("project_tasks").select("*").eq("project_id", projectId);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: scheduleJobs = [] } = useQuery({
    queryKey: ["project-schedule", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.from("schedule_jobs").select("*").eq("project_id", projectId);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: timeLogs = [] } = useQuery({
    queryKey: ["project-time", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.from("time_logs").select("*").eq("project_id", projectId);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: files = [] } = useQuery({
    queryKey: ["project-files", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.from("attachments").select("*").eq("related_type", "Project").eq("related_id", projectId);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ["users", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("users").select("*").eq("company_id", companyId);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: dependencies = [] } = useQuery({
    queryKey: ["project-dependencies", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.from("task_dependencies").select("*").eq("project_id", projectId);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: allocations = [] } = useQuery({
    queryKey: ["project-allocations", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.from("resource_allocations").select("*").eq("project_id", projectId);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: materialsSchedules = [] } = useQuery({
    queryKey: ["project-materials", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.from("project_materials").select("*").eq("project_id", projectId);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: quote } = useQuery({
    queryKey: ["project-quote", project?.quote_id],
    enabled: !!project?.quote_id,
    queryFn: async () => {
      const { data, error } = await supabase.from("quotes").select("*").eq("id", project.quote_id).single();
      if (error && error.code !== 'PGRST116') throw error;
      return data;
    },
  });

  // --- SUPABASE MUTATIONS ---
  const createTaskMutation = useMutation({
    mutationFn: async (data) => {
      const { data: newDoc, error } = await supabase.from("project_tasks").insert([{ 
        ...data, 
        project_id: projectId,
        company_id: companyId 
      }]).select().single();
      if (error) throw error;
      return newDoc;
    },
    onSuccess: () => { 
      queryClient.invalidateQueries({ queryKey: ["project-tasks", projectId] }); 
      setTaskDialog(false); 
      setTaskForm({ title: "", description: "", status: "To Do", priority: "Medium", assigned_to: "", due_date: "", estimated_hours: "" });
      setEditingTask(null);
      toast.success("Task created");
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const { error } = await supabase.from("project_tasks").update(data).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-tasks", projectId] });
      queryClient.invalidateQueries({ queryKey: ["project-time", projectId] });
      setTaskDialog(false);
      setEditingTask(null);
      toast.success("Task updated");
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (taskId) => {
      const { error } = await supabase.from("project_tasks").delete().eq("id", taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-tasks", projectId] });
      toast.success("Task deleted");
    }
  });

  const createTimeMutation = useMutation({
    mutationFn: async (data) => {
      const { error: logError } = await supabase.from("time_logs").insert([{ 
        ...data, 
        project_id: projectId,
        company_id: companyId 
      }]);
      if (logError) throw logError;
      
      // Update task actual hours if task_id is present
      if (data.task_id) {
        const task = tasks.find(t => t.id === data.task_id);
        if (task) {
          const taskTimeLogs = timeLogs.filter(t => t.task_id === data.task_id);
          const totalTaskHours = taskTimeLogs.reduce((sum, t) => sum + safeNum(t.hours), 0) + safeNum(data.hours);
          await supabase.from("project_tasks").update({ actual_hours: totalTaskHours }).eq("id", data.task_id);
        }
      }
    },
    onSuccess: () => { 
      queryClient.invalidateQueries({ queryKey: ["project-time", projectId] }); 
      queryClient.invalidateQueries({ queryKey: ["project-tasks", projectId] });
      setTimeDialog(false); 
      setTimeForm({ hours: "", date: "", notes: "", billable: true, task_id: "" });
      toast.success("Time logged");
    },
  });

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    toast.info("Uploading file...");
    setUploadingPhoto(true);
    try {
      const fileName = `${companyId}/${projectId}/files/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from("projects").upload(fileName, file);
      if (uploadError) throw uploadError;
      
      const { data: { publicUrl } } = supabase.storage.from("projects").getPublicUrl(fileName);

      const { error: dbError } = await supabase.from("attachments").insert([{
        company_id: companyId,
        related_type: "Project", 
        related_id: projectId,
        file_url: publicUrl, 
        file_name: file.name, 
        caption: ""
      }]);
      if (dbError) throw dbError;

      queryClient.invalidateQueries({ queryKey: ["project-files", projectId] });
      toast.success("File uploaded successfully");
    } catch (error) {
      console.error("Upload failed", error);
      toast.error("Failed to upload file");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const updateStatus = async (newStatus) => {
    try {
      const { error } = await supabase.from("projects").update({ status: newStatus }).eq("id", projectId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      toast.success(`Project status updated to ${newStatus}`);
    } catch (err) {
      toast.error("Failed to update status");
    }
  };

  const totalHours = timeLogs.reduce((sum, t) => sum + safeNum(t.hours), 0);
  const completedTasks = tasks.filter(t => t.status === "Done").length;
  const taskCompletionRate = tasks.length > 0 ? (completedTasks / tasks.length) * 100 : 0;
  const overdueTasks = tasks.filter(t => t.due_date_target && new Date(t.due_date_target) < new Date() && t.status !== "Done").length;

  const handleEditTask = (task) => {
    setEditingTask(task);
    setTaskForm({
      title: task.title,
      description: task.description || "",
      status: task.status,
      priority: task.priority || "Medium",
      assigned_to: task.assigned_to || "",
      due_date: task.due_date_target || "",
      estimated_hours: task.estimated_hours?.toString() || "",
    });
    setTaskDialog(true);
  };

  const handleTaskSubmit = async (e) => {
    e.preventDefault();
    const taskData = {
      ...taskForm,
      due_date_target: taskForm.due_date || null,
      estimated_hours: taskForm.estimated_hours ? Number(taskForm.estimated_hours) : null
    };
    
    // Cleanup pseudo fields not in db schema
    delete taskData.due_date;

    if (editingTask) {
      await updateTaskMutation.mutateAsync({ id: editingTask.id, data: taskData });
    } else {
      await createTaskMutation.mutateAsync(taskData);
    }
  };

  if (!project) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-600 mb-4"></div>
      <p className="text-slate-500">Loading project...</p>
    </div>
  );

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <Link to="/PMProjects" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4">
        <ArrowLeft className="h-4 w-4" /> Back to Projects
      </Link>

      <Card className="p-6 mb-6 border-slate-200/80 bg-gradient-to-br from-white to-amber-50/30">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex-1">
            <h1 className="text-xl font-bold text-slate-900">{project.name}</h1>
            <p className="text-sm text-slate-500">{project.project_number} · Budget: ${Number(project.budget || 0).toLocaleString()}</p>
            {project.site_address && <p className="text-xs text-slate-400 flex items-center gap-1 mt-1"><MapPin className="h-3 w-3" /> {project.site_address}</p>}
          </div>
          <div className="flex items-center gap-2">
            <Select value={project.status || "Not Started"} onValueChange={updateStatus}>
              <SelectTrigger className="w-[150px] bg-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Not Started", "Planning", "In Progress", "On Hold", "Completed", "Cancelled"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Progress Indicators */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6 pt-4 border-t border-slate-200/60">
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-slate-600">Task Completion</p>
              <p className="text-xs text-slate-500">{completedTasks}/{tasks.length}</p>
            </div>
            <Progress value={taskCompletionRate} className="h-2" />
            <p className="text-xs text-slate-500 mt-1">{Math.round(taskCompletionRate)}% complete</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-600 mb-2">Time Logged</p>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-600" />
              <span className="text-lg font-bold text-slate-900">{totalHours}h</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">Total hours tracked</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-600 mb-2">Overdue Tasks</p>
            <div className="flex items-center gap-2">
              <AlertCircle className={`h-4 w-4 ${overdueTasks > 0 ? "text-red-500" : "text-green-500"}`} />
              <span className={`text-lg font-bold ${overdueTasks > 0 ? "text-red-600" : "text-green-600"}`}>{overdueTasks}</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">{overdueTasks === 0 ? "All on track!" : "Need attention"}</p>
          </div>
        </div>
      </Card>

      <Tabs defaultValue="progress">
        <TabsList className="mb-4 flex-wrap h-auto">
          <TabsTrigger value="progress">Dashboard</TabsTrigger>
          {project.quote_id && <TabsTrigger value="quote">Quote</TabsTrigger>}
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="tasks">Tasks ({tasks.length})</TabsTrigger>
          <TabsTrigger value="gantt">Gantt Chart</TabsTrigger>
          <TabsTrigger value="resources">Resources</TabsTrigger>
          <TabsTrigger value="schedule">Schedule ({scheduleJobs.length})</TabsTrigger>
          <TabsTrigger value="time">Time ({totalHours}h)</TabsTrigger>
          <TabsTrigger value="materials">Materials ({materialsSchedules.length})</TabsTrigger>
          <TabsTrigger value="files">Files ({files.length})</TabsTrigger>
          <TabsTrigger value="permits">Permits</TabsTrigger>
        </TabsList>

        {/* Dashboard */}
        <TabsContent value="progress">
          <ProjectProgressDashboard project={project} tasks={tasks} timeLogs={timeLogs} allocations={allocations} />
        </TabsContent>

        {/* Quote Preview */}
        {project.quote_id && (
          <TabsContent value="quote">
            {quote ? (
              <Card className="p-6 border-slate-200/80">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-amber-100 flex items-center justify-center">
                      <FileText className="h-5 w-5 text-amber-600" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">Original Quote</h3>
                      <p className="text-sm text-slate-500">Quote #{quote.quote_number}</p>
                    </div>
                  </div>
                  <Link to={`/QuoteView?id=${quote.id}`}>
                    <Button size="sm" variant="outline" className="gap-2">
                      <Eye className="h-4 w-4" />
                      View Full Quote
                    </Button>
                  </Link>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-slate-50 rounded-lg">
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Quote Title</p>
                      <p className="text-sm font-medium text-slate-900">{quote.title}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Status</p>
                      <StatusBadge status={quote.status} />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Issue Date</p>
                      <p className="text-sm text-slate-700">{quote.issue_date || "N/A"}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Total Value</p>
                      <p className="text-lg font-bold text-amber-600">${Number(quote.total || 0).toFixed(2)}</p>
                    </div>
                  </div>

                  {quote.overall_scope && (
                    <div className="p-4 bg-white border border-slate-200 rounded-lg">
                      <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Scope of Work</p>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap">{quote.overall_scope}</p>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3 bg-white border border-slate-200 rounded-lg text-center">
                      <p className="text-xs text-slate-500 mb-1">Subtotal</p>
                      <p className="text-base font-bold text-slate-900">${Number(quote.subtotal || 0).toFixed(2)}</p>
                    </div>
                    <div className="p-3 bg-white border border-slate-200 rounded-lg text-center">
                      <p className="text-xs text-slate-500 mb-1">Tax</p>
                      <p className="text-base font-bold text-slate-900">${Number(quote.tax || 0).toFixed(2)}</p>
                    </div>
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-center">
                      <p className="text-xs text-amber-700 font-medium mb-1">Total</p>
                      <p className="text-base font-bold text-amber-600">${Number(quote.total || 0).toFixed(2)}</p>
                    </div>
                  </div>

                  {quote.client_message && (
                    <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="text-xs font-semibold text-blue-700 uppercase mb-2">Client Message</p>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap">{quote.client_message}</p>
                    </div>
                  )}
                </div>
              </Card>
            ) : (
              <Card className="p-8 text-center">
                <p className="text-slate-400">Loading quote...</p>
              </Card>
            )}
          </TabsContent>
        )}

        {/* Notes */}
        <TabsContent value="notes">
          <NotesFeed relatedType="Project" relatedId={projectId} />
        </TabsContent>

        {/* Tasks Kanban */}
        <TabsContent value="tasks">
          <div className="flex flex-wrap justify-end gap-2 mb-4">
            <AISchedulingAssistant 
              projectId={projectId} 
              onScheduleGenerated={() => {
                queryClient.invalidateQueries({ queryKey: ["project-tasks", projectId] });
                queryClient.invalidateQueries({ queryKey: ["project", projectId] });
              }}
            />
            <Button size="sm" onClick={() => { 
              setEditingTask(null);
              setTaskForm({ title: "", description: "", status: "To Do", priority: "Medium", assigned_to: "", due_date: "", estimated_hours: "" }); 
              setTaskDialog(true); 
            }} className="bg-amber-500 hover:bg-amber-600">
              <Plus className="h-4 w-4 mr-1" /> Add Task
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {TASK_STATUSES.map(status => (
              <div key={status} className="bg-slate-50/50 rounded-lg p-3">
                <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-3 flex items-center justify-between">
                  <span>{status}</span>
                  <span className="bg-slate-200 text-slate-700 rounded-full px-2 py-0.5 text-[10px]">
                    {tasks.filter(t => t.status === status).length}
                  </span>
                </h4>
                <div className="space-y-2">
                  {tasks.filter(t => t.status === status).map(task => {
                    const assignedUser = allUsers.find(u => u.id === task.assigned_to);
                    const isOverdue = task.due_date_target && new Date(task.due_date_target) < new Date() && task.status !== "Done";
                    
                    return (
                      <Card key={task.id} className={`p-3 border transition-all hover:shadow-md ${isOverdue ? "border-red-200 bg-red-50/30" : "border-slate-200/80 bg-white"}`}>
                        <div className="flex items-start justify-between mb-2">
                          <p className="text-sm font-medium text-slate-800 flex-1">{task.title}</p>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6">
                                <MoreVertical className="h-3 w-3" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleEditTask(task)}>
                                <Edit className="h-3 w-3 mr-2" /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                onClick={() => deleteTaskMutation.mutate(task.id)}
                                className="text-red-600"
                              >
                                <Trash2 className="h-3 w-3 mr-2" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        
                        {task.description && (
                          <p className="text-xs text-slate-600 mb-2 line-clamp-2">{task.description}</p>
                        )}

                        <div className="flex flex-wrap items-center gap-1.5 mb-2">
                          <StatusBadge status={task.priority || "Medium"} />
                          {isOverdue && (
                            <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                              Overdue
                            </span>
                          )}
                        </div>

                        {assignedUser && (
                          <div className="flex items-center gap-1.5 mb-2 text-xs text-slate-600">
                            <User className="h-3 w-3" />
                            <span className="truncate">{assignedUser.full_name || assignedUser.email}</span>
                          </div>
                        )}

                        {task.due_date_target && (
                          <div className={`flex items-center gap-1.5 mb-2 text-xs ${isOverdue ? "text-red-600 font-medium" : "text-slate-600"}`}>
                            <Calendar className="h-3 w-3" />
                            <span>{format(new Date(task.due_date_target), "MMM d, yyyy")}</span>
                          </div>
                        )}

                        {(task.estimated_hours || task.actual_hours > 0) && (
                          <div className="flex items-center gap-1.5 mb-2 text-xs text-slate-600">
                            <Clock className="h-3 w-3" />
                            <span>
                              {task.actual_hours || 0}h / {task.estimated_hours || 0}h
                            </span>
                          </div>
                        )}

                        <Select value={task.status} onValueChange={v => updateTaskMutation.mutate({ id: task.id, data: { status: v } })}>
                          <SelectTrigger className="mt-2 h-7 text-xs bg-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TASK_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </Card>
                    );
                  })}
                  {tasks.filter(t => t.status === status).length === 0 && (
                    <div className="text-center py-8 text-slate-400">
                      <p className="text-xs">No tasks</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* Gantt Chart */}
        <TabsContent value="gantt">
          <Card className="p-4 border-slate-200/60">
            <GanttChart tasks={tasks} dependencies={dependencies} />
          </Card>
        </TabsContent>

        {/* Resource Allocation */}
        <TabsContent value="resources">
          <ResourceAllocationView projectId={projectId} tasks={tasks} allocations={allocations} allUsers={allUsers} />
        </TabsContent>

        {/* Schedule */}
        <TabsContent value="schedule">
          <div className="space-y-2">
            {scheduleJobs.map(job => (
              <Card key={job.id} className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-700">{job.title}</p>
                  <p className="text-xs text-slate-500">{job.start_date_time} · {job.address || "No address"}</p>
                </div>
                <StatusBadge status={job.status} />
              </Card>
            ))}
            {scheduleJobs.length === 0 && <p className="text-sm text-slate-400 text-center py-8">No scheduled jobs</p>}
          </div>
        </TabsContent>

        {/* Time Logs */}
        <TabsContent value="time">
          <div className="flex justify-end mb-4">
            <Button size="sm" onClick={() => { setTimeForm({ hours: "", date: new Date().toISOString().split('T')[0], notes: "", billable: true, task_id: "" }); setTimeDialog(true); }} className="bg-amber-500 hover:bg-amber-600">
              <Clock className="h-4 w-4 mr-1" /> Log Time
            </Button>
          </div>
          <div className="space-y-2">
            {timeLogs.map(log => {
              const relatedTask = tasks.find(t => t.id === log.task_id);
              return (
                <Card key={log.id} className="p-4 border-slate-200/80">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg font-bold text-slate-900">{log.hours}h</span>
                        {log.billable && (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                            Billable
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-700 mb-1">{log.notes || "No notes"}</p>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span>{log.date ? format(new Date(log.date), "MMM d, yyyy") : "No date"}</span>
                        {relatedTask && (
                          <span className="flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            {relatedTask.title}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
            {timeLogs.length === 0 && <p className="text-sm text-slate-400 text-center py-8">No time logged</p>}
          </div>
        </TabsContent>

        {/* Materials Schedules */}
        <TabsContent value="materials">
          <div className="flex justify-end mb-4">
            <Link to="/MaterialsSchedule">
              <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-slate-900">
                <Plus className="h-4 w-4 mr-1" /> New Materials Schedule
              </Button>
            </Link>
          </div>
          <div className="space-y-2">
            {materialsSchedules.map(schedule => (
              <Link key={schedule.id} to={`/MaterialsSchedule?id=${schedule.id}`}>
                <Card className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors cursor-pointer">
                  <div className="flex items-center gap-3">
                    <Package className="h-5 w-5 text-amber-600" />
                    <div>
                      <p className="text-sm font-medium text-slate-700">{schedule.custom_material_name}</p>
                      <p className="text-xs text-slate-500">{schedule.needed_by_date || "No date set"}</p>
                    </div>
                  </div>
                  <StatusBadge status={schedule.status} />
                </Card>
              </Link>
            ))}
            {materialsSchedules.length === 0 && (
              <div className="text-center py-12">
                <Package className="h-12 w-12 mx-auto text-slate-300 mb-3" />
                <p className="text-sm text-slate-400 mb-4">No materials yet</p>
                <Link to="/MaterialsSchedule">
                  <Button size="sm" variant="outline" className="bg-white">
                    <Plus className="h-4 w-4 mr-2" /> Track First Material
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Files */}
        <TabsContent value="files">
          <div className="flex justify-end mb-4">
            <label>
              <input type="file" className="hidden" onChange={handleFileUpload} disabled={uploadingPhoto} />
              <Button size="sm" asChild disabled={uploadingPhoto}>
                <span className="cursor-pointer"><Upload className="h-4 w-4 mr-1" /> {uploadingPhoto ? "Uploading..." : "Upload File"}</span>
              </Button>
            </label>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {files.map(file => (
              <Card key={file.id} className="p-3 bg-white">
                {file.file_url?.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                  <img src={file.file_url} alt={file.file_name} className="w-full h-32 object-cover rounded mb-2 border border-slate-200" />
                ) : (
                  <div className="w-full h-32 bg-slate-100 border border-slate-200 rounded mb-2 flex items-center justify-center text-slate-400 text-xs">Document</div>
                )}
                <p className="text-xs text-slate-600 truncate" title={file.file_name}>{file.file_name}</p>
              </Card>
            ))}
          </div>
          {files.length === 0 && <p className="text-sm text-slate-400 text-center py-8">No files uploaded</p>}
        </TabsContent>

        {/* Permits */}
        <TabsContent value="permits">
          <PermitsTab projectId={projectId} />
        </TabsContent>
      </Tabs>

      {/* Task Dialog */}
      <Dialog open={taskDialog} onOpenChange={(open) => {
        setTaskDialog(open);
        if (!open) {
          setEditingTask(null);
          setTaskForm({ title: "", description: "", status: "To Do", priority: "Medium", assigned_to: "", due_date: "", estimated_hours: "" });
        }
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingTask ? "Edit Task" : "New Task"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleTaskSubmit} className="space-y-4">
            <div>
              <Label>Title *</Label>
              <Input value={taskForm.title} onChange={e => setTaskForm({...taskForm, title: e.target.value})} required />
            </div>
            
            <div>
              <Label>Description</Label>
              <Textarea value={taskForm.description} onChange={e => setTaskForm({...taskForm, description: e.target.value})} rows={3} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Status</Label>
                <Select value={taskForm.status} onValueChange={v => setTaskForm({...taskForm, status: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TASK_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Priority</Label>
                <Select value={taskForm.priority} onValueChange={v => setTaskForm({...taskForm, priority: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["Low", "Medium", "High", "Urgent"].map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Assign To</Label>
                <Select value={taskForm.assigned_to || ""} onValueChange={v => setTaskForm({...taskForm, assigned_to: v === "none" ? null : v})}>
                  <SelectTrigger><SelectValue placeholder="Select user" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {allUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name || u.email}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Due Date</Label>
                <Input type="date" value={taskForm.due_date} onChange={e => setTaskForm({...taskForm, due_date: e.target.value})} />
              </div>
            </div>

            <div>
              <Label>Estimated Hours</Label>
              <Input type="number" step="0.5" value={taskForm.estimated_hours} onChange={e => setTaskForm({...taskForm, estimated_hours: e.target.value})} placeholder="0" />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setTaskDialog(false)}>Cancel</Button>
              <Button type="submit" className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-medium">
                {editingTask ? "Update Task" : "Create Task"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Time Dialog */}
      <Dialog open={timeDialog} onOpenChange={setTimeDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log Time</DialogTitle></DialogHeader>
          <form onSubmit={async (e) => { e.preventDefault(); await createTimeMutation.mutateAsync({ ...timeForm, hours: Number(timeForm.hours) }); }} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Hours *</Label>
                <Input type="number" step="0.25" value={timeForm.hours} onChange={e => setTimeForm({...timeForm, hours: e.target.value})} required />
              </div>
              <div>
                <Label>Date *</Label>
                <Input type="date" value={timeForm.date} onChange={e => setTimeForm({...timeForm, date: e.target.value})} required />
              </div>
            </div>
            
            <div>
              <Label>Link to Task (Optional)</Label>
              <Select value={timeForm.task_id || ""} onValueChange={v => setTimeForm({...timeForm, task_id: v === "none" ? null : v})}>
                <SelectTrigger><SelectValue placeholder="Select task" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No task</SelectItem>
                  {tasks.map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Notes</Label>
              <Textarea value={timeForm.notes} onChange={e => setTimeForm({...timeForm, notes: e.target.value})} rows={3} placeholder="What did you work on?" />
            </div>
            
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={timeForm.billable} onChange={e => setTimeForm({...timeForm, billable: e.target.checked})} className="rounded" />
              Billable
            </label>
            
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setTimeDialog(false)}>Cancel</Button>
              <Button type="submit" className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-medium">Log Time</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}