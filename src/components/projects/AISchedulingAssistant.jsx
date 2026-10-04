import React, { useState } from "react";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sparkles, Calendar, Users, AlertTriangle, TrendingUp, Clock, CheckCircle2, Loader2, Zap } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export default function AISchedulingAssistant({ projectId, onScheduleGenerated }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [schedule, setSchedule] = useState(null);
  const [draftId, setDraftId] = useState(null);
  const [applyingSchedule, setApplyingSchedule] = useState(false);

  const generateSchedule = async () => {
    setLoading(true);
    try {
      const response = await supabase.functions.invoke('generate-project-schedule', {body: {project_id:projectId}});
      if(response.error || response.data?.error) throw new Error(response.data?.error || 'Draft generation failed');
      
      if (response.data.success) {
        setSchedule(response.data.schedule);
        setDraftId(response.data.draft_id);
        toast.success("Schedule draft ready. Review dates, tasks and assumptions.");
      } else {
        toast.error("Failed to generate schedule");
      }
    } catch (error) {
      console.error('Schedule generation error:', error);
      toast.error(error.message || "Failed to generate schedule");
    } finally {
      setLoading(false);
    }
  };

  const applySchedule = async () => {
    if (!schedule) return;
    
    setApplyingSchedule(true);
    try {
      const {data:taskCount,error}=await supabase.rpc('apply_project_schedule',{p_draft:draftId});
      if(error)throw error;
      toast.success(`Applied schedule: ${taskCount} tasks created`);
      setOpen(false);
      if (onScheduleGenerated) onScheduleGenerated();
    } catch (error) {
      console.error('Error applying schedule:', error);
      toast.error("Failed to apply schedule");
    } finally {
      setApplyingSchedule(false);
    }
  };

  const getSeverityColor = (severity) => {
    const colors = {
      high: "bg-red-100 text-red-800 border-red-200",
      medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
      low: "bg-blue-100 text-blue-800 border-blue-200"
    };
    return colors[severity?.toLowerCase()] || colors.medium;
  };

  const getUtilizationColor = (percentage) => {
    if (percentage > 100) return "text-red-600";
    if (percentage > 80) return "text-yellow-600";
    return "text-green-600";
  };

  return (
    <>
      <Button 
        onClick={() => {
          setOpen(true);
          if (!schedule) generateSchedule();
        }}
        className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700"
      >
        <Sparkles className="h-4 w-4 mr-2" />
        Schedule Draft
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Sparkles className="h-5 w-5 text-purple-600" />
              Review a Schedule Draft
            </DialogTitle>
          </DialogHeader>

          {loading && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-12 w-12 text-purple-600 animate-spin mb-4" />
              <p className="text-slate-600">Preparing a planning draft for review…</p>
              <p className="text-sm text-slate-400 mt-2">This may take a few moments</p>
            </div>
          )}

          {!loading && !schedule && (
            <div className="text-center py-8">
              <Button onClick={generateSchedule} size="lg" className="bg-purple-600 hover:bg-purple-700">
                <Zap className="h-5 w-5 mr-2" />
                Prepare a Schedule Draft
              </Button>
            </div>
          )}

          <p className="text-sm text-slate-600">This draft uses your existing dates and phases. Review its unassigned planning tasks against site conditions and crew availability. Zero hours means effort is unestimated. Applying adds tasks and updates project dates. Weather and crew conflicts require your review.</p>
          {schedule && (
            <div className="space-y-6">
              {/* Timeline Overview */}
              <Card className="p-4 bg-gradient-to-br from-purple-50 to-indigo-50 border-purple-200">
                <div className="flex items-center gap-2 mb-3">
                  <Calendar className="h-5 w-5 text-purple-600" />
                  <h3 className="font-semibold text-slate-900">Project Timeline</h3>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs text-slate-600">Start Date</p>
                    <p className="text-sm font-bold text-slate-900">
                      {format(new Date(schedule.timeline.project_start), "MMM d, yyyy")}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-600">End Date</p>
                    <p className="text-sm font-bold text-slate-900">
                      {format(new Date(schedule.timeline.project_end), "MMM d, yyyy")}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-600">Duration</p>
                    <p className="text-sm font-bold text-slate-900">
                      {schedule.timeline.total_working_days} days
                    </p>
                  </div>
                </div>
              </Card>

              {/* Bottlenecks */}
              {schedule.bottlenecks?.length > 0 && (
                <Card className="p-4 border-amber-200 bg-amber-50/50">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                    <h3 className="font-semibold text-slate-900">Potential Bottlenecks</h3>
                  </div>
                  <div className="space-y-2">
                    {schedule.bottlenecks.map((bottleneck, idx) => (
                      <div key={idx} className={`p-3 rounded-lg border ${getSeverityColor(bottleneck.severity)}`}>
                        <div className="flex items-start justify-between mb-1">
                          <p className="font-medium text-sm">{bottleneck.type}</p>
                          <span className="text-xs font-bold uppercase">{bottleneck.severity}</span>
                        </div>
                        <p className="text-sm mb-2">{bottleneck.description}</p>
                        <p className="text-xs font-medium">💡 {bottleneck.recommendation}</p>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Resource Analysis */}
              {schedule.resource_analysis?.length > 0 && (
                <Card className="p-4 border-slate-200">
                  <div className="flex items-center gap-2 mb-3">
                    <Users className="h-5 w-5 text-slate-700" />
                    <h3 className="font-semibold text-slate-900">Resource Utilization</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {schedule.resource_analysis.map((resource, idx) => (
                      <div key={idx} className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                        <div className="flex items-center justify-between mb-2">
                          <p className="font-medium text-sm text-slate-900">{resource.resource_name}</p>
                          <span className={`text-xs font-bold ${getUtilizationColor(resource.utilization_percentage)}`}>
                            {resource.utilization_percentage}%
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-600">
                          <Clock className="h-3 w-3" />
                          <span>{resource.total_hours_allocated}h allocated</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Phases & Tasks */}
              <div className="space-y-3">
                <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  Phases & Tasks ({schedule.phases.reduce((sum, p) => sum + p.tasks.length, 0)} total)
                </h3>
                {schedule.phases.map((phase, phaseIdx) => (
                  <Card key={phaseIdx} className="p-4 border-slate-200">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-semibold text-slate-900">{phase.phase_name}</h4>
                      <div className="text-xs text-slate-600">
                        {format(new Date(phase.start_date), "MMM d")} - {format(new Date(phase.end_date), "MMM d")}
                      </div>
                    </div>
                    <div className="space-y-2">
                      {phase.tasks.map((task, taskIdx) => (
                        <div key={taskIdx} className="p-2 bg-slate-50 rounded border border-slate-200">
                          <div className="flex items-start justify-between mb-1">
                            <div className="flex-1">
                              <p className="font-medium text-sm text-slate-900">{task.title}</p>
                              {task.description && (
                                <p className="text-xs text-slate-600 mt-1">{task.description}</p>
                              )}
                            </div>
                            <div className="text-xs bg-slate-200 px-2 py-0.5 rounded text-slate-700 ml-2">
                              {task.priority}
                            </div>
                          </div>
                          <div className="flex items-center gap-4 text-xs text-slate-600 mt-2">
                            {task.assigned_to_name && (
                              <div className="flex items-center gap-1">
                                <Users className="h-3 w-3" />
                                {task.assigned_to_name}
                              </div>
                            )}
                            <div className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {task.estimated_hours}h
                            </div>
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              Due: {format(new Date(task.due_date), "MMM d")}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>

              {/* Insights */}
              {schedule.insights && (
                <Card className="p-4 border-green-200 bg-green-50/50">
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingUp className="h-5 w-5 text-green-600" />
                    <h3 className="font-semibold text-slate-900">Draft assumptions & suggestions</h3>
                  </div>
                  <div className="space-y-3">
                    {schedule.insights.critical_path?.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-slate-700 mb-1">Critical Path:</p>
                        <p className="text-sm text-slate-600">{schedule.insights.critical_path.join(" → ")}</p>
                      </div>
                    )}
                    {schedule.insights.recommended_adjustments?.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-slate-700 mb-1">Recommendations:</p>
                        <ul className="space-y-1">
                          {schedule.insights.recommended_adjustments.map((rec, idx) => (
                            <li key={idx} className="text-sm text-slate-600 flex items-start gap-2">
                              <span className="text-green-600">•</span>
                              <span>{rec}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </Card>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={generateSchedule} 
                  variant="outline"
                  disabled={loading}
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  Regenerate
                </Button>
                <Button 
                  onClick={applySchedule}
                  disabled={applyingSchedule}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {applyingSchedule ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Applying...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Apply Schedule to Project
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
