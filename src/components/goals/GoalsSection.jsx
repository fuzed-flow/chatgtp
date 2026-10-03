import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Target, Plus, Trash2, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export default function GoalsSection() {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  
  const [form, setForm] = useState({
    title: "",
    target_value: "",
    current_value: "0",
    metric_type: "revenue",
    deadline: ""
  });

  const { data: goals = [], isLoading } = useQuery({
    queryKey: ["company_goals", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("goals")
        .select("*")
        .eq("company_id", companyId)
        .order("deadline", { ascending: true });
      if (error) throw error;
      return data || [];
    }
  });

  const createGoalMutation = useMutation({
    mutationFn: async (newGoal) => {
      const { error } = await supabase.from("goals").insert([{
        company_id: companyId,
        title: newGoal.title,
        target_value: parseFloat(newGoal.target_value) || 0,
        current_value: parseFloat(newGoal.current_value) || 0,
        metric_type: newGoal.metric_type,
        deadline: newGoal.deadline || null
      }]);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["company_goals"] });
      setOpen(false);
      setForm({ title: "", target_value: "", current_value: "0", metric_type: "revenue", deadline: "" });
      toast.success("Goal added successfully!");
    },
    onError: (err) => toast.error(`Failed to add goal: ${err.message}`)
  });

  const deleteGoalMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("goals").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["company_goals"] });
      toast.success("Goal deleted");
    }
  });

  // Very basic progress update for demo purposes
  const updateProgressMutation = useMutation({
    mutationFn: async ({ id, newValue }) => {
      const { error } = await supabase.from("goals").update({ current_value: newValue }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["company_goals"] })
  });

  return (
    <Card className="p-5 border-slate-200 shadow-sm bg-white h-full flex flex-col">
      <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
        <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
          <Target className="h-5 w-5 text-emerald-500" /> Strategic Goals
        </h3>
        
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="font-bold text-xs h-8">
              <Plus className="h-3 w-3 mr-1" /> New Goal
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md bg-white" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle className="font-black text-xl text-slate-900">Add Company Goal</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div>
                <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 block">Goal Title</Label>
                <Input value={form.title} onChange={e => setForm({...form, title: e.target.value})} placeholder="e.g., Q3 Revenue Target" className="font-bold bg-slate-50" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 block">Target Number</Label>
                  <Input type="number" value={form.target_value} onChange={e => setForm({...form, target_value: e.target.value})} className="font-bold bg-slate-50" placeholder="100000" />
                </div>
                <div>
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 block">Starting Value</Label>
                  <Input type="number" value={form.current_value} onChange={e => setForm({...form, current_value: e.target.value})} className="font-bold bg-slate-50" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 block">Metric Type</Label>
                  <Select value={form.metric_type} onValueChange={v => setForm({...form, metric_type: v})}>
                    <SelectTrigger className="font-bold bg-slate-50"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="revenue">Revenue ($)</SelectItem>
                      <SelectItem value="projects">Projects (#)</SelectItem>
                      <SelectItem value="leads">Leads (#)</SelectItem>
                      <SelectItem value="margin">Margin (%)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 block">Target Date</Label>
                  <Input type="date" value={form.deadline} onChange={e => setForm({...form, deadline: e.target.value})} className="font-bold bg-slate-50 text-xs" />
                </div>
              </div>
              <div className="flex justify-end pt-4 border-t border-slate-100">
                <Button 
                  className="bg-emerald-500 hover:bg-emerald-600 text-white font-black w-full shadow-md"
                  onClick={() => createGoalMutation.mutate(form)}
                  disabled={!form.title || !form.target_value || createGoalMutation.isPending}
                >
                  Save Goal
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 pr-2">
        {isLoading ? (
          <p className="text-sm text-slate-400 italic text-center py-4">Loading goals...</p>
        ) : goals.length === 0 ? (
          <div className="text-center py-8">
            <Target className="h-10 w-10 text-slate-200 mx-auto mb-2" />
            <p className="text-sm font-bold text-slate-500">No goals set yet.</p>
          </div>
        ) : (
          goals.map(goal => {
            const pct = Math.min(100, Math.round((goal.current_value / goal.target_value) * 100)) || 0;
            const isMoney = goal.metric_type === 'revenue';
            const isPct = goal.metric_type === 'margin';
            
            const formatVal = (v) => {
              if (isMoney) return `$${v.toLocaleString()}`;
              if (isPct) return `${v}%`;
              return v;
            };

            return (
              <div key={goal.id} className="p-4 bg-slate-50 border border-slate-200 rounded-xl relative group">
                <button 
                  onClick={() => deleteGoalMutation.mutate(goal.id)}
                  className="absolute top-2 right-2 p-1 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="h-4 w-4" />
                </button>

                <p className="font-black text-slate-900 mb-1 pr-6 truncate">{goal.title}</p>
                <div className="flex items-center justify-between text-xs font-bold text-slate-500 mb-2">
                  <span>{formatVal(goal.current_value)}</span>
                  <span>{formatVal(goal.target_value)}</span>
                </div>
                
                {/* The fixed Progress bar call */}
                <Progress value={pct} className="h-2.5 bg-slate-200" indicatorColor={pct >= 100 ? "bg-emerald-500" : "bg-blue-500"} />
                
                <div className="flex items-center justify-between mt-3">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                    {goal.deadline ? `Due ${goal.deadline}` : "No deadline"}
                  </span>
                  
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => updateProgressMutation.mutate({ id: goal.id, newValue: (goal.current_value || 0) + (goal.target_value * 0.1) })}>+10%</Button>
                    {pct >= 100 && <CheckCircle2 className="h-4 w-4 text-emerald-500 ml-1" />}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}