import React from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, ClipboardList, Palmtree, Bell, MapPin, Calendar, Megaphone, DollarSign } from "lucide-react";
import { format, isToday, parseISO, startOfWeek, endOfWeek } from "date-fns";

export default function EPDashboard({ currentUser, profile }) {
  const today = format(new Date(), "yyyy-MM-dd");

  const { data: timesheets = [] } = useQuery({
    queryKey: ["ep_timesheets", currentUser?.email],
    queryFn: () => base44.entities.Timesheet.filter({ user_email: currentUser.email }),
    enabled: !!currentUser?.email,
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ["ep_tasks", currentUser?.email],
    queryFn: () => base44.entities.PMTask.filter({ assigned_to: currentUser.email }),
    enabled: !!currentUser?.email,
  });

  const { data: expenses = [] } = useQuery({
    queryKey: ["ep_expenses", currentUser?.email],
    queryFn: () => base44.entities.ExpenseClaim.filter({ user_email: currentUser.email }),
    enabled: !!currentUser?.email,
  });

  const { data: scheduleJobs = [] } = useQuery({
    queryKey: ["ep_schedule", currentUser?.email],
    queryFn: () => base44.entities.ScheduleJob.filter({ assigned_to: currentUser.email }),
    enabled: !!currentUser?.email,
  });

  const { data: announcements = [] } = useQuery({
    queryKey: ["ep_announcements"],
    queryFn: () => base44.entities.EmployeeAnnouncement.list("-created_date", 5),
  });

  // Weekly hours
  const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
  const weekEnd = format(endOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
  const weeklyHours = timesheets
    .filter(t => t.date >= weekStart && t.date <= weekEnd)
    .reduce((s, t) => s + (t.total_hours || 0), 0);

  const todaySheet = timesheets.find(t => t.date === today);
  const pendingExpenses = expenses.filter(e => e.status === "Submitted" || e.status === "Under Review");
  const todayTasks = tasks.filter(t => t.due_date === today && t.status !== "Completed");
  const upcomingJobs = scheduleJobs
    .filter(j => j.start_date_time && new Date(j.start_date_time) >= new Date())
    .sort((a, b) => new Date(a.start_date_time) - new Date(b.start_date_time))
    .slice(0, 3);

  const vacRemaining = profile ? (profile.vacation_days_total || 0) - (profile.vacation_days_used || 0) : null;

  return (
    <div className="space-y-5">
      {/* Welcome */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-2xl p-5 text-white">
        <p className="text-slate-400 text-sm">{format(new Date(), "EEEE, MMMM d, yyyy")}</p>
        <h2 className="text-xl font-bold mt-1">
          Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, {currentUser?.full_name?.split(" ")[0]}!
        </h2>
        {profile?.position && <p className="text-amber-400 text-sm mt-1">{profile.position}</p>}
        {todaySheet?.clock_in && !todaySheet?.clock_out && (
          <div className="mt-3 flex items-center gap-2 bg-green-500/20 border border-green-500/30 rounded-lg px-3 py-2">
            <div className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-green-300 text-sm font-medium">Clocked in at {todaySheet.clock_in}</span>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="border-slate-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-amber-500" />
              <span className="text-xs text-slate-500 font-medium">Week Hours</span>
            </div>
            <p className="text-2xl font-bold text-slate-900">{weeklyHours.toFixed(1)}<span className="text-sm font-normal text-slate-400">h</span></p>
          </CardContent>
        </Card>
        <Card className="border-slate-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <ClipboardList className="h-4 w-4 text-blue-500" />
              <span className="text-xs text-slate-500 font-medium">Today's Tasks</span>
            </div>
            <p className="text-2xl font-bold text-slate-900">{todayTasks.length}</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="h-4 w-4 text-orange-500" />
              <span className="text-xs text-slate-500 font-medium">Pending Expenses</span>
            </div>
            <p className="text-2xl font-bold text-slate-900">{pendingExpenses.length}</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Palmtree className="h-4 w-4 text-green-500" />
              <span className="text-xs text-slate-500 font-medium">Vacation Left</span>
            </div>
            <p className="text-2xl font-bold text-slate-900">{vacRemaining !== null ? vacRemaining : "—"}</p>
          </CardContent>
        </Card>
      </div>

      {/* Upcoming Schedule */}
      {upcomingJobs.length > 0 && (
        <Card className="border-slate-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Calendar className="h-4 w-4 text-purple-500" />
              <h3 className="font-semibold text-slate-800 text-sm">Upcoming Schedule</h3>
            </div>
            <div className="space-y-2">
              {upcomingJobs.map(job => (
                <div key={job.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                  <div className="h-8 w-8 rounded-lg bg-purple-100 flex items-center justify-center shrink-0">
                    <MapPin className="h-4 w-4 text-purple-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{job.title}</p>
                    {job.start_date_time && (
                      <p className="text-xs text-slate-500">{format(new Date(job.start_date_time), "EEE MMM d · h:mm a")}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Today's Tasks */}
      {todayTasks.length > 0 && (
        <Card className="border-slate-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <ClipboardList className="h-4 w-4 text-blue-500" />
              <h3 className="font-semibold text-slate-800 text-sm">Today's Tasks</h3>
            </div>
            <div className="space-y-2">
              {todayTasks.map(task => (
                <div key={task.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                  <div className={`h-2 w-2 rounded-full shrink-0 ${task.priority === "Urgent" ? "bg-red-500" : task.priority === "High" ? "bg-orange-500" : "bg-blue-400"}`} />
                  <p className="text-sm text-slate-800 flex-1 truncate">{task.title}</p>
                  <Badge className="text-[10px] bg-blue-100 text-blue-700 shrink-0">{task.status}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Announcements */}
      {announcements.length > 0 && (
        <Card className="border-slate-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Megaphone className="h-4 w-4 text-amber-500" />
              <h3 className="font-semibold text-slate-800 text-sm">Company Announcements</h3>
            </div>
            <div className="space-y-2">
              {announcements.map(a => (
                <div key={a.id} className={`p-3 rounded-lg border ${a.priority === "Urgent" ? "bg-red-50 border-red-200" : a.priority === "Important" ? "bg-amber-50 border-amber-200" : "bg-slate-50 border-slate-100"}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-semibold text-slate-800">{a.title}</p>
                    {a.priority !== "Normal" && (
                      <Badge className={`text-[10px] ${a.priority === "Urgent" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{a.priority}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-slate-600">{a.body}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}