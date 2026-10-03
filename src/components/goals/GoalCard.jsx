import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Target, TrendingUp } from "lucide-react";
import { format } from "date-fns";

const statusColors = {
  "Not Started": "bg-slate-100 text-slate-800",
  "In Progress": "bg-blue-100 text-blue-800",
  "On Track": "bg-green-100 text-green-800",
  "At Risk": "bg-yellow-100 text-yellow-800",
  "Completed": "bg-emerald-100 text-emerald-800"
};

const priorityColors = {
  "Low": "bg-slate-200 text-slate-700",
  "Medium": "bg-amber-200 text-amber-700",
  "High": "bg-orange-200 text-orange-700",
  "Critical": "bg-red-200 text-red-700"
};

export default function GoalCard({ goal, kpis = [] }) {
  const completedKpis = kpis.filter(k => k.status === "Completed").length;
  const kpiProgress = kpis.length > 0 ? (completedKpis / kpis.length) * 100 : 0;

  return (
    <Card className="hover:shadow-lg transition-all">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Target className="h-4 w-4 text-amber-600" />
              <CardTitle className="text-base">{goal.title}</CardTitle>
            </div>
            <p className="text-xs text-slate-600 line-clamp-2">{goal.description}</p>
          </div>
          <Badge className={statusColors[goal.status]}>
            {goal.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="flex justify-between mb-2">
            <span className="text-xs font-medium text-slate-700">Progress</span>
            <span className="text-xs text-slate-600">{goal.progress_percentage}%</span>
          </div>
          <Progress value={goal.progress_percentage} className="h-2" />
        </div>

        {kpis.length > 0 && (
          <div className="space-y-2 pt-2 border-t">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-700">KPIs</span>
              <Badge variant="outline" className="text-xs">
                {completedKpis}/{kpis.length}
              </Badge>
            </div>
            <div className="space-y-1">
              {kpis.slice(0, 3).map(kpi => (
                <div key={kpi.id} className="flex items-center justify-between text-xs">
                  <span className="text-slate-600">{kpi.name}</span>
                  <span className="font-medium text-slate-700">
                    {kpi.current_value}/{kpi.target_value} {kpi.unit}
                  </span>
                </div>
              ))}
              {kpis.length > 3 && (
                <p className="text-xs text-slate-500 pt-1">+{kpis.length - 3} more KPIs</p>
              )}
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Badge className={priorityColors[goal.priority]}>
            {goal.priority}
          </Badge>
          {goal.target_date && (
            <Badge variant="outline" className="text-xs">
              {format(new Date(goal.target_date), "MMM d")}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}