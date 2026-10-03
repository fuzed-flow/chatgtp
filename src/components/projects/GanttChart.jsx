import React, { useMemo } from "react";
import { format, differenceInDays, startOfMonth, endOfMonth, addDays, isBefore, isAfter } from "date-fns";
import { Card } from "@/components/ui/card";
import { ArrowRight } from "lucide-react";

export default function GanttChart({ tasks, dependencies = [] }) {
  const sorted = useMemo(() => {
    if (!tasks || tasks.length === 0) return [];
    
    const sortedTasks = [...tasks].sort((a, b) => {
      const dateA = new Date(a.due_date || new Date());
      const dateB = new Date(b.due_date || new Date());
      return dateA - dateB;
    });
    return sortedTasks;
  }, [tasks]);

  if (!sorted.length) {
    return <div className="text-center py-8 text-slate-400">No tasks to display</div>;
  }

  const startDate = new Date(Math.min(...sorted.map(t => new Date(t.due_date || new Date()).getTime())));
  const endDate = new Date(Math.max(...sorted.map(t => new Date(t.due_date || new Date()).getTime())));
  
  const totalDays = differenceInDays(endDate, startDate) + 1;
  const dayWidth = Math.max(30, 800 / totalDays);

  const getDependenciesForTask = (taskId) => {
    return dependencies.filter(d => d.to_task_id === taskId).map(d => d.from_task_id);
  };

  const statusColors = {
    "To Do": "bg-slate-300",
    "Doing": "bg-blue-400",
    "Blocked": "bg-red-400",
    "Done": "bg-green-400"
  };

  return (
    <div className="w-full overflow-x-auto border border-slate-200/60 rounded-lg bg-white">
      <div className="min-w-max">
        {/* Header */}
        <div className="flex sticky top-0 z-10 bg-slate-50 border-b border-slate-200/60">
          <div className="w-48 px-4 py-3 border-r border-slate-200/60 bg-slate-50 font-semibold text-sm text-slate-700">Task</div>
          <div className="flex">
            {Array.from({ length: totalDays }).map((_, i) => {
              const date = addDays(startDate, i);
              return (
                <div key={i} className="text-xs text-slate-600 border-r border-slate-200/60 p-2 text-center" style={{ width: dayWidth }}>
                  {i % 7 === 0 && format(date, "MMM d")}
                </div>
              );
            })}
          </div>
        </div>

        {/* Tasks */}
        {sorted.map((task, idx) => {
          const taskStart = new Date(task.due_date || new Date());
          const taskDays = Math.max(1, task.estimated_hours ? Math.ceil(task.estimated_hours / 8) : 1);
          const daysFromStart = differenceInDays(taskStart, startDate);
          const deps = getDependenciesForTask(task.id);

          return (
            <div key={task.id} className="flex border-b border-slate-200/60 hover:bg-slate-50/50">
              {/* Task name */}
              <div className="w-48 px-4 py-3 border-r border-slate-200/60 text-sm text-slate-700 font-medium truncate flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${statusColors[task.status] || "bg-slate-300"}`} />
                <span className="truncate">{task.title}</span>
                {deps.length > 0 && <ArrowRight className="h-3 w-3 text-slate-400 flex-shrink-0" />}
              </div>

              {/* Timeline bar */}
              <div className="flex relative" style={{ minWidth: totalDays * dayWidth }}>
                {Array.from({ length: totalDays }).map((_, i) => (
                  <div key={i} className="border-r border-slate-200/60 bg-white" style={{ width: dayWidth }} />
                ))}
                
                {/* Task bar */}
                <div
                  className={`absolute top-1/2 -translate-y-1/2 h-6 rounded-md flex items-center justify-center text-xs font-medium text-white truncate px-2 ${statusColors[task.status] || "bg-slate-400"}`}
                  style={{
                    left: `${daysFromStart * dayWidth}px`,
                    width: `${Math.max(taskDays * dayWidth, 60)}px`,
                    opacity: task.status === "Done" ? 0.6 : 1,
                  }}
                  title={`${task.title} - ${task.estimated_hours || 0}h`}
                >
                  {task.estimated_hours}h
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}