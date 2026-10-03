import React, { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient.js";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Clock, LogIn, LogOut, Calendar, Plus } from "lucide-react";
import { toast } from "sonner";
import { format, differenceInHours, differenceInMinutes, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function Timesheet() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [activeEntry, setActiveEntry] = useState(null);
  const [showManualDialog, setShowManualDialog] = useState(false);
  const [manualForm, setManualForm] = useState({
    date: format(new Date(), "yyyy-MM-dd"),
    start_time: "",
    end_time: "",
    notes: "",
  });
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  const { data: entries = [] } = useQuery({
    queryKey: ["timeEntries", currentUser?.id],
    queryFn: () => base44.entities.TimeEntry.filter({ user_id: currentUser.id }, "-date"),
    enabled: !!currentUser,
  });

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (currentUser && entries.length > 0) {
      const active = entries.find(e => e.clock_in && !e.clock_out);
      setActiveEntry(active || null);
    }
  }, [entries, currentUser]);

  const createEntryMutation = useMutation({
    mutationFn: async (data) => {
      const entry = await base44.entities.TimeEntry.create(data);
      
      // Send notification to admins
      await base44.entities.Notification.create({
        type: "System",
        title: "New Timesheet Entry Pending Approval",
        body: `${currentUser.full_name} submitted a timesheet entry for ${format(new Date(data.date), "MMM d, yyyy")} - ${data.total_hours?.toFixed(2) || "pending"} hours`,
        related_type: "TimeEntry",
        related_id: entry.id,
      });
      
      return entry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["timeEntries"] });
      toast.success("Time entry submitted for approval");
    },
  });

  const updateEntryMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const entry = await base44.entities.TimeEntry.update(id, data);
      
      // Send notification to admins when clocking out
      if (data.clock_out) {
        await base44.entities.Notification.create({
          type: "System",
          title: "New Timesheet Entry Pending Approval",
          body: `${currentUser.full_name} submitted a timesheet entry for ${format(new Date(data.clock_out), "MMM d, yyyy")} - ${data.total_hours?.toFixed(2)} hours`,
          related_type: "TimeEntry",
          related_id: id,
        });
      }
      
      return entry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["timeEntries"] });
      toast.success("Clocked out - submitted for approval");
    },
  });

  const handleClockIn = () => {
    const now = new Date();
    createEntryMutation.mutate({
      user_id: currentUser.id,
      employee_name: currentUser.full_name,
      date: format(now, "yyyy-MM-dd"),
      clock_in: now.toISOString(),
      entry_type: "Clock",
    });
  };

  const handleClockOut = () => {
    if (!activeEntry) return;
    const now = new Date();
    const clockIn = new Date(activeEntry.clock_in);
    const hours = differenceInHours(now, clockIn);
    const minutes = differenceInMinutes(now, clockIn) % 60;
    const totalHours = parseFloat((hours + minutes / 60).toFixed(2));

    updateEntryMutation.mutate({
      id: activeEntry.id,
      data: {
        clock_out: now.toISOString(),
        total_hours: totalHours,
      },
    });
  };

  const handleManualEntry = () => {
    const startDateTime = new Date(`${manualForm.date}T${manualForm.start_time}`);
    const endDateTime = new Date(`${manualForm.date}T${manualForm.end_time}`);
    const hours = differenceInHours(endDateTime, startDateTime);
    const minutes = differenceInMinutes(endDateTime, startDateTime) % 60;
    const totalHours = parseFloat((hours + minutes / 60).toFixed(2));

    createEntryMutation.mutate({
      user_id: currentUser.id,
      employee_name: currentUser.full_name,
      date: manualForm.date,
      clock_in: startDateTime.toISOString(),
      clock_out: endDateTime.toISOString(),
      total_hours: totalHours,
      entry_type: "Manual",
      notes: manualForm.notes,
    });

    setShowManualDialog(false);
    setManualForm({ date: format(new Date(), "yyyy-MM-dd"), start_time: "", end_time: "", notes: "" });
  };

  const getElapsedTime = () => {
    if (!activeEntry?.clock_in) return "0:00:00";
    const clockIn = new Date(activeEntry.clock_in);
    const diff = Math.floor((currentTime - clockIn) / 1000);
    const hours = Math.floor(diff / 3600);
    const minutes = Math.floor((diff % 3600) / 60);
    const seconds = diff % 60;
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  };

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);
  
  const calendarDays = eachDayOfInterval({
    start: startDate,
    end: endDate
  });

  const getEntriesForDate = (date) => {
    return entries.filter(e => e.date === format(date, "yyyy-MM-dd"));
  };

  const getHoursForDate = (date) => {
    const dayEntries = getEntriesForDate(date);
    return dayEntries.reduce((sum, e) => sum + (e.total_hours || 0), 0);
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center">
          <Clock className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Timesheet</h1>
          <p className="text-sm text-slate-600">Track your work hours</p>
        </div>
      </div>

      <Tabs defaultValue="clock" className="w-full">
        <TabsList className="grid w-full grid-cols-3 max-w-2xl">
          <TabsTrigger value="clock">Clock In/Out</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
        </TabsList>

        <TabsContent value="clock" className="space-y-6">
          {/* Clock Widget */}
          <Card className="p-8 border-slate-200/60 bg-white/80 text-center">
            <div className="space-y-4">
              <div className="text-6xl font-bold text-slate-900 font-mono">
                {format(currentTime, "HH:mm:ss")}
              </div>
              <div className="text-lg text-slate-600">
                {format(currentTime, "EEEE, MMMM d, yyyy")}
              </div>

              {activeEntry && (
                <div className="mt-6 p-4 rounded-xl bg-green-50 border-2 border-green-200">
                  <p className="text-sm text-green-700 font-semibold mb-1">Currently Clocked In</p>
                  <p className="text-3xl font-bold text-green-900 font-mono">{getElapsedTime()}</p>
                  <p className="text-xs text-green-600 mt-1">Since {format(new Date(activeEntry.clock_in), "h:mm a")}</p>
                </div>
              )}

              <div className="flex gap-3 justify-center mt-6">
                {!activeEntry ? (
                  <Button
                    onClick={handleClockIn}
                    size="lg"
                    className="bg-gradient-to-br from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white px-8"
                  >
                    <LogIn className="h-5 w-5 mr-2" />
                    Clock In
                  </Button>
                ) : (
                  <Button
                    onClick={handleClockOut}
                    size="lg"
                    className="bg-gradient-to-br from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white px-8"
                  >
                    <LogOut className="h-5 w-5 mr-2" />
                    Clock Out
                  </Button>
                )}
              </div>
            </div>
          </Card>

          {/* Manual Entry */}
          <Card className="p-5 border-slate-200/60 bg-white/80">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-slate-800">Manual Entry</h3>
              <Button onClick={() => setShowManualDialog(true)} variant="outline">
                <Plus className="h-4 w-4 mr-2" />
                Add Hours
              </Button>
            </div>
            <p className="text-sm text-slate-600">Enter time worked for a specific date and time range</p>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card className="p-5 border-slate-200/60 bg-white/80">
            <h3 className="text-base font-semibold text-slate-800 mb-4">Time Entry History</h3>
            <div className="space-y-2">
              {entries.map(entry => (
                <div key={entry.id} className="p-4 rounded-lg border border-slate-200 hover:border-amber-400 transition-all">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <Calendar className="h-4 w-4 text-slate-400" />
                      <span className="font-semibold text-slate-900">{format(new Date(entry.date), "MMM d, yyyy")}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-1 rounded ${entry.entry_type === "Clock" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>
                        {entry.entry_type}
                      </span>
                      <span className={`text-xs px-2 py-1 rounded ${
                        entry.status === "Approved" ? "bg-emerald-100 text-emerald-700" : 
                        entry.status === "Rejected" ? "bg-red-100 text-red-700" : 
                        "bg-amber-100 text-amber-700"
                      }`}>
                        {entry.status || "Pending"}
                      </span>
                      <span className="text-lg font-bold text-amber-600">{entry.total_hours?.toFixed(2) || "—"} hrs</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-slate-600">
                    <span>In: {entry.clock_in ? format(new Date(entry.clock_in), "h:mm a") : "—"}</span>
                    <span>Out: {entry.clock_out ? format(new Date(entry.clock_out), "h:mm a") : "Active"}</span>
                  </div>
                  {entry.notes && (
                    <p className="text-sm text-slate-500 mt-2 italic">{entry.notes}</p>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="calendar">
          <Card className="p-5 border-slate-200/60 bg-white/80">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-slate-800">Time Tracker Calendar</h3>
              <div className="flex items-center gap-4">
                <Button variant="outline" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="font-semibold text-slate-700 min-w-[120px] text-center">
                  {format(currentMonth, "MMMM yyyy")}
                </span>
                <Button variant="outline" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-px bg-slate-200 border border-slate-200 rounded-lg overflow-hidden">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                <div key={day} className="bg-slate-50 py-2 text-center text-sm font-medium text-slate-600">
                  {day}
                </div>
              ))}
              {calendarDays.map((day, dayIdx) => {
                const isCurrentMonth = isSameMonth(day, monthStart);
                const dayHours = getHoursForDate(day);
                const isToday = isSameDay(day, new Date());
                
                return (
                  <div 
                    key={day.toString()} 
                    className={`min-h-[100px] bg-white p-2 flex flex-col ${!isCurrentMonth ? 'opacity-50 bg-slate-50' : ''} ${isToday ? 'bg-amber-50/50' : ''}`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className={`text-sm font-medium ${isToday ? 'bg-amber-500 text-white rounded-full w-6 h-6 flex items-center justify-center' : 'text-slate-700'}`}>
                        {format(day, "d")}
                      </span>
                    </div>
                    {dayHours > 0 && (
                      <div className="mt-auto flex justify-end">
                        <span className="inline-flex items-center px-2 py-1 rounded bg-emerald-100 text-emerald-700 text-xs font-bold">
                          {dayHours.toFixed(2)} hrs
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Manual Entry Dialog */}
      <Dialog open={showManualDialog} onOpenChange={setShowManualDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Manual Time Entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-2 block">Date</label>
              <Input type="date" value={manualForm.date} onChange={(e) => setManualForm({ ...manualForm, date: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-slate-700 mb-2 block">Start Time</label>
                <Input type="time" value={manualForm.start_time} onChange={(e) => setManualForm({ ...manualForm, start_time: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 mb-2 block">End Time</label>
                <Input type="time" value={manualForm.end_time} onChange={(e) => setManualForm({ ...manualForm, end_time: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-2 block">Notes (optional)</label>
              <Input placeholder="Project or task details..." value={manualForm.notes} onChange={(e) => setManualForm({ ...manualForm, notes: e.target.value })} />
            </div>
          </div>
          <Button onClick={handleManualEntry} disabled={!manualForm.start_time || !manualForm.end_time} className="bg-gradient-to-br from-amber-500 to-amber-600 text-slate-900">
            Add Entry
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}