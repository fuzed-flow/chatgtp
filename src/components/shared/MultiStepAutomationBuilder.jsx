import React, { useState } from "react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Plus, X, GripVertical, Zap, Loader2 } from "lucide-react";
import { toast } from "sonner";

const STEP_TYPES = [
  { value: "send_email", label: "Send Email" },
  { value: "create_task", label: "Create Task" },
  { value: "update_entity", label: "Update Record" },
  { value: "send_notification", label: "Send App Notification" },
  { value: "delay", label: "Wait / Delay" },
];

export default function MultiStepAutomationBuilder({ automationId, onStepsSaved }) {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [newStep, setNewStep] = useState({ action_type: "" });

  // FETCH AUTOMATION STEPS
  const { data: steps = [], isLoading } = useQuery({
    queryKey: ["automation-steps", automationId],
    enabled: !!automationId && !!companyId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("automation_steps")
        .select("*")
        .eq("automation_id", automationId)
        .order("step_order", { ascending: true });
      if (error) throw error;
      return data || [];
    }
  });

  const createStepMutation = useMutation({
    mutationFn: async (stepData) => {
      const { error } = await supabase.from("automation_steps").insert([stepData]);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automation-steps", automationId] });
      setNewStep({ action_type: "" });
      toast.success("Step added to sequence.");
    },
    onError: (err) => toast.error(err.message)
  });

  const deleteStepMutation = useMutation({
    mutationFn: async (stepId) => {
      const { error } = await supabase.from("automation_steps").delete().eq("id", stepId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automation-steps", automationId] });
      toast.success("Step removed.");
    },
    onError: (err) => toast.error(err.message)
  });

  const handleAddStep = () => {
    if (!newStep.action_type) return;

    const stepData = {
      automation_id: automationId,
      company_id: companyId,
      step_order: steps.length + 1,
      action_type: newStep.action_type,
      action_config: newStep.config || {},
      is_active: true,
    };

    createStepMutation.mutate(stepData);
  };

  const renderStepConfig = (stepType) => {
    switch (stepType) {
      case "send_email":
        return (
          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Recipient Email</label>
              <Input className="font-medium bg-white" placeholder="e.g. client@email.com or {client.email}" value={newStep.config?.to || ""} onChange={(e) => setNewStep({ ...newStep, config: { ...newStep.config, to: e.target.value } })} />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Subject Line</label>
              <Input className="font-bold bg-white" placeholder="Email subject..." value={newStep.config?.subject || ""} onChange={(e) => setNewStep({ ...newStep, config: { ...newStep.config, subject: e.target.value } })} />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Message Body</label>
              <Textarea className="font-medium bg-white text-sm" rows={4} placeholder="Type the automated message..." value={newStep.config?.body || ""} onChange={(e) => setNewStep({ ...newStep, config: { ...newStep.config, body: e.target.value } })} />
            </div>
          </div>
        );

      case "create_task":
        return (
          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Task Title</label>
              <Input className="font-bold bg-white" placeholder="e.g. Follow up on quote" value={newStep.config?.title || ""} onChange={(e) => setNewStep({ ...newStep, config: { ...newStep.config, title: e.target.value } })} />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Task Description</label>
              <Textarea className="font-medium bg-white text-sm" rows={3} placeholder="Task instructions..." value={newStep.config?.description || ""} onChange={(e) => setNewStep({ ...newStep, config: { ...newStep.config, description: e.target.value } })} />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Initial Status</label>
              <Select value={newStep.config?.status || "To Do"} onValueChange={(value) => setNewStep({ ...newStep, config: { ...newStep.config, status: value } })}>
                <SelectTrigger className="font-bold bg-white"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="To Do" className="font-bold">To Do</SelectItem>
                  <SelectItem value="In Progress" className="font-bold">In Progress</SelectItem>
                  <SelectItem value="Done" className="font-bold">Done</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        );

      case "delay":
        return (
          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Wait Time (in Days)</label>
            <Input className="font-black bg-white" type="number" placeholder="e.g. 3" value={newStep.config?.delay_days || ""} onChange={(e) => setNewStep({ ...newStep, config: { ...newStep.config, delay_days: parseInt(e.target.value) || 0 } })} />
          </div>
        );

      default:
        return <p className="text-xs text-slate-500 italic mt-2">No additional configuration needed.</p>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 font-bold text-slate-700 border-slate-300 hover:border-amber-400 hover:bg-amber-50 transition-colors shadow-sm">
          <Zap className="h-4 w-4 text-amber-500" />
          Sequence Builder
        </Button>
      </DialogTrigger>
      
      <DialogContent className="max-w-2xl bg-slate-50 border-slate-200 shadow-xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="font-black text-xl text-slate-900 flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-500" /> Automation Sequence Builder
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2 max-h-[70vh] overflow-y-auto pr-1">
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 text-amber-500 animate-spin" /></div>
          ) : steps.length > 0 && (
            <div className="space-y-3">
              {steps.map((step, idx) => {
                const stepLabel = STEP_TYPES.find(t => t.value === step.action_type)?.label || step.action_type;
                return (
                  <Card key={step.id} className="p-3 flex items-start gap-3 bg-white border border-slate-200 shadow-sm relative group">
                    <div className="h-6 w-6 bg-slate-100 rounded-md flex items-center justify-center shrink-0 border border-slate-200">
                      <span className="text-xs font-black text-slate-500">{idx + 1}</span>
                    </div>
                    <div className="flex-1 min-w-0 mt-0.5">
                      <p className="font-black text-sm text-slate-900">{stepLabel}</p>
                      {step.action_config && Object.keys(step.action_config).length > 0 && (
                        <div className="mt-1.5 bg-slate-50 p-2 rounded text-xs font-medium text-slate-600 border border-slate-100">
                          {step.action_type === "send_email" && `To: ${step.action_config.to} | Subj: ${step.action_config.subject}`}
                          {step.action_type === "delay" && `Wait: ${step.action_config.delay_days} days`}
                          {step.action_type === "create_task" && `Task: ${step.action_config.title}`}
                        </div>
                      )}
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(step.id)} className="h-7 w-7 text-slate-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity">
                      <X className="h-4 w-4" />
                    </Button>
                  </Card>
                );
              })}
            </div>
          )}

          <Card className="p-5 bg-white border border-slate-200 shadow-sm">
            <h4 className="text-[11px] font-black uppercase tracking-wider text-slate-500 mb-4 border-b border-slate-100 pb-2">Add Next Step</h4>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Action Type</label>
                <Select value={newStep.action_type} onValueChange={(value) => setNewStep({ action_type: value, config: {} })}>
                  <SelectTrigger className="font-bold bg-slate-50"><SelectValue placeholder="Select an action to perform" /></SelectTrigger>
                  <SelectContent>
                    {STEP_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value} className="font-bold">{type.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {newStep.action_type && (
                <div className="pt-2 border-t border-slate-100">
                  {renderStepConfig(newStep.action_type)}
                </div>
              )}

              <Button
                onClick={handleAddStep}
                disabled={!newStep.action_type || createStepMutation.isPending}
                className="w-full gap-2 bg-slate-900 hover:bg-slate-800 text-white font-bold"
              >
                {createStepMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add Step to Sequence
              </Button>
            </div>
          </Card>
        </div>

        <div className="flex gap-2 justify-end pt-4 border-t border-slate-200 mt-2">
          <Button variant="outline" onClick={() => setOpen(false)} className="font-bold border-slate-300">
            Close Panel
          </Button>
          <Button
            onClick={() => {
              if (onStepsSaved) onStepsSaved();
              setOpen(false);
              toast.success("Automation sequence activated.");
            }}
            className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md min-w-[140px]"
          >
            Save & Activate
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}