import React, { useState } from "react";
// 1. REPLACED BASE44 WITH SUPABASE
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trash2, Edit, Users, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

export default function ResourceAllocationView({ projectId, tasks = [], allUsers = [] }) {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const queryClient = useQueryClient();
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAlloc, setEditingAlloc] = useState(null);
  const [formData, setFormData] = useState({
    task_id: "none",
    user_id: "",
    allocated_hours: "",
    utilization_percentage: 100,
    allocation_start_date: "",
    allocation_end_date: ""
  });

  // --- 1. FETCH ALLOCATIONS ---
  const { data: allocations = [], isLoading } = useQuery({
    queryKey: ["project-allocations", projectId],
    enabled: !!projectId && !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_allocations")
        .select("*")
        .eq("project_id", projectId);
      if (error) throw error;
      return data || [];
    }
  });

  // --- 2. CREATE MUTATION ---
  const createMutation = useMutation({
    mutationFn: async (data) => {
      const payload = {
        company_id: companyId,
        project_id: projectId,
        task_id: data.task_id === "none" ? null : data.task_id,
        user_id: data.user_id,
        allocated_hours: Number(data.allocated_hours) || 0,
        utilization_percentage: Number(data.utilization_percentage) || 100,
        allocation_start_date: data.allocation_start_date || null,
        allocation_end_date: data.allocation_end_date || null
      };
      const { error } = await supabase.from("project_allocations").insert([payload]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-allocations", projectId] });
      setDialogOpen(false);
      resetForm();
      toast.success("Resource allocated!");
    },
    onError: (err) => toast.error(`Failed: ${err.message}`)
  });

  // --- 3. UPDATE MUTATION ---
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const payload = {
        task_id: data.task_id === "none" ? null : data.task_id,
        user_id: data.user_id,
        allocated_hours: Number(data.allocated_hours) || 0,
        utilization_percentage: Number(data.utilization_percentage) || 100,
        allocation_start_date: data.allocation_start_date || null,
        allocation_end_date: data.allocation_end_date || null
      };
      const { error } = await supabase.from("project_allocations").update(payload).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-allocations", projectId] });
      setDialogOpen(false);
      resetForm();
      toast.success("Allocation updated!");
    },
    onError: (err) => toast.error(`Failed: ${err.message}`)
  });

  // --- 4. DELETE MUTATION ---
  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("project_allocations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-allocations", projectId] });
      toast.success("Allocation removed");
    }
  });

  const resetForm = () => {
    setFormData({ task_id: "none", user_id: "", allocated_hours: "", utilization_percentage: 100, allocation_start_date: "", allocation_end_date: "" });
    setEditingAlloc(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (editingAlloc) {
      await updateMutation.mutateAsync({ id: editingAlloc.id, data: formData });
    } else {
      await createMutation.mutateAsync(formData);
    }
  };

  const handleEdit = (alloc) => {
    setEditingAlloc(alloc);
    setFormData({
      task_id: alloc.task_id || "none",
      user_id: alloc.user_id || "",
      allocated_hours: alloc.allocated_hours || "",
      utilization_percentage: alloc.utilization_percentage || 100,
      allocation_start_date: alloc.allocation_start_date || "",
      allocation_end_date: alloc.allocation_end_date || ""
    });
    setDialogOpen(true);
  };

  const getTaskName = (taskId) => {
    if (!taskId || taskId === "none") return "General Project Work";
    return tasks.find(t => t.id === taskId)?.title || "Unknown Task";
  };
  const getUserName = (userId) => allUsers.find(u => u.id === userId)?.full_name || "Unknown User";

  // Calculate user load
  const userUtilization = {};
  allocations.forEach(alloc => {
    if (!userUtilization[alloc.user_id]) userUtilization[alloc.user_id] = 0;
    userUtilization[alloc.user_id] += Number(alloc.utilization_percentage) || 0;
  });

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex justify-between items-center bg-slate-50 border border-slate-200 p-4 rounded-xl shadow-sm">
        <div>
          <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <Users className="h-5 w-5 text-amber-500" /> Resource Allocation
          </h2>
          <p className="text-xs font-bold text-slate-500 mt-1 uppercase tracking-wider">Manage team capacity</p>
        </div>
        <Button size="sm" onClick={() => { resetForm(); setDialogOpen(true); }} className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold shadow-sm">
          <Plus className="h-4 w-4 mr-1.5" /> Assign Resource
        </Button>
      </div>

      {/* Team Utilization Overview */}
      <Card className="p-5 border-slate-200 shadow-sm bg-white">
        <h4 className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-4 border-b border-slate-100 pb-2">Current Team Utilization</h4>
        
        {Object.keys(userUtilization).length === 0 ? (
          <p className="text-sm text-slate-400 italic text-center py-4">No team members allocated to this project yet.</p>
        ) : (
          <div className="space-y-3">
            {allUsers.filter(u => userUtilization[u.id]).map(user => {
              const util = userUtilization[user.id] || 0;
              const isOverallocated = util > 100;
              
              return (
                <div key={user.id} className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-800 w-48 truncate">{user.full_name || user.email}</span>
                  <div className="flex items-center gap-3 flex-1 ml-4">
                    <div className="h-2.5 flex-1 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className={`h-full transition-all ${isOverallocated ? "bg-red-500" : "bg-emerald-500"}`} 
                        style={{ width: `${Math.min(util, 100)}%` }} 
                      />
                    </div>
                    <span className={`text-xs font-black w-12 text-right ${isOverallocated ? "text-red-600" : "text-emerald-600"}`}>
                      {util}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Allocations List */}
      <div className="space-y-3">
        {allocations.map(alloc => (
          <Card key={alloc.id} className="p-4 border-slate-200 shadow-sm bg-white hover:border-amber-300 transition-colors">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                    {getUserName(alloc.user_id)}
                  </span>
                  <span className="text-sm font-bold text-slate-900">{getTaskName(alloc.task_id)}</span>
                </div>
                
                <div className="flex items-center gap-4 mt-3 text-xs font-bold text-slate-500">
                  <span className="bg-amber-50 text-amber-700 px-2 py-1 rounded">
                    {alloc.allocated_hours || 0} Hours
                  </span>
                  <span className={`${alloc.utilization_percentage > 100 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'} px-2 py-1 rounded`}>
                    {alloc.utilization_percentage || 100}% Utilization
                  </span>
                  {(alloc.allocation_start_date || alloc.allocation_end_date) && (
                    <span className="border border-slate-200 px-2 py-1 rounded">
                      {alloc.allocation_start_date ? format(new Date(alloc.allocation_start_date), "MMM d") : "..."} 
                      {" -> "} 
                      {alloc.allocation_end_date ? format(new Date(alloc.allocation_end_date), "MMM d") : "..."}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0 ml-4">
                <Button size="icon" variant="ghost" onClick={() => handleEdit(alloc)} className="h-8 w-8 text-slate-400 hover:text-blue-600 hover:bg-blue-50">
                  <Edit className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => { if(window.confirm("Remove allocation?")) deleteMutation.mutate(alloc.id); }} className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* DIALOG FORM */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md bg-slate-50 border-slate-200 shadow-xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="font-black text-xl flex items-center gap-2">
              <Users className="h-5 w-5 text-amber-500" /> {editingAlloc ? "Edit Allocation" : "Assign Resource"}
            </DialogTitle>
          </DialogHeader>
          
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div>
              <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Assign To *</Label>
              <Select value={formData.user_id} onValueChange={v => setFormData({...formData, user_id: v})} required>
                <SelectTrigger className="font-bold bg-white"><SelectValue placeholder="Select team member" /></SelectTrigger>
                <SelectContent>
                  {allUsers.map(u => <SelectItem key={u.id} value={u.id} className="font-bold">{u.full_name || u.email}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Link to Task</Label>
              <Select value={formData.task_id} onValueChange={v => setFormData({...formData, task_id: v})}>
                <SelectTrigger className="font-bold bg-white"><SelectValue placeholder="General Project Work" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="font-bold italic text-slate-500">— General Project Work —</SelectItem>
                  {tasks.map(t => <SelectItem key={t.id} value={t.id} className="font-bold">{t.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Estimated Hours</Label>
                <Input type="number" step="0.5" className="font-bold bg-white" value={formData.allocated_hours} onChange={e => setFormData({...formData, allocated_hours: e.target.value})} placeholder="e.g. 40" />
              </div>
              <div>
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Time Utilization (%)</Label>
                <Input type="number" min="0" max="100" className="font-bold bg-white" value={formData.utilization_percentage} onChange={e => setFormData({...formData, utilization_percentage: Number(e.target.value)})} />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Start Date</Label>
                <Input type="date" className="font-medium bg-white" value={formData.allocation_start_date} onChange={e => setFormData({...formData, allocation_start_date: e.target.value})} />
              </div>
              <div>
                <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">End Date</Label>
                <Input type="date" className="font-medium bg-white" value={formData.allocation_end_date} onChange={e => setFormData({...formData, allocation_end_date: e.target.value})} />
              </div>
            </div>
            
            <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} className="font-bold border-slate-300">Cancel</Button>
              <Button type="submit" className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md" disabled={!formData.user_id || createMutation.isPending || updateMutation.isPending}>
                {editingAlloc ? "Update Allocation" : "Assign Resource"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}