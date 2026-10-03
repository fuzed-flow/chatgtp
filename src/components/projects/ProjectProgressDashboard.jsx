import React from "react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { AlertCircle, CheckCircle2, Clock, TrendingUp } from "lucide-react";
import { differenceInDays, format } from "date-fns";

export default function ProjectProgressDashboard({ project, tasks = [], timeLogs = [], allocations = [] }) {
  const completedTasks = tasks.filter(t => t.status === "Done").length;
  const totalTasks = tasks.length;
  const completionRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;
  
  const overdueTasks = tasks.filter(t => t.due_date && new Date(t.due_date) < new Date() && t.status !== "Done");
  const upcomingTasks = tasks.filter(t => t.due_date && new Date(t.due_date) > new Date() && t.status !== "Done");
  
  const totalEstimatedHours = tasks.reduce((sum, t) => sum + (t.estimated_hours || 0), 0);
  const totalActualHours = timeLogs.reduce((sum, t) => sum + (t.hours || 0), 0);
  const hourVariance = totalEstimatedHours > 0 ? ((totalActualHours - totalEstimatedHours) / totalEstimatedHours) * 100 : 0;
  
  const startDate = new Date(project.start_date);
  const endDate = new Date(project.target_end_date);
  const totalDays = differenceInDays(endDate, startDate);
  const daysElapsed = differenceInDays(new Date(), startDate);
  const scheduleProgress = Math.min((daysElapsed / totalDays) * 100, 100);
  
  const budgetUtilization = project.budget > 0 ? (project.actual_cost / project.budget) * 100 : 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Task Completion */}
      <Card className="p-4 border-slate-200/60">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-slate-600 uppercase">Task Completion</p>
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        </div>
        <p className="text-2xl font-bold text-slate-900">{completedTasks}/{totalTasks}</p>
        <Progress value={completionRate} className="mt-3 h-2" />
        <p className="text-xs text-slate-500 mt-2">{Math.round(completionRate)}% complete</p>
      </Card>

      {/* Time Tracking */}
      <Card className="p-4 border-slate-200/60">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-slate-600 uppercase">Time Tracking</p>
          <Clock className="h-4 w-4 text-blue-500" />
        </div>
        <p className="text-2xl font-bold text-slate-900">{totalActualHours.toFixed(1)}h</p>
        <p className="text-xs text-slate-500 mt-2">Est. {totalEstimatedHours}h</p>
        <p className={`text-xs font-semibold mt-1 ${hourVariance > 10 ? "text-red-600" : "text-green-600"}`}>
          {hourVariance > 0 ? "+" : ""}{Math.round(hourVariance)}% variance
        </p>
      </Card>

      {/* Schedule Progress */}
      <Card className="p-4 border-slate-200/60">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-slate-600 uppercase">Schedule</p>
          <TrendingUp className="h-4 w-4 text-amber-500" />
        </div>
        <p className="text-2xl font-bold text-slate-900">{Math.round(scheduleProgress)}%</p>
        <Progress value={scheduleProgress} className="mt-3 h-2" />
        <p className="text-xs text-slate-500 mt-2">{format(endDate, "MMM d, yyyy")}</p>
      </Card>

      {/* Budget */}
      <Card className="p-4 border-slate-200/60">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-slate-600 uppercase">Budget</p>
          <TrendingUp className={`h-4 w-4 ${budgetUtilization > 100 ? "text-red-500" : "text-green-500"}`} />
        </div>
        <p className="text-2xl font-bold text-slate-900">${(project.actual_cost || 0).toLocaleString()}</p>
        <p className="text-xs text-slate-500 mt-2">of ${(project.budget || 0).toLocaleString()}</p>
        <p className={`text-xs font-semibold mt-1 ${budgetUtilization > 100 ? "text-red-600" : "text-green-600"}`}>
          {Math.round(budgetUtilization)}% utilized
        </p>
      </Card>

      {/* Overdue Tasks */}
      {overdueTasks.length > 0 && (
        <Card className="p-4 border-red-200 bg-red-50/50 md:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="h-4 w-4 text-red-500" />
            <p className="text-sm font-semibold text-red-600">{overdueTasks.length} Overdue Tasks</p>
          </div>
          <div className="space-y-1">
            {overdueTasks.slice(0, 3).map(t => (
              <p key={t.id} className="text-xs text-slate-600">{t.title}</p>
            ))}
          </div>
        </Card>
      )}

      {/* Upcoming Tasks */}
      {upcomingTasks.length > 0 && (
        <Card className="p-4 border-blue-200 bg-blue-50/50 md:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="h-4 w-4 text-blue-500" />
            <p className="text-sm font-semibold text-blue-600">Next 7 Days</p>
          </div>
          <div className="space-y-1">
            {upcomingTasks.slice(0, 3).map(t => (
              <p key={t.id} className="text-xs text-slate-600">{t.title}</p>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}