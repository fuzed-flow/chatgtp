import React from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function UrgentTasksBanner({ projectTasks = [] }) {
  const navigate = useNavigate();

  // Calculate urgent tasks directly inside the component
  const urgentTasks = projectTasks.filter(t => {
    if (["Completed", "Done"].includes(t.status)) return false;
    
    const isUrgentPriority = t.priority === "Urgent";
    
    // Format right now into a YYYY-MM-DD string
    const todayStr = format(new Date(), "yyyy-MM-dd");
    
    // Compare the two strings directly to avoid timezone shift bugs
    const isOverdue = t.due_date_target && t.due_date_target < todayStr;
    
    return isUrgentPriority || isOverdue;
  });
  
  const urgentCount = urgentTasks.length;
  console.log("Total tasks in DB:", projectTasks.length);
  console.log("Urgent tasks found:", urgentCount);
  console.log("The actual task data:", urgentTasks);

  return (
    <div className="w-full">
      {urgentCount > 0 ? (
        <div 
          onClick={() => navigate('/Tasks')}
          className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-xl shadow-sm flex items-center justify-between cursor-pointer hover:bg-red-100 transition-colors w-full"
        >
          <div className="flex items-center gap-3">
            <div className="bg-red-500 rounded-full p-2 animate-pulse shrink-0">
              <AlertTriangle className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-red-900">Urgent Attention Required</h3>
              <p className="text-sm text-red-700">You have {urgentCount} urgent or overdue task{urgentCount !== 1 ? 's' : ''}.</p>
            </div>
          </div>            
          <Button variant="ghost" size="sm" className="hidden sm:flex text-red-700 hover:text-red-900 hover:bg-red-200">
            View All <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      ) : (
        <div 
          onClick={() => navigate('/Tasks')}
          className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl flex items-center justify-between cursor-pointer hover:bg-emerald-100 transition-colors shadow-sm w-full"
        >
          <div className="flex items-center gap-3 text-emerald-800 font-medium">
            <div className="h-3 w-3 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] shrink-0"></div>
            All clear! No overdue tasks today.
          </div>
          <Button variant="ghost" size="sm" className="hidden sm:flex text-emerald-700 hover:text-emerald-900 hover:bg-emerald-200">
            View All <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}