import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle2, Circle, Calendar, Briefcase, AlertCircle, FileText, AlignLeft, Flag, GitBranch } from "lucide-react";
import { toast } from "sonner";
import TaskWorkflowPanel from "@/components/tasks/TaskWorkflowPanel";
import { useLocation } from "react-router-dom";

export default function EPTasks({ currentUser, companyId }) {
  const qc = useQueryClient();
  const [selectedTask, setSelectedTask] = useState(null);
  const { search } = useLocation();
  const notificationTask = new URLSearchParams(search).get("notificationTask");

  // 1. Fetch Projects
  const { data: projects = [] } = useQuery({ 
    queryKey: ["projects", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id, name").eq("company_id", companyId);
      return data || [];
    } 
  });

  // 2. Fetch ALL Phases
  const { data: phases = [] } = useQuery({ 
    queryKey: ["all_phases", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("project_phases").select("id, name, project_id");
      return data || [];
    } 
  });

  // 3. Fetch Tasks
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks_mine", currentUser?.id],
    enabled: !!companyId && !!currentUser?.id,
    queryFn: async () => {
      const results = await Promise.all(["project_tasks", "tasks"].map(table =>
        supabase.from(table).select("*").eq("company_id", companyId).order("created_at", { ascending: false })
          .then(result => ({ ...result, table }))));
      const error = results.find(result => result.error)?.error;
      const data = results.flatMap(result => (result.data || []).map(task => ({
        ...task, source_table: result.table, due_date: task.due_date_target || task.due_date,
      })));
      
      if (error) {
        console.warn("Tasks error:", error.message);
        return [];
      }

      const myId = currentUser.id;
      
      const myTasks = (data || []).filter(task => {
        if (!task.assigned_to) return false;
        if (Array.isArray(task.assigned_to)) return task.assigned_to.includes(myId) || task.assigned_to.includes(currentUser.email);
        if (typeof task.assigned_to === "string") return task.assigned_to.includes(myId) || task.assigned_to.includes(currentUser.email);
        return false;
      });

      return myTasks;
    }
  });

  useEffect(() => {
    if (!notificationTask) return;
    const task = tasks.find(t => t.id === notificationTask);
    setSelectedTask(task || null);
  }, [tasks, notificationTask]);

  // 4. Toggle Task Status Mutation
  const toggleMutation = useMutation({
    mutationFn: async ({ id, newStatus }) => {
      const { error } = await supabase.from(tasks.find(t => t.id === id)?.source_table || "project_tasks").update({ status: newStatus }).eq("company_id", companyId).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks_mine"] });
      toast.success("Task updated!");
      if (selectedTask) {
        setSelectedTask(prev => ({ ...prev, status: prev.status === "Done" ? "To Do" : "Done" }));
      }
    },
    onError: (err) => toast.error(`Failed to update task: ${err.message}`)
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-4 border-amber-200 border-t-amber-500 rounded-full animate-spin" />
      </div>
    );
  }

  const pendingTasks = tasks.filter(t => t.status !== "Completed" && t.status !== "Done");
  const completedTasks = tasks.filter(t => t.status === "Completed" || t.status === "Done");

  // Helper to render the table rows
  const renderTaskRow = (task, isCompleted) => {
    const proj = projects.find(p => p.id === task.project_id);
    const phase = phases.find(p => p.id === task.phase_id);
    const deadline = task.due_date || task.end_date; 
    const isOverdue = deadline && new Date(deadline) < new Date() && !isCompleted;

    return (
      <tr key={task.id} className={`border-b last:border-0 border-slate-100 hover:bg-slate-50 transition-colors ${isOverdue ? "bg-red-50/30" : ""} ${isCompleted ? "opacity-60" : ""}`}>
        {/* Checkbox Column */}
        <td className="px-4 py-3 align-middle text-center w-12">
          <button 
            onClick={() => toggleMutation.mutate({ id: task.id, newStatus: isCompleted ? "To Do" : "Done" })}
            className={`shrink-0 transition-colors ${isCompleted ? "text-emerald-500 hover:text-amber-500" : "text-slate-300 hover:text-emerald-500"}`}
            title={isCompleted ? "Mark as Incomplete" : "Mark as Complete"}
            disabled={toggleMutation.isPending}
          >
            {isCompleted ? <CheckCircle2 className="h-6 w-6" /> : <Circle className="h-6 w-6" />}
          </button>
        </td>

        {/* Task Name & Desc */}
        <td className="px-4 py-3 align-middle min-w-[250px]">
          <p className={`text-sm font-black ${isCompleted ? "text-slate-600 line-through" : "text-slate-900"}`}>
            {task.title || task.name}
          </p>
          {task.description && (
            <p className={`text-xs mt-0.5 truncate max-w-[250px] md:max-w-sm ${isCompleted ? "text-slate-400 line-through" : "text-slate-500"}`}>
              {task.description}
            </p>
          )}
        </td>

        {/* Project & Phase */}
        <td className="px-4 py-3 align-middle whitespace-nowrap">
          <div className="flex flex-col items-start gap-1">
            {proj ? (
              <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px] uppercase tracking-wider">
                {proj.name}
              </Badge>
            ) : (
              <span className="text-xs text-slate-400 italic">—</span>
            )}
            {phase && (
              <span className="text-[10px] text-slate-500 font-bold uppercase flex items-center gap-1">
                <GitBranch className="h-3 w-3" /> {phase.name}
              </span>
            )}
          </div>
        </td>

        {/* Priority */}
        <td className="px-4 py-3 align-middle whitespace-nowrap">
          {task.priority ? (
            <Badge className={`text-[10px] uppercase tracking-wider ${task.priority === 'High' || task.priority === 'Urgent' ? 'bg-red-100 text-red-700 border-red-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
              {task.priority}
            </Badge>
          ) : (
            <span className="text-xs text-slate-400 italic">—</span>
          )}
        </td>

        {/* Due Date */}
        <td className="px-4 py-3 align-middle whitespace-nowrap">
          {deadline ? (
            <span className={`flex items-center gap-1.5 text-xs font-bold ${isOverdue ? 'text-red-600' : 'text-slate-600'}`}>
              {isOverdue ? <AlertCircle className="h-3.5 w-3.5" /> : <Calendar className="h-3.5 w-3.5" />}
              {deadline}
            </span>
          ) : (
             <span className="text-xs text-slate-400 italic">—</span>
          )}
        </td>

        {/* Action Button */}
        <td className="px-4 py-3 align-middle text-right whitespace-nowrap">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setSelectedTask(task)}
            className="text-slate-500 hover:text-amber-700 hover:bg-amber-50 font-bold"
          >
            <FileText className="h-4 w-4 sm:mr-1.5" /> <span className="hidden sm:inline">Details</span>
          </Button>
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <CheckCircle2 className="h-6 w-6 text-amber-500" /> My Tasks
          </h3>
          <p className="text-sm font-bold text-slate-500 mt-1 uppercase tracking-wider">
            {pendingTasks.length} Active Tasks
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {tasks.length === 0 && (
          <div className="text-center py-16 bg-white rounded-xl border border-dashed border-slate-300">
            <Briefcase className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-500">You have no tasks assigned to you right now.</p>
          </div>
        )}

        {/* ACTIVE TASKS TABLE */}
        {pendingTasks.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">To Do</h4>
              <Badge className="bg-amber-500 text-slate-900 font-bold">{pendingTasks.length}</Badge>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50/50 border-b border-slate-200 text-[10px] uppercase font-black text-slate-400 tracking-wider">
                  <tr>
                    <th className="px-4 py-3 text-center">Done</th>
                    <th className="px-4 py-3">Task Details</th>
                    <th className="px-4 py-3">Project / Phase</th>
                    <th className="px-4 py-3">Priority</th>
                    <th className="px-4 py-3">Due Date</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pendingTasks.map(task => renderTaskRow(task, false))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* COMPLETED TASKS TABLE */}
        {completedTasks.length > 0 && (
          <div className="bg-emerald-50/30 border border-emerald-100 rounded-xl shadow-sm overflow-hidden opacity-90">
            <div className="px-4 py-3 bg-emerald-50/50 border-b border-emerald-100 flex justify-between items-center">
              <h4 className="text-xs font-bold text-emerald-800 uppercase tracking-wider">Completed</h4>
              <Badge className="bg-emerald-200 text-emerald-900 border-emerald-300 font-bold">{completedTasks.length}</Badge>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-emerald-50/50 border-b border-emerald-100 text-[10px] uppercase font-black text-emerald-600/70 tracking-wider">
                  <tr>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3">Task Details</th>
                    <th className="px-4 py-3">Project / Phase</th>
                    <th className="px-4 py-3">Priority</th>
                    <th className="px-4 py-3">Due Date</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-emerald-50/50">
                  {completedTasks.map(task => renderTaskRow(task, true))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* TASK DETAILS DIALOG (SLIDE OUT) */}
      {selectedTask && (
        <Dialog open={!!selectedTask} onOpenChange={(val) => !val && setSelectedTask(null)}>
          <DialogContent className="w-[95vw] max-w-md max-h-[90dvh] overflow-y-auto bg-white border-slate-200 shadow-xl" aria-describedby={undefined}>
            <DialogHeader>
              <div className="flex items-start gap-3 pr-6">
                <div className={`mt-1.5 h-2.5 w-2.5 rounded-full shrink-0 ${selectedTask.status === "Done" || selectedTask.status === "Completed" ? "bg-emerald-500" : "bg-amber-500"}`} />
                <DialogTitle className="font-black text-xl leading-tight text-slate-900">
                  {selectedTask.title || selectedTask.name}
                </DialogTitle>
              </div>
            </DialogHeader>
            
            <div className="space-y-5 pt-3">
              
              {/* Meta Data Row */}
              <div className="flex flex-wrap gap-2 pb-4 border-b border-slate-100">
                {projects.find(p => p.id === selectedTask.project_id) && (
                  <Badge className="bg-amber-100 text-amber-800 border-amber-200 px-2 py-1">
                    <Briefcase className="h-3.5 w-3.5 mr-1.5" />
                    {projects.find(p => p.id === selectedTask.project_id)?.name}
                  </Badge>
                )}
                {selectedTask.phase_id && phases.find(p => p.id === selectedTask.phase_id) && (
                  <Badge variant="outline" className="text-slate-600 border-slate-300 px-2 py-1">
                    <GitBranch className="h-3.5 w-3.5 mr-1.5 text-purple-500" />
                    {phases.find(p => p.id === selectedTask.phase_id)?.name}
                  </Badge>
                )}
                {selectedTask.priority && (
                  <Badge variant="outline" className={`border-slate-300 px-2 py-1 ${selectedTask.priority === 'High' || selectedTask.priority === 'Urgent' ? 'text-red-600 font-bold' : 'text-slate-600'}`}>
                    <Flag className={`h-3.5 w-3.5 mr-1.5 ${selectedTask.priority === 'High' || selectedTask.priority === 'Urgent' ? 'text-red-500' : 'text-slate-400'}`} />
                    {selectedTask.priority}
                  </Badge>
                )}
                {(selectedTask.due_date || selectedTask.end_date) && (
                  <Badge variant="outline" className="text-slate-600 border-slate-300 px-2 py-1">
                    <Calendar className="h-3.5 w-3.5 mr-1.5 text-blue-500" />
                    Due: {selectedTask.due_date || selectedTask.end_date}
                  </Badge>
                )}
              </div>

              {/* Description block */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-2">
                  <AlignLeft className="h-4 w-4" /> Task Description
                </h4>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap min-h-[100px]">
                  {selectedTask.description ? selectedTask.description : <span className="text-slate-400 italic">No description provided by the Project Manager.</span>}
                </div>
              </div>

              <TaskWorkflowPanel task={selectedTask} sourceTable={selectedTask.source_table || "project_tasks"} />
              {/* Action Button */}
              <div className="pt-2 mt-4">
                <Button 
                  className={`w-full py-6 text-base font-black shadow-md ${
                    selectedTask.status === "Done" || selectedTask.status === "Completed"
                      ? "bg-slate-100 text-slate-600 hover:bg-slate-200 shadow-none border border-slate-200" 
                      : "bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/20"
                  }`}
                  onClick={() => {
                    const newStatus = selectedTask.status === "Done" || selectedTask.status === "Completed" ? "To Do" : "Done";
                    toggleMutation.mutate({ id: selectedTask.id, newStatus });
                  }}
                  disabled={toggleMutation.isPending}
                >
                  {toggleMutation.isPending 
                    ? "Updating Status..." 
                    : (selectedTask.status === "Done" || selectedTask.status === "Completed" ? "Re-open Task as Incomplete" : "Mark Task as Completed")}
                </Button>
              </div>

            </div>
          </DialogContent>
        </Dialog>
      )}

    </div>
  );
}
