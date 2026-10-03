import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Edit2, TrendingUp } from "lucide-react";
import { format } from "date-fns";
import GoalCard from "../components/goals/GoalCard";

const statusOptions = ["Not Started", "In Progress", "On Track", "At Risk", "Completed"];
const priorityOptions = ["Low", "Medium", "High", "Critical"];

export default function StrategicGoals() {
  const [showGoalDialog, setShowGoalDialog] = useState(false);
  const [editingGoal, setEditingGoal] = useState(null);
  const [showKpiDialog, setShowKpiDialog] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState(null);
  const [editingKpi, setEditingKpi] = useState(null);

  const queryClient = useQueryClient();

  const { data: goals = [] } = useQuery({
    queryKey: ["strategicGoals"],
    queryFn: () => base44.entities.StrategicGoal.list()
  });

  const { data: kpis = [] } = useQuery({
    queryKey: ["kpis"],
    queryFn: () => base44.entities.KPI.list()
  });

  const businessGoals = goals.filter(g => g.goal_type === "Business");

  const createGoalMutation = useMutation({
    mutationFn: (data) => base44.entities.StrategicGoal.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["strategicGoals"] });
      setShowGoalDialog(false);
    }
  });

  const updateGoalMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.StrategicGoal.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["strategicGoals"] });
      setShowGoalDialog(false);
      setEditingGoal(null);
    }
  });

  const deleteGoalMutation = useMutation({
    mutationFn: (id) => base44.entities.StrategicGoal.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["strategicGoals"] });
    }
  });

  const createKpiMutation = useMutation({
    mutationFn: (data) => base44.entities.KPI.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kpis"] });
      setShowKpiDialog(false);
      setSelectedGoal(null);
    }
  });

  const updateKpiMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.KPI.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kpis"] });
      setShowKpiDialog(false);
      setEditingKpi(null);
    }
  });

  const deleteKpiMutation = useMutation({
    mutationFn: (id) => base44.entities.KPI.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kpis"] });
    }
  });

  const handleGoalSubmit = (e, data) => {
    e.preventDefault();
    if (editingGoal) {
      updateGoalMutation.mutate({ id: editingGoal.id, data });
    } else {
      createGoalMutation.mutate(data);
    }
  };

  const handleKpiSubmit = (e, data) => {
    e.preventDefault();
    if (editingKpi) {
      updateKpiMutation.mutate({ id: editingKpi.id, data });
    } else {
      createKpiMutation.mutate(data);
    }
  };

  const goalsWithKpis = businessGoals.map(goal => ({
    ...goal,
    kpis: kpis.filter(k => k.goal_id === goal.id)
  }));

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Strategic Goals & KPIs</h1>
          <p className="text-slate-600 mt-1">Track business goals and measure key performance indicators</p>
        </div>
        <Dialog open={showGoalDialog} onOpenChange={setShowGoalDialog}>
          <DialogTrigger asChild>
            <Button onClick={() => setEditingGoal(null)} className="gap-2">
              <Plus className="h-4 w-4" />
              New Goal
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editingGoal ? "Edit Goal" : "Create Strategic Goal"}</DialogTitle>
            </DialogHeader>
            <GoalForm
              goal={editingGoal}
              onSubmit={(data) => handleGoalSubmit(null, data)}
              isLoading={createGoalMutation.isPending || updateGoalMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>

      {businessGoals.length === 0 ? (
        <Card className="p-12 text-center bg-gradient-to-br from-slate-50 to-slate-100">
          <TrendingUp className="h-12 w-12 text-slate-300 mx-auto mb-4" />
          <h3 className="font-semibold text-slate-900 mb-2">No strategic goals yet</h3>
          <p className="text-slate-600 mb-4">Create business goals to start tracking progress and KPIs</p>
          <Button onClick={() => setShowGoalDialog(true)}>Create First Goal</Button>
        </Card>
      ) : (
        <div className="grid gap-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {goalsWithKpis.map(goal => (
              <div key={goal.id} className="relative">
                <GoalCard goal={goal} kpis={goal.kpis} />
                <div className="absolute top-4 right-4 flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditingGoal(goal);
                      setShowGoalDialog(true);
                    }}
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteGoalMutation.mutate(goal.id)}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>

                {/* KPIs for this goal */}
                <Card className="mt-4 bg-slate-50">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">Key Performance Indicators</CardTitle>
                      <Dialog open={showKpiDialog && selectedGoal?.id === goal.id} onOpenChange={setShowKpiDialog}>
                        <DialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedGoal(goal);
                              setEditingKpi(null);
                            }}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-md">
                          <DialogHeader>
                            <DialogTitle>{editingKpi ? "Edit KPI" : "Add KPI"}</DialogTitle>
                          </DialogHeader>
                          <KpiForm
                            kpi={editingKpi}
                            goalId={goal.id}
                            onSubmit={(data) => handleKpiSubmit(null, data)}
                            isLoading={createKpiMutation.isPending || updateKpiMutation.isPending}
                          />
                        </DialogContent>
                      </Dialog>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {goal.kpis.length === 0 ? (
                      <p className="text-xs text-slate-500 text-center py-4">No KPIs yet</p>
                    ) : (
                      goal.kpis.map(kpi => (
                        <div key={kpi.id} className="flex items-center justify-between p-2 bg-white rounded border border-slate-200">
                          <div>
                            <p className="text-sm font-medium text-slate-900">{kpi.name}</p>
                            <p className="text-xs text-slate-600">
                              {kpi.current_value}/{kpi.target_value} {kpi.unit}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Badge variant="outline" className="text-xs">{kpi.status}</Badge>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setEditingKpi(kpi);
                                setSelectedGoal(goal);
                                setShowKpiDialog(true);
                              }}
                            >
                              <Edit2 className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => deleteKpiMutation.mutate(kpi.id)}
                            >
                              <Trash2 className="h-3 w-3 text-red-500" />
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GoalForm({ goal, onSubmit, isLoading }) {
  const [formData, setFormData] = React.useState(goal || {
    goal_type: "Business",
    title: "",
    description: "",
    status: "Not Started",
    priority: "Medium",
    target_date: "",
    progress_percentage: 0
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-sm font-medium">Title</label>
        <Input
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          placeholder="Goal title"
          required
        />
      </div>
      <div>
        <label className="text-sm font-medium">Description</label>
        <Textarea
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="Goal description"
          className="h-24"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium">Status</label>
          <Select value={formData.status} onValueChange={(val) => setFormData({ ...formData, status: val })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-sm font-medium">Priority</label>
          <Select value={formData.priority} onValueChange={(val) => setFormData({ ...formData, priority: val })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {priorityOptions.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <label className="text-sm font-medium">Target Date</label>
        <Input
          type="date"
          value={formData.target_date}
          onChange={(e) => setFormData({ ...formData, target_date: e.target.value })}
        />
      </div>
      <div>
        <label className="text-sm font-medium">Progress %</label>
        <Input
          type="number"
          min="0"
          max="100"
          value={formData.progress_percentage}
          onChange={(e) => setFormData({ ...formData, progress_percentage: Number(e.target.value) })}
        />
      </div>
      <Button type="submit" disabled={isLoading} className="w-full">
        {isLoading ? "Saving..." : goal ? "Update Goal" : "Create Goal"}
      </Button>
    </form>
  );
}

function KpiForm({ kpi, goalId, onSubmit, isLoading }) {
  const [formData, setFormData] = React.useState(kpi || {
    goal_id: goalId,
    name: "",
    metric: "",
    unit: "%",
    target_value: 0,
    current_value: 0,
    status: "On Track"
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-sm font-medium">KPI Name</label>
        <Input
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="e.g., Revenue Growth"
          required
        />
      </div>
      <div>
        <label className="text-sm font-medium">Metric</label>
        <Input
          value={formData.metric}
          onChange={(e) => setFormData({ ...formData, metric: e.target.value })}
          placeholder="What is being measured"
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium">Unit</label>
          <Input
            value={formData.unit}
            onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
            placeholder="%, $, count, etc."
          />
        </div>
        <div>
          <label className="text-sm font-medium">Target Value</label>
          <Input
            type="number"
            value={formData.target_value}
            onChange={(e) => setFormData({ ...formData, target_value: Number(e.target.value) })}
            required
          />
        </div>
      </div>
      <div>
        <label className="text-sm font-medium">Current Value</label>
        <Input
          type="number"
          value={formData.current_value}
          onChange={(e) => setFormData({ ...formData, current_value: Number(e.target.value) })}
        />
      </div>
      <Button type="submit" disabled={isLoading} className="w-full">
        {isLoading ? "Saving..." : kpi ? "Update KPI" : "Add KPI"}
      </Button>
    </form>
  );
}